/**
 * zalo-listener-factory.ts — sets up zca-js listener events for one Zalo account.
 * Handles message routing, user-info caching, group detection, and undo events.
 * Extracted from ZaloAccountPool to keep zalo-pool.ts under 200 lines.
 */
import type { Server } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, handleMessageUndo } from '../chat/message-handler.js';
import { detectContentType, updateContactAvatar } from './zalo-message-helpers.js';

// Cached user info entry with 5-minute TTL
export interface UserInfoCacheEntry {
  zaloName: string;
  avatar: string;
  phone?: string;
  cachedAt: number;
}

const USER_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Fetch zaloName + avatar + phone with a per-pool in-memory cache.
// For group members (non-friends), getUserInfo often returns nothing — fall back
// to getGroupMembersInfo which works for any member regardless of friend status.
async function resolveZaloName(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
): Promise<{ zaloName: string; avatar: string; phone: string }> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.cachedAt < USER_INFO_CACHE_TTL_MS) {
    return { zaloName: cached.zaloName, avatar: cached.avatar, phone: cached.phone || '' };
  }

  // Try getUserInfo first — gives phoneNumber for users in phonebook.
  try {
    const result = await api.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const profile = profiles[uid] || profiles[`${uid}_0`];
    if (profile) {
      const zaloName =
        profile.zaloName ||
        profile.zalo_name ||
        profile.displayName ||
        profile.display_name ||
        '';
      if (zaloName) {
        const entry: UserInfoCacheEntry = {
          zaloName,
          avatar: profile.avatar || '',
          phone: profile.phoneNumber || profile.phone_number || '',
          cachedAt: Date.now(),
        };
        cache.set(uid, entry);
        return { zaloName: entry.zaloName, avatar: entry.avatar, phone: entry.phone || '' };
      }
    }
  } catch (err) {
    logger.warn(`[zalo] getUserInfo failed for ${uid}:`, err);
  }

  // Fallback: getGroupMembersInfo — resolves names for group members
  // who aren't in the friend list. The API wraps ids with "_0" suffix so
  // response keys can appear as either "${uid}" or "${uid}_0".
  if (typeof api.getGroupMembersInfo === 'function') {
    try {
      const res = await api.getGroupMembersInfo(uid);
      const profiles = res?.profiles || {};
      const profile = profiles[uid] || profiles[`${uid}_0`] || Object.values(profiles)[0];
      if (profile) {
        const name = (profile as any).zaloName || (profile as any).displayName || '';
        if (name) {
          const entry: UserInfoCacheEntry = {
            zaloName: name,
            avatar: (profile as any).avatar || '',
            phone: '',
            cachedAt: Date.now(),
          };
          cache.set(uid, entry);
          return { zaloName: entry.zaloName, avatar: entry.avatar, phone: '' };
        }
      }
      logger.debug(`[zalo] getGroupMembersInfo empty for ${uid}, keys: ${Object.keys(profiles).join(',')}`);
    } catch (err) {
      logger.warn(`[zalo] getGroupMembersInfo failed for ${uid}:`, err);
    }
  }

  return { zaloName: '', avatar: '', phone: '' };
}

// Fetch group display name + creation time + globalId from the zca-js API.
// globalId is stable across accounts — lets us dedupe duplicate group records.
async function resolveGroupInfo(
  api: any,
  groupId: string,
): Promise<{ name: string; createdTime: number | null; globalId: string | null }> {
  try {
    const result = await api.getGroupInfo(groupId);
    const info = result?.gridInfoMap?.[groupId];
    if (!info) return { name: '', createdTime: null, globalId: null };
    const ct = Number(info.createdTime);
    return {
      name: info.name || '',
      createdTime: Number.isFinite(ct) && ct > 0 ? ct : null,
      globalId: info.globalId || null,
    };
  } catch (err) {
    logger.warn(`[zalo] getGroupInfo failed for ${groupId}:`, err);
    return { name: '', createdTime: null, globalId: null };
  }
}

// Backwards-compat alias used by existing callers (name only)
async function resolveGroupName(api: any, groupId: string): Promise<string> {
  const { name } = await resolveGroupInfo(api, groupId);
  return name;
}

export interface ListenerContext {
  accountId: string;
  api: any;
  io: Server | null;
  userInfoCache: Map<string, UserInfoCacheEntry>;
  onDisconnected: (accountId: string) => void;
}

/**
 * Attach all zca-js listener events for the given account.
 * Calls listener.start() with retryOnClose at the end.
 */
export function attachZaloListener(ctx: ListenerContext): void {
  const { accountId, api, io, userInfoCache, onDisconnected } = ctx;
  const listener = api.listener;

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener connected`);
  });

  listener.on('message', async (message: any) => {
    try {
      // ThreadType in zca-js: 0 = User, 1 = Group
      const isGroup = message.type === 1;
      const senderUid = String(message.data?.uidFrom || '');

      // Resolve display name — prefer zaloName from API over dName
      let senderName: string = message.data?.dName || '';
      let senderPhone = '';
      if (senderUid && api.getUserInfo) {
        // For self messages, resolve recipient name using threadId
        // For contact messages, resolve sender name using senderUid
        const resolveUid = message.isSelf ? (message.threadId || '') : senderUid;
        if (resolveUid) {
          const userInfo = await resolveZaloName(api, resolveUid, userInfoCache);
          if (!message.isSelf) {
            if (userInfo.zaloName) senderName = userInfo.zaloName;
            if (userInfo.avatar) updateContactAvatar(senderUid, userInfo.avatar);
            if (userInfo.phone) senderPhone = userInfo.phone;
          }
        }
      }

      // Resolve group name + creation time + globalId for group threads
      let groupName: string | undefined;
      let groupCreatedTime: number | null = null;
      let groupGlobalId: string | null = null;
      if (isGroup && message.threadId) {
        const info = await resolveGroupInfo(api, message.threadId);
        groupName = info.name;
        groupCreatedTime = info.createdTime;
        groupGlobalId = info.globalId;
      }

      const rawContent = message.data?.content;
      const content =
        typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
      const contentType = detectContentType(message.data?.msgType, rawContent);

      const result = await handleIncomingMessage({
        accountId,
        senderUid,
        senderName,
        senderPhone,
        content,
        contentType,
        msgId: String(message.data?.msgId || ''),
        timestamp: parseInt(message.data?.ts || String(Date.now())),
        isSelf: message.isSelf || false,
        threadId: message.threadId || '',
        threadType: isGroup ? 'group' : 'user',
        groupName,
        groupCreatedTime: groupCreatedTime ?? undefined,
        groupGlobalId: groupGlobalId ?? undefined,
        attachments: [],
      });

      if (result) {
        io?.emit('chat:message', {
          accountId,
          message: result.message,
          conversationId: result.conversationId,
        });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Message handler error:`, err);
    }
  });

  listener.on('undo', async (data: any) => {
    const msgId = data.data?.msgId || data.msgId;
    if (msgId) {
      await handleMessageUndo(accountId, String(msgId));
      io?.emit('chat:deleted', { accountId, msgId: String(msgId) });
    }
  });

  // Backfill messages delivered on reconnect (missed while disconnected)
  listener.on('old_messages', async (messages: any[], type: number) => {
    const threadType = type === 1 ? 'group' : 'user';
    logger.info(`[zalo:${accountId}] Received ${messages.length} old ${threadType} messages`);

    for (const message of messages) {
      try {
        const senderUid = String(message.data?.uidFrom || '');
        let senderName = message.data?.dName || '';
        let senderPhone = '';

        // Resolve display name for non-self messages
        if (!message.isSelf && senderUid && api.getUserInfo) {
          const userInfo = await resolveZaloName(api, senderUid, userInfoCache);
          if (userInfo.zaloName) senderName = userInfo.zaloName;
          if (userInfo.phone) senderPhone = userInfo.phone;
        }

        let groupName: string | undefined;
        let groupCreatedTime: number | null = null;
        let groupGlobalId: string | null = null;
        if (threadType === 'group' && message.threadId) {
          const info = await resolveGroupInfo(api, message.threadId);
          groupName = info.name;
          groupCreatedTime = info.createdTime;
          groupGlobalId = info.globalId;
        }

        const rawContent = message.data?.content;
        const content =
          typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
        const contentType = detectContentType(message.data?.msgType, rawContent);

        const result = await handleIncomingMessage({
          accountId,
          senderUid,
          senderName,
          senderPhone,
          content,
          contentType,
          msgId: String(message.data?.msgId || ''),
          timestamp: parseInt(message.data?.ts || String(Date.now())),
          isSelf: message.isSelf || false,
          threadId: message.threadId || '',
          threadType,
          groupName,
          groupCreatedTime: groupCreatedTime ?? undefined,
          groupGlobalId: groupGlobalId ?? undefined,
          attachments: [],
          isBackfill: true,
        });

        if (result) {
          io?.emit('chat:message', {
            accountId,
            message: result.message,
            conversationId: result.conversationId,
          });
        }
      } catch (err) {
        logger.warn(`[zalo:${accountId}] old_messages processing error:`, err);
      }
    }
  });

  // Group system events: member join/leave/kick, name change, etc.
  listener.on('group_event', (event: any) => {
    logger.info(`[zalo:${accountId}] Group event: type=${event?.type ?? 'unknown'}`, {
      groupId: event?.groupId,
      actorId: event?.actorId,
      members: event?.members,
    });
    // Future: store as system message in the group conversation
  });

  // Friend lifecycle events: request sent/accepted/blocked
  listener.on('friend_event', (event: any) => {
    logger.info(`[zalo:${accountId}] Friend event: type=${event?.type ?? 'unknown'}`, {
      fromId: event?.fromId,
      toId: event?.toId,
    });
    // Future: update contact status based on friend_event type
  });

  listener.on('closed', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener closed: ${code} ${reason}`);
    onDisconnected(accountId);
    io?.emit('zalo:disconnected', { accountId, code, reason });
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.start({ retryOnClose: true });
}
