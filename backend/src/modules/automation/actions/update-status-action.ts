import { prisma } from '../../../shared/database/prisma-client.js';
import { computeConvertedAtDelta } from '../../../shared/utils/contact-status.js';
import { logStatusChange } from '../../../shared/utils/status-logger.js';

export async function updateStatusAction(contactId: string, status: string) {
  const current = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { status: true, orgId: true },
  });
  const result = await prisma.contact.update({
    where: { id: contactId },
    data: { status, ...computeConvertedAtDelta(status, current?.status) },
  });

  if (current && status !== current.status) {
    await logStatusChange({
      contactId,
      orgId: current.orgId,
      fromStatus: current.status,
      toStatus: status,
      userId: null, // automation has no user
    });
  }

  return result;
}
