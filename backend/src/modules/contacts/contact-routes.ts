/**
 * contact-routes.ts — REST API for CRM contact management.
 * Supports list, detail, create, update, delete, pipeline view, and tag updates.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { mergeContacts } from './merge-service.js';
import { runContactIntelligence } from './contact-intelligence.js';
import { runAutomationRules } from '../automation/automation-service.js';
import { memberContactScope, isPrivilegedRole } from '../../shared/utils/member-scope.js';
import { computeConvertedAtDelta } from '../../shared/utils/contact-status.js';
import { propagateGroupUpdate } from '../../shared/utils/group-sync.js';
import { logStatusChange } from '../../shared/utils/status-logger.js';

type QueryParams = Record<string, string>;

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts — list with filters and pagination ───────────────
  app.get('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        page = '1',
        limit = '50',
        search = '',
        source = '',
        status = '',
        assignedUserId = '',
        threadType = '',
        zaloAccountId = '',
      } = request.query as QueryParams;

      const where: any = { orgId: user.orgId, mergedInto: null };
      if (source) where.source = source;
      if (status) where.status = status;
      if (assignedUserId) where.assignedUserId = assignedUserId;
      if (threadType === 'group') {
        where.isGroup = true;
      } else if (threadType === 'user') {
        where.isGroup = false;
      }
      if (zaloAccountId) {
        where.conversations = { some: { zaloAccountId } };
      }

      // Member scope — members only see contacts assigned to them
      Object.assign(where, memberContactScope(user));
      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { crmName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Dedupe groups that represent the same real-world Zalo group (one row
      // per distinct globalGroupId). Only kicks in when:
      //   - user is looking at the group tab (threadType=group)
      //   - and no specific Zalo account is selected (so they want a merged view)
      const shouldDedupeGroups = threadType === 'group' && !zaloAccountId;

      if (shouldDedupeGroups) {
        // Fetch all matching (typically <= a few hundred) then dedupe + paginate in JS.
        const all = await prisma.contact.findMany({
          where,
          include: {
            assignedUser: { select: { id: true, fullName: true, email: true } },
            _count: { select: { conversations: true, appointments: true } },
          },
          orderBy: { createdAt: 'asc' }, // deterministic — keep earliest as representative
        });
        // Dedupe key preference:
        //   1. globalGroupId (truth from Zalo) — accurate once synced
        //   2. "name:{fullName}" — fallback when globalId not yet populated;
        //      assumes groups with identical names in the same org are the same.
        //   3. id — distinct row (no key collision possible)
        const seen = new Set<string>();
        const deduped = all.filter((c) => {
          const key = c.globalGroupId
            ? `g:${c.globalGroupId}`
            : c.fullName
              ? `n:${c.fullName.trim().toLowerCase()}`
              : c.id;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        // Re-sort by updatedAt desc like the default view
        deduped.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        const total = deduped.length;
        const contacts = deduped.slice((pageNum - 1) * limitNum, pageNum * limitNum);
        return { contacts, total, page: pageNum, limit: limitNum };
      }

      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          include: {
            assignedUser: { select: { id: true, fullName: true, email: true } },
            _count: { select: { conversations: true, appointments: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.contact.count({ where }),
      ]);

      return { contacts, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  // ── GET /api/v1/contacts/pipeline — kanban grouped by generic status ──────
  app.get('/api/v1/contacts/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const orgId = user.orgId;

      const baseWhere: any = {
        orgId,
        status: { not: null },
        mergedInto: null,
        ...memberContactScope(user),
      };

      const pipeline = await prisma.contact.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: true,
      });

      // Fetch contacts per status for kanban cards (limit 20 per column)
      const statuses = pipeline.map((g) => g.status ?? 'unknown');
      const contactsByStatus: Record<string, any[]> = {};

      await Promise.all(
        statuses.map(async (st) => {
          const where: any = { ...baseWhere, status: st ?? null };
          const contacts = await prisma.contact.findMany({
            where,
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              avatarUrl: true,
              status: true,
              nextAppointment: true,
              assignedUser: { select: { id: true, fullName: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          });
          contactsByStatus[st ?? 'unknown'] = contacts;
        }),
      );

      const result = pipeline.map((g) => ({
        status: g.status ?? 'unknown',
        count: g._count,
        contacts: contactsByStatus[g.status ?? 'unknown'] ?? [],
      }));

      return { pipeline: result };
    } catch (err) {
      logger.error('[contacts] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline' });
    }
  });

  // ── GET /api/v1/contacts/:id — detail with appointments + conversation count
  app.get('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const where: any = { id, orgId: user.orgId, ...memberContactScope(user) };

      const contact = await prisma.contact.findFirst({
        where,
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
        },
      });

      if (!contact) return reply.status(404).send({ error: 'Contact not found' });
      return contact;
    } catch (err) {
      logger.error('[contacts] Detail error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });

  // ── POST /api/v1/contacts — create new contact ────────────────────────────
  app.post('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      const contact = await prisma.contact.create({
        data: {
          orgId: user.orgId,
          fullName: body.fullName,
          crmName: body.crmName,
          phone: body.phone,
          email: body.email,
          zaloUid: body.zaloUid,
          avatarUrl: body.avatarUrl,
          source: body.source,
          sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
          status: body.status ?? 'new',
          nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
          assignedUserId: body.assignedUserId,
          notes: body.notes,
          tags: body.tags ?? [],
          metadata: body.metadata ?? {},
        },
      });

      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true },
      });
      void runAutomationRules({
        trigger: 'contact_created',
        orgId: user.orgId,
        org,
        contact: {
          id: contact.id,
          fullName: contact.fullName,
          phone: contact.phone,
          status: contact.status,
          source: contact.source,
          assignedUserId: contact.assignedUserId,
        },
      });

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[contacts] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  // ── PUT /api/v1/contacts/:id — update CRM fields ─────────────────────────
  app.put('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId, ...memberContactScope(user) },
        select: { id: true, status: true, fullName: true, phone: true, source: true, assignedUserId: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updateData: any = {
        fullName: body.fullName,
        crmName: body.crmName,
        phone: body.phone,
        email: body.email,
        avatarUrl: body.avatarUrl,
        source: body.source,
        sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
        status: body.status,
        nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
        notes: body.notes,
        tags: body.tags,
        metadata: body.metadata,
        ...computeConvertedAtDelta(body.status, existing.status, body.convertedAt),
      };
      // Only owner/admin can (re)assign contacts — block member from self-reassigning.
      if (isPrivilegedRole(user.role) && body.assignedUserId !== undefined) {
        updateData.assignedUserId = body.assignedUserId || null;
      }
      // lostReason / lostNote — only meaningful when status → lost.
      if (body.status === 'lost') {
        if (body.lostReason !== undefined) updateData.lostReason = body.lostReason || null;
        if (body.lostNote !== undefined) updateData.lostNote = body.lostNote || null;
      } else if (body.status && body.status !== 'lost' && existing.status === 'lost') {
        // Moving away from lost — clear reason/note
        updateData.lostReason = null;
        updateData.lostNote = null;
      }
      if (body.firstContactDate !== undefined) {
        updateData.firstContactDate = body.firstContactDate ? new Date(body.firstContactDate) : null;
      }

      const updated = await prisma.contact.update({
        where: { id },
        data: updateData,
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
        },
      });

      if (existing.status !== updated.status) {
        const org = await prisma.organization.findUnique({
          where: { id: user.orgId },
          select: { id: true, name: true },
        });
        void runAutomationRules({
          trigger: 'status_changed',
          orgId: user.orgId,
          org,
          contact: {
            id: updated.id,
            fullName: updated.fullName,
            phone: updated.phone,
            status: updated.status,
            source: updated.source,
            assignedUserId: updated.assignedUserId,
          },
        });
      }

      // Log status transition to history for accurate time-in-stage reporting.
      if (body.status && body.status !== existing.status) {
        await logStatusChange({
          contactId: id,
          orgId: user.orgId,
          fromStatus: existing.status,
          toStatus: body.status,
          userId: user.id,
        });
      }

      // If this is a group contact with a shared globalGroupId, sync the
      // labelling fields (source, tags, assigned, status, notes) to all aliases.
      await propagateGroupUpdate(id, user.orgId, updateData);

      return updated;
    } catch (err) {
      logger.error('[contacts] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update contact' });
    }
  });

  // ── PUT /api/v1/contacts/:id/tags — update tags only ─────────────────────
  app.put('/api/v1/contacts/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { tags } = request.body as { tags: string[] };

      if (!Array.isArray(tags)) return reply.status(400).send({ error: 'tags must be an array' });

      const existing = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId, ...memberContactScope(user) },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({ where: { id }, data: { tags } });
      await propagateGroupUpdate(id, user.orgId, { tags });
      return updated;
    } catch (err) {
      logger.error('[contacts] Update tags error:', err);
      return reply.status(500).send({ error: 'Failed to update tags' });
    }
  });

  // ── PATCH /api/v1/contacts/:id/assign — owner/admin phân công KH cho 1 sale ─
  app.patch('/api/v1/contacts/:id/assign', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!isPrivilegedRole(user.role)) {
        return reply.status(403).send({ error: 'Chỉ Chủ sở hữu / Quản trị viên được phân công khách hàng' });
      }
      const { id } = request.params as { id: string };
      const { assignedUserId } = request.body as { assignedUserId: string | null };

      const existing = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      if (assignedUserId) {
        const target = await prisma.user.findFirst({
          where: { id: assignedUserId, orgId: user.orgId },
          select: { id: true },
        });
        if (!target) return reply.status(404).send({ error: 'Nhân viên không thuộc tổ chức' });
      }

      const updated = await prisma.contact.update({
        where: { id },
        data: { assignedUserId: assignedUserId || null },
        include: { assignedUser: { select: { id: true, fullName: true, email: true } } },
      });
      await propagateGroupUpdate(id, user.orgId, { assignedUserId: assignedUserId || null });
      logger.info(`[contacts] Contact ${id} assigned to ${assignedUserId || '(cleared)'} by ${user.email}`);
      return updated;
    } catch (err) {
      logger.error('[contacts] Assign error:', err);
      return reply.status(500).send({ error: 'Failed to assign contact' });
    }
  });

  // ── POST /api/v1/contacts/bulk-assign — owner/admin gán hàng loạt ───────────
  app.post('/api/v1/contacts/bulk-assign', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!isPrivilegedRole(user.role)) {
        return reply.status(403).send({ error: 'Chỉ Chủ sở hữu / Quản trị viên được phân công' });
      }
      const { contactIds, assignedUserId } = request.body as {
        contactIds: string[];
        assignedUserId: string | null;
      };
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return reply.status(400).send({ error: 'contactIds phải là mảng không rỗng' });
      }

      if (assignedUserId) {
        const target = await prisma.user.findFirst({
          where: { id: assignedUserId, orgId: user.orgId },
          select: { id: true },
        });
        if (!target) return reply.status(404).send({ error: 'Nhân viên không thuộc tổ chức' });
      }

      const result = await prisma.contact.updateMany({
        where: { id: { in: contactIds }, orgId: user.orgId },
        data: { assignedUserId: assignedUserId || null },
      });
      logger.info(`[contacts] Bulk-assigned ${result.count} contacts to ${assignedUserId || '(cleared)'} by ${user.email}`);
      return { updated: result.count };
    } catch (err) {
      logger.error('[contacts] Bulk-assign error:', err);
      return reply.status(500).send({ error: 'Failed to bulk-assign' });
    }
  });

  // ── DELETE /api/v1/contacts/:id ───────────────────────────────────────────
  app.delete('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      await prisma.contact.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[contacts] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete contact' });
    }
  });

  // ── GET /api/v1/contacts/duplicates — list unresolved duplicate groups ────
  app.get('/api/v1/contacts/duplicates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { page = '1', limit = '20', resolved = 'false' } = request.query as QueryParams;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const where = { orgId: user.orgId, resolved: resolved === 'true' };

      const [groups, total] = await Promise.all([
        prisma.duplicateGroup.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.duplicateGroup.count({ where }),
      ]);

      // Expand contact data for each group
      const expanded = await Promise.all(
        groups.map(async (group) => {
          const contacts = await prisma.contact.findMany({
            where: { id: { in: group.contactIds } },
            select: {
              id: true, fullName: true, phone: true, email: true,
              zaloUid: true, avatarUrl: true, source: true, status: true,
              tags: true, createdAt: true, leadScore: true, lastActivity: true,
            },
          });
          return { ...group, contacts };
        }),
      );

      return { groups: expanded, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] Duplicates list error:', err);
      return reply.status(500).send({ error: 'Failed to fetch duplicate groups' });
    }
  });

  // ── POST /api/v1/contacts/duplicates/:groupId/merge — merge a group ──────
  app.post('/api/v1/contacts/duplicates/:groupId/merge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { groupId } = request.params as { groupId: string };
      const { primaryContactId } = request.body as { primaryContactId: string };

      if (!primaryContactId) return reply.status(400).send({ error: 'primaryContactId is required' });

      const group = await prisma.duplicateGroup.findFirst({
        where: { id: groupId, orgId: user.orgId, resolved: false },
      });
      if (!group) return reply.status(404).send({ error: 'Duplicate group not found' });

      const secondaryIds = group.contactIds.filter((id) => id !== primaryContactId);
      if (secondaryIds.length === 0) return reply.status(400).send({ error: 'Primary must be in the group' });

      const merged = await mergeContacts(user.orgId, user.id, primaryContactId, secondaryIds);

      // Resolve the group
      await prisma.duplicateGroup.update({ where: { id: groupId }, data: { resolved: true } });

      return merged;
    } catch (err: any) {
      logger.error('[contacts] Merge error:', err);
      return reply.status(400).send({ error: err.message || 'Failed to merge contacts' });
    }
  });

  // ── POST /api/v1/contacts/intelligence/recompute — manual trigger ────────
  app.post('/api/v1/contacts/intelligence/recompute', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Fire and forget — return 202 immediately
      runContactIntelligence().catch((err) => {
        logger.error('[contacts] Recompute error:', err);
      });
      return reply.status(202).send({ message: 'Intelligence recompute started' });
    } catch (err) {
      logger.error('[contacts] Recompute trigger error:', err);
      return reply.status(500).send({ error: 'Failed to start recompute' });
    }
  });
}
