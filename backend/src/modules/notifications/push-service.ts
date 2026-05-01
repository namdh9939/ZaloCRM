/**
 * push-service.ts — Web Push (VAPID) notification service.
 *
 * Flow khi có tin nhắn Zalo mới:
 *   1. zalo-listener-factory.ts gọi sendPushToOrgUsers(orgId, payload)
 *   2. Lấy tất cả PushSubscription của org từ DB
 *   3. Gửi push tới từng subscription
 *   4. Nếu subscription hết hạn (410/404) → xoá khỏi DB
 */
import webpush from 'web-push';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

let vapidConfigured = false;

export function initWebPush(): void {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    logger.warn('[push] VAPID keys not configured — Web Push disabled. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to .env');
    return;
  }
  webpush.setVapidDetails(
    config.vapidEmail,
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
  vapidConfigured = true;
  logger.info('[push] Web Push initialized');
}

export function isWebPushEnabled(): boolean {
  return vapidConfigured;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;        // nhóm notification cùng loại (ví dụ: conversationId)
  data?: Record<string, unknown>;
}

/**
 * Gửi push notification tới tất cả thiết bị của một user cụ thể.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!vapidConfigured) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return;

  const payloadStr = JSON.stringify(payload);
  const expiredIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
      } catch (err: any) {
        // 404/410 = subscription không còn hợp lệ → xoá
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expiredIds.push(sub.id);
          logger.debug(`[push] Subscription expired, removing: ${sub.id}`);
        } else {
          logger.warn(`[push] Failed to send to subscription ${sub.id}:`, err?.message);
        }
      }
    }),
  );

  if (expiredIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
  }
}

/**
 * Gửi push tới tất cả user trong org (dùng khi không biết cụ thể user nào cần nhận).
 * orgId + optional userId filter (ví dụ: chỉ gửi cho assignedUserId của contact).
 */
export async function sendPushToOrgUsers(
  orgId: string,
  payload: PushPayload,
  options?: { userIds?: string[] },
): Promise<void> {
  if (!vapidConfigured) return;

  const where: any = { orgId };
  if (options?.userIds && options.userIds.length > 0) {
    where.userId = { in: options.userIds };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where,
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return;

  const payloadStr = JSON.stringify(payload);
  const expiredIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expiredIds.push(sub.id);
        } else {
          logger.warn(`[push] Send error for sub ${sub.id}:`, err?.message);
        }
      }
    }),
  );

  if (expiredIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
  }
}
