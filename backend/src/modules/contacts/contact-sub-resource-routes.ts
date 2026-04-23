/**
 * contact-sub-resource-routes.ts — Sub-resource endpoints for contacts.
 * Provides appointments scoped to a specific contact.
 * All routes require JWT auth and are scoped to the user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { memberContactScope } from '../../shared/utils/member-scope.js';

export async function contactSubResourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts/:id/appointments — appointments for contact ───────
  app.get('/api/v1/contacts/:id/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      // Member scope — must have contact assigned to them.
      const owned = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId, ...memberContactScope(user) },
        select: { id: true },
      });
      if (!owned) return reply.status(404).send({ error: 'Contact not found' });

      const appointments = await prisma.appointment.findMany({
        where: { contactId: id, orgId: user.orgId },
        orderBy: { appointmentDate: 'desc' },
        take: 20,
      });

      return { appointments };
    } catch (err) {
      logger.error('[contacts] Appointments by contact error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });
}
