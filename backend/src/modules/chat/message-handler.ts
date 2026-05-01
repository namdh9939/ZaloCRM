/**
 * message-handler.ts — persists incoming Zalo messages to the database.
 * Called from zalo-pool's startListener on every 'message' / 'undo' event.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { emitWebhook } from '../api/webhook-service.js';
import { runAutomationRules } from '../automation/automation-service.js';
import { scheduleLeadStatusDetection } from '../ai/lead-status-detection.js';

export interface IncomingMessage {
  accountId: string;
  senderUid: string;
  senderName: string;       // zaloName (from cache or dName fallback)
  content: string;
  contentType: string;      // text, image, sticker, video, voice, gif, link, file
  msgId: string;
  timestamp: number;        // epoch ms
  isSelf: boolean;
  threadId: string;         // For user: contact UID. For group: group ID
  threadType: 'user' | 'group'; // user or group conversation
  groupName?: string;       // group name if group message
  groupCreatedTime?: number; // group creation epoch ms — from Zalo getGroupInfo.createdTime
  groupGlobalId?: string;    // stable ID shared across Zalo accounts for the same real group
  attachments?: any[];
  isBackfill?: boolean;     // true for old_messages / sync backfill — skip automations
  senderPhone?: string;     // phoneNumber from Zalo getUserInfo — only set if contact is in phonebook
}

export interface HandleMessageResult {
  message: {
    id: string;
    conversationId: string;
    zaloMsgId: string | null;
    senderType: string;
    senderUid: string | null;
    senderName: string | null;
    content: string | null;
    contentType: string;
    attachments: any;
    isDeleted: boolean;
    deletedAt: Date | null;
    sentAt: Date;
    repliedByUserId: string | null;
    createdAt: Date;
  };
  conversationId: string;
  orgId: string;
  contactId: string | null;
}

export async function handleIncomingMessage(
  msg: IncomingMessage,
): Promise<HandleMessageResult | null> {
  try {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: msg.accountId },
      select: { orgId: true, ownerUserId: true },
    });
    if (!account) return null;

    const contactId = await upsertContact(msg, account.orgId);

    // Update lastActivity for lead scoring freshness
    if (contactId) {
      prisma.contact.update({
        where: { id: contactId },
        data: { lastActivity: new Date() },
      }).catch(() => {});
    }

    const conversation = await findOrCreateConversation(msg, account.orgId, contactId);

    const sentAt = new Date(msg.timestamp);

    // Dedup guard for self messages: if a self message with same content exists
    // in the last 30 seconds, this is likely a selfListen echo of a CRM-sent message
    if (msg.isSelf && msg.msgId) {
      const recentDupe = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          senderType: 'self',
          content: msg.content || '',
          sentAt: { gte: new Date(Date.now() - 30_000) },
        },
        select: { id: true, zaloMsgId: true },
      });
      if (recentDupe) {
        // If the existing record has no zaloMsgId, backfill it for future dedup
        if (!recentDupe.zaloMsgId && msg.msgId) {
          await prisma.message.update({
            where: { id: recentDupe.id },
            data: { zaloMsgId: msg.msgId },
          }).catch(() => {});
        }
        logger.debug(`[message-handler] Skipping self echo: content match within 30s`);
        return null;
      }
    }

    let message;
    try {
      message = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          zaloMsgId: msg.msgId || null,
          senderType: msg.isSelf ? 'self' : 'contact',
          senderUid: msg.senderUid,
          senderName: msg.senderName || null,
          content: msg.content || '',
          contentType: msg.contentType || 'text',
          attachments: msg.attachments ?? [],
          sentAt,
        },
      });
    } catch (err: any) {
      // P2002 = unique constraint violation → duplicate zaloMsgId, skip silently
      if (err?.code === 'P2002') {
        logger.debug(`[message-handler] Skipping duplicate zaloMsgId=${msg.msgId}`);
        return null;
      }
      throw err;
    }

    await updateConversationAfterMessage(conversation.id, sentAt, msg.isSelf);

    // Track first outbound contact date — set once when agent sends first message
    if (msg.isSelf && contactId) {
      prisma.contact.updateMany({
        where: { id: contactId, firstContactDate: null },
        data: { firstContactDate: new Date(msg.timestamp) },
      }).catch(() => {});
    }

    // Skip webhooks and automation for backfilled messages (old_messages / sync)
    if (msg.isBackfill) {
      return {
        message,
        conversationId: conversation.id,
        orgId: account.orgId,
        contactId,
      };
    }

    // Emit webhook for message event (fire-and-forget)
    emitWebhook(account.orgId, msg.isSelf ? 'message.sent' : 'message.received', {
      messageId: message.id,
      conversationId: conversation.id,
      senderUid: msg.senderUid,
      content: msg.content,
      contentType: msg.contentType,
      sentAt: message.sentAt,
    });

    if (!msg.isSelf) {
      const org = await prisma.organization.findUnique({
        where: { id: account.orgId },
        select: { id: true, name: true },
      });
      const contact = contactId
        ? await prisma.contact.findUnique({
            where: { id: contactId },
            select: { id: true, fullName: true, crmName: true, phone: true, status: true, source: true, assignedUserId: true, contactType: true },
          })
        : null;

      // Skip automation for non-customer contacts (internal staff, partners)
      if (contact && contact.contactType !== 'customer') {
        return {
          message,
          conversationId: conversation.id,
          orgId: account.orgId,
          contactId,
        };
      }
      const conversationDetails = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        select: { id: true, unreadCount: true, externalThreadId: true, threadType: true, zaloAccountId: true },
      });

      void runAutomationRules({
        trigger: 'message_received',
        orgId: account.orgId,
        org,
        contact,
        conversation: conversationDetails
          ? {
              id: conversationDetails.id,
              unreadCount: conversationDetails.unreadCount,
              threadId: conversationDetails.externalThreadId,
              threadType: conversationDetails.threadType,
              zaloAccountId: conversationDetails.zaloAccountId,
            }
          : null,
        message: { id: message.id, content: message.content, contentType: message.contentType, senderType: message.senderType },
      });
    }

    // Schedule AI lead-status detection (debounced 30s per contact).
    // Skip backfill (syncing old messages) and group chats (no individual lead).
    if (contactId && !msg.isBackfill && msg.threadType === 'user') {
      scheduleLeadStatusDetection(contactId, account.orgId);
    }

    return {
      message,
      conversationId: conversation.id,
      orgId: account.orgId,
      contactId,
    };
  } catch (err) {
    logger.error('[message-handler] handleIncomingMessage error:', err);
    return null;
  }
}

// Upsert contact — handles both user and group conversations.
// Uses orgId_zaloUid unique index to prevent race-condition duplicates.
async function upsertContact(msg: IncomingMessage, orgId: string): Promise<string | null> {
  if (msg.threadType === 'group') {
    const groupUid = msg.threadId;
    const desiredName = msg.groupName || 'Nhóm';

    const currentGroup = await prisma.contact.findUnique({
      where: { orgId_zaloUid: { orgId, zaloUid: groupUid } },
      select: { id: true, metadata: true, globalGroupId: true },
    });

    const nextMetadata: Record<string, unknown> = {
      ...((currentGroup?.metadata as Record<string, unknown>) || {}),
      isGroup: true,
    };
    if (msg.groupCreatedTime && !nextMetadata.groupCreatedAt) {
      nextMetadata.groupCreatedAt = new Date(msg.groupCreatedTime).toISOString();
    }

    // If this group is a new alias of an existing (already-tagged) group,
    // copy shared CRM fields over so both aliases stay in sync.
    let inheritedFields: Record<string, any> = {};
    if (msg.groupGlobalId && !currentGroup) {
      const sibling = await prisma.contact.findFirst({
        where: { orgId, globalGroupId: msg.groupGlobalId, isGroup: true },
        select: { source: true, assignedUserId: true, tags: true, status: true, notes: true },
      });
      if (sibling) {
        inheritedFields = {
          source: sibling.source,
          assignedUserId: sibling.assignedUserId,
          tags: sibling.tags as any,
          status: sibling.status,
          notes: sibling.notes,
        };
      }
    }

    const groupContact = await prisma.contact.upsert({
      where: { orgId_zaloUid: { orgId, zaloUid: groupUid } },
      create: {
        id: randomUUID(),
        orgId,
        zaloUid: groupUid,
        fullName: desiredName,
        isGroup: true,
        metadata: nextMetadata as any,
        globalGroupId: msg.groupGlobalId || null,
        ...inheritedFields,
      },
      update: {
        ...(msg.groupName ? { fullName: desiredName } : {}),
        metadata: nextMetadata as any,
        ...(msg.groupGlobalId && !currentGroup?.globalGroupId
          ? { globalGroupId: msg.groupGlobalId }
          : {}),
      },
      select: { id: true, fullName: true, createdAt: true, updatedAt: true },
    });

    // Emit webhook for new contact created (createdAt within last 5s = just created)
    if (Date.now() - groupContact.createdAt.getTime() < 5000 && Math.abs(groupContact.createdAt.getTime() - groupContact.updatedAt.getTime()) < 100) {
      emitWebhook(orgId, 'contact.created', { contactId: groupContact.id, fullName: groupContact.fullName });
    }
    return groupContact.id;
  }

  // User thread: contact is the thread partner
  const contactUid = msg.isSelf ? msg.threadId : msg.senderUid;
  const contactName = msg.isSelf ? '' : msg.senderName;
  const contactPhone = msg.isSelf ? '' : (msg.senderPhone || '');

  const existing = await prisma.contact.findUnique({
    where: { orgId_zaloUid: { orgId, zaloUid: contactUid } },
    select: { id: true, fullName: true, phone: true, status: true, lastActivity: true },
  });

  if (!existing) {
    try {
      const contact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: contactUid,
          fullName: contactName || 'Unknown',
          phone: contactPhone || null,
          isGroup: false,
        },
        select: { id: true, fullName: true },
      });
      emitWebhook(orgId, 'contact.created', { contactId: contact.id, fullName: contact.fullName });
      return contact.id;
    } catch (err: any) {
      // Another concurrent worker inserted the same (orgId, zaloUid) — re-read and return.
      if (err?.code === 'P2002') {
        const row = await prisma.contact.findUnique({
          where: { orgId_zaloUid: { orgId, zaloUid: contactUid } },
          select: { id: true },
        });
        return row?.id || null;
      }
      throw err;
    }
  }

  const updates: { fullName?: string; phone?: string } = {};
  if (contactName && existing.fullName !== contactName && existing.fullName === 'Unknown') {
    updates.fullName = contactName;
  }
  if (contactPhone && !existing.phone) {
    updates.phone = contactPhone;
  }
  if (Object.keys(updates).length > 0) {
    await prisma.contact.update({ where: { id: existing.id }, data: updates });
  }

  // 1. Lead activation logic: Only mark as 'new' if they message on/after 2026-04-30
  // and they are NOT a group. This treats them as a fresh lead for the new period.
  const resetThreshold = new Date('2026-04-30T00:01:00Z');
  const msgTime = new Date(msg.timestamp);

  if (msg.threadType === 'user' && msgTime >= resetThreshold) {
    // If contact was inactive before today or has no status, reset to 'new'
    if (!existing.status || (existing.lastActivity && existing.lastActivity < resetThreshold)) {
      if (existing.status !== 'converted') {
        await prisma.contact.update({
          where: { id: existing.id },
          data: { status: 'new' },
        });
      }
    }
  }

  return existing.id;
}

// Find or create conversation — externalThreadId = threadId for both user and group
async function findOrCreateConversation(
  msg: IncomingMessage,
  orgId: string,
  contactId: string | null,
) {
  const externalThreadId = msg.threadId;

  const existing = await prisma.conversation.findFirst({
    where: { zaloAccountId: msg.accountId, externalThreadId },
    select: { id: true },
  });

  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloAccountId: msg.accountId,
      contactId: msg.threadType === 'user' ? contactId : contactId,
      threadType: msg.threadType,
      externalThreadId,
      lastMessageAt: new Date(msg.timestamp),
      unreadCount: msg.isSelf ? 0 : 1,
      isReplied: msg.isSelf,
    },
    select: { id: true },
  });
}

// Update conversation metadata after a new message
async function updateConversationAfterMessage(
  conversationId: string,
  sentAt: Date,
  isSelf: boolean,
): Promise<void> {
  const updateData: any = { lastMessageAt: sentAt };
  if (isSelf) {
    updateData.isReplied = true;
    updateData.unreadCount = 0;
  } else {
    updateData.unreadCount = { increment: 1 };
    updateData.isReplied = false;
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: updateData });
}

// Soft-delete a message by its Zalo message ID
export async function handleMessageUndo(accountId: string, zaloMsgId: string): Promise<void> {
  try {
    await prisma.message.updateMany({
      where: { zaloMsgId: String(zaloMsgId) },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    logger.info(`[message-handler] Undo message ${zaloMsgId} for account ${accountId}`);
  } catch (err) {
    logger.error('[message-handler] handleMessageUndo error:', err);
  }
}
