/**
 * push-routes.ts — API endpoints để quản lý Web Push subscriptions.
 *
 * POST /api/v1/push/subscribe    — lưu subscription mới
 * DELETE /api/v1/push/subscribe  — xoá subscription (unsubscribe)
 * GET  /api/v1/push/vapid-key    — trả về VAPID public key cho frontend
 * GET  /api/v1/push/subscriptions — liệt kê thiết bị đang subscribe (của user hiện tại)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // Public — frontend cần VAPID public key trước khi login để init SW
  app.get('/api/v1/push/vapid-key', async (_request, reply) => {
    if (!config.vapidPublicKey) {
      return reply.status(503).send({ error: 'Web Push not configured on server' });
    }
    return { publicKey: config.vapidPublicKey };
  });

  // Các route dưới cần auth
  app.addHook('preHandler', authMiddleware);

  /**
   * POST /api/v1/push/subscribe
   * Body: { endpoint, keys: { p256dh, auth } }
   */
  app.post('/api/v1/push/subscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return reply.status(400).send({ error: 'endpoint, keys.p256dh và keys.auth là bắt buộc' });
      }

      const userAgent = (request.headers['user-agent'] || '').slice(0, 255);

      // Upsert — nếu endpoint đã tồn tại thì cập nhật keys (refresh)
      await prisma.pushSubscription.upsert({
        where: { endpoint: body.endpoint },
        create: {
          orgId: user.orgId,
          userId: user.id,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
        },
        update: {
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
        },
      });

      logger.info(`[push] Subscription saved for user=${user.id}`);
      return reply.status(201).send({ ok: true });
    } catch (err) {
      logger.error('[push] Subscribe error:', err);
      return reply.status(500).send({ error: 'Không thể lưu subscription' });
    }
  });

  /**
   * DELETE /api/v1/push/subscribe
   * Body: { endpoint }
   */
  app.delete('/api/v1/push/subscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as { endpoint?: string };

      if (!body.endpoint) {
        return reply.status(400).send({ error: 'endpoint là bắt buộc' });
      }

      await prisma.pushSubscription.deleteMany({
        where: { endpoint: body.endpoint, userId: user.id },
      });

      return { ok: true };
    } catch (err) {
      logger.error('[push] Unsubscribe error:', err);
      return reply.status(500).send({ error: 'Không thể xoá subscription' });
    }
  });

  /**
   * GET /api/v1/push/subscriptions
   * Trả về danh sách thiết bị đang bật thông báo của user hiện tại.
   */
  app.get('/api/v1/push/subscriptions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const subs = await prisma.pushSubscription.findMany({
        where: { userId: user.id },
        select: { id: true, userAgent: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return { subscriptions: subs };
    } catch (err) {
      logger.error('[push] List subscriptions error:', err);
      return reply.status(500).send({ error: 'Không thể lấy danh sách' });
    }
  });
}
