/**
 * Log a contact status transition to ContactStatusHistory.
 * Called from every code path that changes contact.status so that:
 *  - Weekly reports can compute "time spent in stage X"
 *  - Conversion funnel reports can compute drop-off rates per stage
 *  - Audit trail for who changed what
 *
 * Fire-and-forget (await optional) — failures are logged but don't block the caller.
 */
import { prisma } from '../database/prisma-client.js';
import { logger } from './logger.js';
import type { Server } from 'socket.io';

let io: Server | null = null;
export function setStatusLoggerIo(socketIo: Server): void {
  io = socketIo;
}

export async function logStatusChange(params: {
  contactId: string;
  orgId: string;
  fromStatus: string | null | undefined;
  toStatus: string | null | undefined;
  userId?: string | null;
}): Promise<void> {
  const { contactId, orgId, fromStatus, toStatus, userId } = params;
  if (!toStatus || toStatus === fromStatus) return;

  try {
    await prisma.contactStatusHistory.create({
      data: {
        contactId,
        orgId,
        fromStatus: fromStatus || null,
        toStatus,
        changedByUserId: userId || null,
      },
    });

    if (io) {
      io.emit('contact:status-changed', {
        contactId,
        orgId,
        fromStatus: fromStatus || null,
        toStatus,
      });
    }
  } catch (err) {
    logger.warn(`[status-logger] Failed to log status change for ${contactId}:`, err);
  }
}
