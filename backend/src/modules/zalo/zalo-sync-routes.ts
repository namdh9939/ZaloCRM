/**
 * zalo-sync-routes.ts — Endpoints to sync Zalo friends/contacts to CRM contacts.
 * Requires owner or admin role.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';

export async function zaloSyncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // Backfill sender_name for messages that have sender_uid but no name.
  // Uses getGroupMembersInfo to resolve members who aren't friends.
  app.post('/api/v1/zalo-accounts/:id/resync-sender-names', { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });
      const api = instance.api;

      // Gather unique (senderUid) pairs from messages belonging to this account with missing names.
      const rows = await prisma.$queryRaw<Array<{ sender_uid: string }>>`
        SELECT DISTINCT m.sender_uid
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.zalo_account_id = ${id}
          AND c.org_id = ${user.orgId}
          AND m.sender_type = 'contact'
          AND (m.sender_name IS NULL OR m.sender_name = '')
          AND m.sender_uid IS NOT NULL
          AND m.sender_uid <> ''
      `;

      const uids = rows.map((r) => r.sender_uid);
      if (uids.length === 0) return { success: true, resolved: 0, updated: 0, uids: 0 };

      // Batch via getGroupMembersInfo when available — response keys may be "${uid}" or "${uid}_0".
      const resolved = new Map<string, string>();
      if (typeof api.getGroupMembersInfo === 'function') {
        try {
          const batch = await api.getGroupMembersInfo(uids);
          const profiles = batch?.profiles || {};
          logger.info(`[sync] getGroupMembersInfo returned ${Object.keys(profiles).length} profiles for ${uids.length} uids`);
          for (const uid of uids) {
            const p = profiles[uid] || profiles[`${uid}_0`];
            const name = p?.zaloName || p?.displayName || '';
            if (name) resolved.set(uid, name);
          }
        } catch (err) {
          logger.warn('[sync] Bulk getGroupMembersInfo failed, falling back per-uid:', err);
        }
      }

      // Fallback per-uid via getUserInfo for anyone still unresolved.
      for (const uid of uids) {
        if (resolved.has(uid)) continue;
        try {
          const result = await api.getUserInfo(uid);
          const profiles = result?.changed_profiles || {};
          const profile = profiles[uid] || profiles[`${uid}_0`];
          const name = profile?.zaloName || profile?.zalo_name || profile?.displayName || profile?.display_name || '';
          if (name) resolved.set(uid, name);
        } catch { /* skip — unresolved UIDs are left untouched */ }
      }
      logger.info(`[sync] Final resolved ${resolved.size}/${uids.length} uids`);

      // Update messages in batches (one updateMany per uid).
      let updatedRows = 0;
      for (const [uid, name] of resolved) {
        const res = await prisma.message.updateMany({
          where: {
            senderUid: uid,
            senderName: null,
            conversation: { zaloAccountId: id, orgId: user.orgId },
          },
          data: { senderName: name },
        });
        const res2 = await prisma.message.updateMany({
          where: {
            senderUid: uid,
            senderName: '',
            conversation: { zaloAccountId: id, orgId: user.orgId },
          },
          data: { senderName: name },
        });
        updatedRows += res.count + res2.count;
      }

      logger.info(`[sync] resync-sender-names: resolved ${resolved.size}/${uids.length} UIDs, updated ${updatedRows} messages`);
      return { success: true, uids: uids.length, resolved: resolved.size, updated: updatedRows };
    }
  );

  // Backfill group creation dates from Zalo getGroupInfo into contact.metadata.groupCreatedAt.
  app.post('/api/v1/zalo-accounts/:id/sync-group-dates', { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });
      const api = instance.api;

      // All group contacts for this account — we refresh createdAt + globalGroupId.
      const groups = await prisma.contact.findMany({
        where: {
          orgId: user.orgId,
          isGroup: true,
          zaloUid: { not: null },
          conversations: { some: { zaloAccountId: id } },
        },
        select: { id: true, zaloUid: true, metadata: true, globalGroupId: true },
      });

      if (groups.length === 0) return { success: true, scanned: 0, updated: 0 };

      // Helper: apply resolved info (createdTime + globalId) to one contact row.
      async function applyInfo(
        contact: (typeof groups)[number],
        gi: any,
      ): Promise<boolean> {
        const patch: Record<string, any> = {};
        const ct = Number(gi?.createdTime);
        const meta = (contact.metadata as Record<string, unknown>) || {};
        if (Number.isFinite(ct) && ct > 0 && !meta.groupCreatedAt) {
          patch.metadata = { ...meta, groupCreatedAt: new Date(ct).toISOString() };
        }
        if (gi?.globalId && !contact.globalGroupId) {
          patch.globalGroupId = gi.globalId;
        }
        if (Object.keys(patch).length === 0) return false;
        await prisma.contact.update({ where: { id: contact.id }, data: patch });
        return true;
      }

      let updatedCount = 0;
      try {
        const batchIds = groups.map((g) => g.zaloUid as string);
        const res = await api.getGroupInfo(batchIds);
        const info = res?.gridInfoMap || {};
        for (const g of groups) {
          if (await applyInfo(g, info[g.zaloUid as string])) updatedCount++;
        }
      } catch (err) {
        logger.error('[sync] Batch getGroupInfo failed — falling back per-group:', err);
        for (const g of groups) {
          try {
            const res = await api.getGroupInfo(g.zaloUid as string);
            const gi = res?.gridInfoMap?.[g.zaloUid as string];
            if (await applyInfo(g, gi)) updatedCount++;
          } catch { /* skip */ }
        }
      }

      // Propagate globalGroupId across same-name duplicates in the org.
      // If account A saw group X and got globalId G, then account B's copy
      // of group X (same fullName, no globalId yet) almost certainly has the
      // same real-world ID → copy G over so dedupe works without B re-syncing.
      const enriched = await prisma.contact.findMany({
        where: { orgId: user.orgId, isGroup: true, globalGroupId: { not: null } },
        select: { fullName: true, globalGroupId: true },
      });
      const nameToGlobalId = new Map<string, string>();
      for (const c of enriched) {
        if (c.fullName && c.globalGroupId) {
          nameToGlobalId.set(c.fullName, c.globalGroupId);
        }
      }
      let propagatedCount = 0;
      for (const [fullName, gid] of nameToGlobalId) {
        const r = await prisma.contact.updateMany({
          where: {
            orgId: user.orgId,
            isGroup: true,
            fullName,
            globalGroupId: null,
          },
          data: { globalGroupId: gid },
        });
        propagatedCount += r.count;
      }

      logger.info(`[sync] sync-group-dates: ${updatedCount}/${groups.length} fetched via Zalo, ${propagatedCount} propagated by name match (account ${id})`);
      return {
        success: true,
        scanned: groups.length,
        updated: updatedCount,
        propagated: propagatedCount,
        total: groups.length,
      };
    }
  );

  // Sync all friends from a Zalo account to contacts
  app.post('/api/v1/zalo-accounts/:id/sync-contacts', { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

      try {
        const result = await instance.api.getAllFriends();
        // getAllFriends returns object with profiles
        const friends = Object.values(result || {}) as any[];
        let created = 0, updated = 0;

        for (const friend of friends) {
          const uid = friend.userId || friend.uid || '';
          if (!uid) continue;

          const zaloName = friend.zaloName || friend.zalo_name || friend.displayName || friend.display_name || '';
          const avatar = friend.avatar || '';
          const phone = friend.phoneNumber || '';

          const existing = await prisma.contact.findFirst({
            where: { zaloUid: uid, orgId: user.orgId },
          });

          if (existing) {
            await prisma.contact.update({
              where: { id: existing.id },
              data: {
                fullName: zaloName || existing.fullName,
                avatarUrl: avatar || existing.avatarUrl,
                phone: phone || existing.phone,
              },
            });
            updated++;
          } else {
            await prisma.contact.create({
              data: {
                id: randomUUID(),
                orgId: user.orgId,
                zaloUid: uid,
                fullName: zaloName || 'Unknown',
                avatarUrl: avatar || null,
                phone: phone || null,
              },
            });
            created++;
          }
        }

        // Backfill: link orphaned conversations (contactId is null) to contacts
        const linked = await linkOrphanedConversations(id, user.orgId, instance.api);

        logger.info(`[sync] Zalo contacts: ${created} created, ${updated} updated, ${linked} conversations linked`);
        return { success: true, created, updated, linked, total: friends.length };
      } catch (err) {
        logger.error('[sync] Zalo contacts error:', err);
        return reply.status(500).send({ error: 'Sync failed: ' + String(err) });
      }
    }
  );
}

/**
 * Find conversations with no linked contact and resolve them via Zalo API.
 * Creates missing contacts and links them to their conversations.
 */
async function linkOrphanedConversations(
  accountId: string,
  orgId: string,
  api: any,
): Promise<number> {
  const orphaned = await prisma.conversation.findMany({
    where: { zaloAccountId: accountId, contactId: null, threadType: 'user' },
    select: { id: true, externalThreadId: true },
  });

  if (orphaned.length === 0) return 0;

  let linked = 0;
  for (const conv of orphaned) {
    const uid = conv.externalThreadId;
    if (!uid) continue;

    // Check if contact already exists for this UID
    let contact = await prisma.contact.findFirst({
      where: { zaloUid: uid, orgId },
      select: { id: true },
    });

    if (!contact) {
      // Resolve name from Zalo API
      let zaloName = '';
      let avatar = '';
      let phone = '';
      try {
        const result = await api.getUserInfo(uid);
        const profiles = result?.changed_profiles || {};
        const profile = profiles[uid] || profiles[`${uid}_0`];
        if (profile) {
          zaloName = profile.zaloName || profile.zalo_name || profile.displayName || profile.display_name || '';
          avatar = profile.avatar || '';
          phone = profile.phoneNumber || '';
        }
      } catch (err) {
        logger.warn(`[sync] getUserInfo failed for ${uid}:`, err);
      }

      contact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: uid,
          fullName: zaloName || 'Unknown',
          avatarUrl: avatar || null,
          phone: phone || null,
        },
        select: { id: true },
      });
    }

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { contactId: contact.id },
    });
    linked++;
  }

  logger.info(`[sync] Linked ${linked} orphaned conversations for account ${accountId}`);
  return linked;
}
