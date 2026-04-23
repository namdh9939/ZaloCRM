/**
 * dashboard-routes.ts — KPI, message volume, pipeline, sources, and appointment stats.
 * All routes require JWT auth, scoped to user's orgId.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { memberContactScope, memberScopeViaContact } from '../../shared/utils/member-scope.js';

type QueryParams = Record<string, string>;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Compute today's boundaries in UTC based on VN timezone (UTC+7)
function todayRange() {
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const todayVN = new Date(vnNow.getFullYear(), vnNow.getMonth(), vnNow.getDate());
  const today = new Date(todayVN.getTime() - vnOffset);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { today, tomorrow };
}

function weekAgoDate(from: Date) {
  const d = new Date(from);
  d.setDate(d.getDate() - 7);
  return d;
}

// ── View filter ───────────────────────────────────────────────────────────────
// SALE tab = individual (non-group) contacts.
// CSKH tab = group contacts with source = 'TLXN' (converted-customer project groups).
// No param / unrecognised = no filter (legacy behaviour).
function viewContactFilter(view: string | undefined): Record<string, any> {
  if (view === 'sale') return { isGroup: false };
  if (view === 'cskh') return { isGroup: true, source: 'TLXN' };
  return {};
}
function viewViaContactFilter(view: string | undefined): Record<string, any> {
  const frag = viewContactFilter(view);
  if (Object.keys(frag).length === 0) return {};
  return { contact: frag };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/dashboard/kpi?zaloAccountId=
  app.get('/api/v1/dashboard/kpi', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { zaloAccountId, view } = request.query as QueryParams;
      const { today, tomorrow } = todayRange();
      const weekAgo = weekAgoDate(today);

      // Merge member-scope + view-scope properly (both nest under `contact`, so
      // a raw spread would clobber; instead we merge the inner objects).
      const memberFlat = memberContactScope(request.user!); // { assignedUserId } or {}
      const viewFlat = viewContactFilter(view);              // { isGroup, source? } or {}
      const mergedContactFilter = { ...memberFlat, ...viewFlat };

      const convWhere: Record<string, any> = { orgId };
      if (Object.keys(mergedContactFilter).length > 0) convWhere.contact = mergedContactFilter;
      if (zaloAccountId) convWhere.zaloAccountId = zaloAccountId;

      const contactWhere: Record<string, any> = {
        orgId,
        ...mergedContactFilter,
      };
      if (zaloAccountId) contactWhere.conversations = { some: { zaloAccountId } };

      // Pending-reply KPIs only count individual (non-group) chats, regardless
      // of which tab the user is on. Groups generate lots of noise that
      // doesn't belong in a "you need to respond" counter.
      const pendingContactFilter: Record<string, any> = { ...memberFlat, isGroup: false };
      const pendingWhere: Record<string, any> = {
        orgId,
        contact: pendingContactFilter,
        isReplied: false,
      };
      if (zaloAccountId) pendingWhere.zaloAccountId = zaloAccountId;

      // Previous period bounds for WoW compare
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Missed-reply thresholds (now - X) — count conversations where contact is waiting
      const now = new Date();
      const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        messagesToday, messagesYesterday,
        unreplied, unread,
        aptsToday, aptsYesterday,
        newContacts, newContactsPrevWeek,
        totalContacts,
        missed30m, missed2h, missed24h,
      ] = await Promise.all([
        prisma.message.count({
          where: { conversation: convWhere, sentAt: { gte: today, lt: tomorrow } },
        }),
        prisma.message.count({
          where: { conversation: convWhere, sentAt: { gte: yesterday, lt: today } },
        }),
        prisma.conversation.count({ where: { ...pendingWhere, unreadCount: { gt: 0 } } }),
        prisma.conversation.count({ where: { ...convWhere, unreadCount: { gt: 0 } } }),
        prisma.appointment.count({
          where: {
            orgId,
            appointmentDate: { gte: today, lt: tomorrow },
            status: 'scheduled',
            ...memberScopeViaContact(request.user!),
            ...viewViaContactFilter(view),
          },
        }),
        prisma.appointment.count({
          where: {
            orgId,
            appointmentDate: { gte: yesterday, lt: today },
            status: 'scheduled',
            ...memberScopeViaContact(request.user!),
            ...viewViaContactFilter(view),
          },
        }),
        prisma.contact.count({ where: { ...contactWhere, createdAt: { gte: weekAgo } } }),
        prisma.contact.count({
          where: { ...contactWhere, createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
        }),
        prisma.contact.count({ where: contactWhere }),
        // Exclusive buckets — a conversation appears in exactly one column:
        //   missed30m: 30 phút–2 giờ        (lastMessageAt between 2h-ago and 30m-ago)
        //   missed2h:  2 giờ–24 giờ          (between 24h-ago and 2h-ago)
        //   missed24h: trên 24 giờ           (< 24h-ago)
        prisma.conversation.count({
          where: { ...pendingWhere, lastMessageAt: { gte: twoHoursAgo, lt: thirtyMinAgo } },
        }),
        prisma.conversation.count({
          where: { ...pendingWhere, lastMessageAt: { gte: twentyFourHoursAgo, lt: twoHoursAgo } },
        }),
        prisma.conversation.count({
          where: { ...pendingWhere, lastMessageAt: { lt: twentyFourHoursAgo } },
        }),
      ]);

      // Percentage change helper — guards divide-by-zero and returns null when base is 0
      const pct = (current: number, previous: number): number | null => {
        if (previous === 0) return current === 0 ? 0 : null;
        return Math.round(((current - previous) / previous) * 100);
      };

      return {
        messagesToday,
        messagesTodayChange: pct(messagesToday, messagesYesterday),
        messagesUnreplied: unreplied,
        messagesUnread: unread,
        appointmentsToday: aptsToday,
        appointmentsTodayChange: pct(aptsToday, aptsYesterday),
        newContactsThisWeek: newContacts,
        newContactsChange: pct(newContacts, newContactsPrevWeek),
        totalContacts,
        missed30m,
        missed2h,
        missed24h,
      };
    } catch (err) {
      logger.error('[dashboard] KPI error:', err);
      return reply.status(500).send({ error: 'Failed to fetch KPI data' });
    }
  });

  // GET /api/v1/dashboard/message-volume?from=&to=&zaloAccountId=
  app.get('/api/v1/dashboard/message-volume', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId, id: userId, role } = request.user!;
      const query = request.query as QueryParams;
      const from =
        query.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = query.to || new Date().toISOString().split('T')[0];
      const zaloAccountId = query.zaloAccountId || '';
      const view = query.view || '';

      // Member scope — filter by contact.assigned_user_id via JOIN.
      const isPrivileged = role === 'owner' || role === 'admin';
      const assignedFilterUid = isPrivileged ? '' : userId;

      // SALE/CSKH filter:
      //   0 = no filter (legacy)
      //   1 = sale (is_group = false)
      //   2 = cskh (is_group = true AND tags @> '["TLXN"]')
      const viewMode = view === 'sale' ? 1 : view === 'cskh' ? 2 : 0;

      const rows = await prisma.$queryRaw<
        Array<{ date: Date; sent: bigint; received: bigint }>
      >`
        SELECT
          DATE(m.sent_at) AS date,
          COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
          COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        LEFT JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.org_id = ${orgId}
          AND (${zaloAccountId}::text = '' OR c.zalo_account_id = ${zaloAccountId})
          AND (${assignedFilterUid}::text = '' OR ct.assigned_user_id = ${assignedFilterUid})
          AND (${viewMode} = 0
               OR (${viewMode} = 1 AND ct.is_group = false)
               OR (${viewMode} = 2 AND ct.is_group = true AND ct.source = 'TLXN'))
          AND m.sent_at >= ${from}::date
          AND m.sent_at < (${to}::date + interval '1 day')
        GROUP BY DATE(m.sent_at)
        ORDER BY date ASC
      `;

      const data = rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        sent: Number(r.sent),
        received: Number(r.received),
      }));

      return { data };
    } catch (err) {
      logger.error('[dashboard] Message volume error:', err);
      return reply.status(500).send({ error: 'Failed to fetch message volume' });
    }
  });

  // GET /api/v1/dashboard/pipeline — grouped by generic contact status
  app.get('/api/v1/dashboard/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { zaloAccountId, view } = request.query as QueryParams;
      const where: Record<string, any> = {
        orgId,
        status: { not: null },
        ...memberContactScope(request.user!),
        ...viewContactFilter(view),
      };
      if (zaloAccountId) where.conversations = { some: { zaloAccountId } };

      const pipeline = await prisma.contact.groupBy({ by: ['status'], where, _count: true });
      return { data: pipeline.map((p) => ({ status: p.status, count: p._count })) };
    } catch (err) {
      logger.error('[dashboard] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline data' });
    }
  });

  // GET /api/v1/dashboard/sources — returns total + converted count per source
  app.get('/api/v1/dashboard/sources', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { zaloAccountId, view } = request.query as QueryParams;
      const baseWhere: Record<string, any> = {
        orgId,
        source: { not: null },
        ...memberContactScope(request.user!),
        ...viewContactFilter(view),
      };
      if (zaloAccountId) baseWhere.conversations = { some: { zaloAccountId } };

      const [totals, converted] = await Promise.all([
        prisma.contact.groupBy({ by: ['source'], where: baseWhere, _count: true }),
        prisma.contact.groupBy({
          by: ['source'],
          where: { ...baseWhere, status: 'converted' },
          _count: true,
        }),
      ]);

      const convertedMap = new Map<string, number>();
      for (const c of converted) convertedMap.set(c.source ?? '', Number(c._count));

      const data = totals.map((s) => {
        const total = Number(s._count);
        const convertedCount = convertedMap.get(s.source ?? '') ?? 0;
        return {
          source: s.source,
          count: total,
          converted: convertedCount,
          conversionRate: total === 0 ? 0 : Math.round((convertedCount / total) * 100),
        };
      });

      return { data };
    } catch (err) {
      logger.error('[dashboard] Sources error:', err);
      return reply.status(500).send({ error: 'Failed to fetch source data' });
    }
  });

  // GET /api/v1/dashboard/appointments?from=&to=
  app.get('/api/v1/dashboard/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const where: Record<string, any> = {
        orgId,
        ...memberScopeViaContact(request.user!),
        ...viewViaContactFilter(query.view),
      };
      if (query.from || query.to) {
        where.appointmentDate = {};
        if (query.from) where.appointmentDate.gte = new Date(query.from);
        if (query.to) where.appointmentDate.lte = new Date(query.to);
      }

      const stats = await prisma.appointment.groupBy({
        by: ['status'],
        where,
        _count: true,
      });

      return { data: stats.map((s) => ({ status: s.status, count: s._count })) };
    } catch (err) {
      logger.error('[dashboard] Appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment stats' });
    }
  });
}
