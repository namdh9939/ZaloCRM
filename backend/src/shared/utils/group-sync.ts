/**
 * When a group contact is updated, propagate "shared" CRM fields to all
 * other contacts that represent the same real Zalo group (same globalGroupId).
 *
 * Reason: 1 real group can appear in multiple Zalo accounts — each seeing
 * it under a different threadId. We keep them as separate Contact rows
 * (to preserve per-account conversation links), but the CRM-level labelling
 * must be identical.
 *
 * Fields that propagate: source, assignedUserId, tags, status, notes.
 * Fields that stay local: fullName (per-account display), metadata, zaloUid.
 */
import { prisma } from '../database/prisma-client.js';

const SHARED_FIELDS = [
  'source',
  'assignedUserId',
  'tags',
  'status',
  'notes',
] as const;

type SharedFieldName = (typeof SHARED_FIELDS)[number];

export async function propagateGroupUpdate(
  contactId: string,
  orgId: string,
  updateData: Record<string, unknown>,
): Promise<number> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: { globalGroupId: true, isGroup: true },
  });
  if (!contact?.isGroup || !contact.globalGroupId) return 0;

  const sharedPayload: Record<string, unknown> = {};
  for (const key of SHARED_FIELDS) {
    if (key in updateData) sharedPayload[key] = updateData[key as SharedFieldName];
  }
  if (Object.keys(sharedPayload).length === 0) return 0;

  const result = await prisma.contact.updateMany({
    where: {
      orgId,
      globalGroupId: contact.globalGroupId,
      isGroup: true,
      id: { not: contactId },
    },
    data: sharedPayload as any,
  });
  return result.count;
}
