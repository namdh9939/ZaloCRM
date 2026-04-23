/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { memberScopeViaContact, isPrivilegedRole } from '../../shared/utils/member-scope.js';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';

type QueryParams = Record<string, string>;

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── Conversation filter counts (unread, unreplied, total) ───────────────
  // NOTE: Must be registered BEFORE /api/v1/conversations/:id to avoid route conflict
  app.get('/api/v1/conversations/counts', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { accountId = '', tab = '' } = request.query as QueryParams;

    const baseWhere: any = { orgId: user.orgId };
    if (accountId) baseWhere.zaloAccountId = accountId;
    if (tab) baseWhere.tab = tab;

    // Members only see conversations whose contact is assigned to them.
    Object.assign(baseWhere, memberScopeViaContact(user));

    const [unread, unreplied, total] = await Promise.all([
      prisma.conversation.count({ where: { ...baseWhere, unreadCount: { gt: 0 } } }),
      prisma.conversation.count({ where: { ...baseWhere, isReplied: false } }),
      prisma.conversation.count({ where: baseWhere }),
    ]);

    return { unread, unreplied, total };
  });

  // ── List conversations (paginated, filterable) ──────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const {
      page = '1',
      limit = '50',
      search = '',
      accountId = '',
      // Filter params
      unread = '',
      unreplied = '',
      from = '',
      to = '',
      tags = '',
      tab = '',
    } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (tab) where.tab = tab;
    if (accountId) where.zaloAccountId = accountId;
    if (search) {
      where.contact = {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { crmName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

    // Advanced filters
    if (unread === 'true') where.unreadCount = { gt: 0 };
    if (unreplied === 'true') where.isReplied = false;
    if (from || to) {
      where.lastMessageAt = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d.getTime())) where.lastMessageAt.gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d.getTime())) where.lastMessageAt.lte = d;
      }
      // Remove empty filter if both dates invalid
      if (Object.keys(where.lastMessageAt).length === 0) delete where.lastMessageAt;
    }
    if (tags) {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        where.contact = {
          ...where.contact,
          tags: { array_contains: tagList },
        };
      }
    }

    // Pending-reply bucket from Dashboard drill-down.
    // Each bucket is mutually exclusive so a conversation appears in exactly one.
    // All buckets imply isReplied=false AND contact is individual (not a group).
    const { bucket } = request.query as QueryParams;
    if (bucket === '30m' || bucket === '2h' || bucket === '24h') {
      const now = Date.now();
      where.isReplied = false;
      where.contact = { ...(where.contact || {}), isGroup: false };
      if (bucket === '30m') {
        where.lastMessageAt = {
          gte: new Date(now - 2 * 60 * 60 * 1000),
          lt: new Date(now - 30 * 60 * 1000),
        };
      } else if (bucket === '2h') {
        where.lastMessageAt = {
          gte: new Date(now - 24 * 60 * 60 * 1000),
          lt: new Date(now - 2 * 60 * 60 * 1000),
        };
      } else {
        where.lastMessageAt = { lt: new Date(now - 24 * 60 * 60 * 1000) };
      }
    }

    // Members only see conversations whose contact is assigned to them.
    if (!isPrivilegedRole(user.role)) {
      where.contact = { ...(where.contact || {}), assignedUserId: user.id };
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, crmName: true, phone: true, avatarUrl: true, zaloUid: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * Math.min(parseInt(limit), 200),
        take: Math.min(parseInt(limit), 200),
      }),
      prisma.conversation.count({ where }),
    ]);

    return { conversations, total, page: parseInt(page), limit: Math.min(parseInt(limit), 200) };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId, ...memberScopeViaContact(user) },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    return conversation;
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId, ...memberScopeViaContact(user) },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId, ...memberScopeViaContact(user) },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      // zca-js sendMessage(message, threadId, type) — type: 0=User, 1=Group
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      const sendResult = await instance.api.sendMessage({ msg: content }, threadId, threadType);
      // Extract zaloMsgId from sendMessage response for dedup with selfListen
      const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: zaloMsgId || null,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content,
          contentType: 'text',
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  // ── Upload attachment (image/video/file) and send as Zalo message ───────
  app.post('/api/v1/conversations/:id/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId, ...memberScopeViaContact(user) },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

    // Collect all multipart parts — files into attachments, "caption" field into captionText
    const parts = request.parts();
    const attachments: Array<{ data: Buffer; filename: `${string}.${string}`; metadata: { totalSize: number; width?: number; height?: number } }> = [];
    let captionText = '';
    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        const buffer = Buffer.concat(chunks);
        // Ensure filename has extension for zca-js (`${string}.${string}` constraint)
        const raw = part.filename || 'file';
        const safeName = (raw.includes('.') ? raw : `${raw}.bin`) as `${string}.${string}`;
        attachments.push({ data: buffer, filename: safeName, metadata: { totalSize: buffer.length } });
      } else if (part.type === 'field' && part.fieldname === 'caption' && typeof part.value === 'string') {
        captionText = part.value;
      }
    }

    if (attachments.length === 0) return reply.status(400).send({ error: 'No file attached' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      const sendResult = await instance.api.sendMessage(
        { msg: captionText, attachments },
        threadId,
        threadType,
      );
      const zaloMsgId = String(sendResult?.attachment?.[0]?.msgId || sendResult?.message?.msgId || '');

      // Pick a sensible contentType for UI rendering
      const first = attachments[0];
      const lowerName = first.filename.toLowerCase();
      let contentType = 'file';
      if (/\.(jpe?g|png|gif|webp|bmp)$/.test(lowerName)) contentType = 'image';
      else if (/\.(mp4|mov|webm|mkv|avi)$/.test(lowerName)) contentType = 'video';

      const message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: zaloMsgId || null,
          senderType: 'self',
          senderUid: conversation.zaloAccount.zaloUid || '',
          senderName: 'Staff',
          content: captionText || attachments.map((a) => a.filename).join(', '),
          contentType,
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Upload message error:', err);
      return reply.status(500).send({ error: 'Failed to send attachment' });
    }
  });

  // ── Mark all conversations as read (bulk) ───────────────────────────────
  app.post('/api/v1/conversations/mark-all-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const body = (request.body || {}) as { accountId?: string; tab?: string; onlyUnread?: boolean };

    const where: any = { orgId: user.orgId };
    if (body.tab) where.tab = body.tab;
    if (body.onlyUnread !== false) where.unreadCount = { gt: 0 };
    if (body.accountId) where.zaloAccountId = body.accountId;

    // Members only affect conversations of contacts assigned to them.
    Object.assign(where, memberScopeViaContact(user));

    const result = await prisma.conversation.updateMany({
      where,
      data: { unreadCount: 0 },
    });

    return { success: true, updated: result.count };
  });

  // ── Mark conversation as read ────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId, ...memberScopeViaContact(user) },
      data: { unreadCount: 0 },
    });

    return { success: true };
  });

  // ── Move conversation to a different tab (main / other) ────────────────
  app.patch('/api/v1/conversations/:id/tab', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { tab } = request.body as { tab: string };

    if (!tab || !['main', 'other'].includes(tab)) {
      return reply.status(400).send({ error: 'tab must be "main" or "other"' });
    }

    const updated = await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId, ...memberScopeViaContact(user) },
      data: { tab },
    });

    if (updated.count === 0) return reply.status(404).send({ error: 'Conversation not found' });
    return { success: true, tab };
  });
}
