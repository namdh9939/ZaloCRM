/**
 * Member-scope helper — visibility filters based on customer assignment.
 *
 * Model (option A — single assignee per contact):
 *  - Owner/admin: full access (helper returns {} — no filter).
 *  - Member: sees only contacts where `assignedUserId = user.id`.
 *    Unassigned contacts are invisible to members.
 */
import { prisma } from '../database/prisma-client.js';

export function isPrivilegedRole(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * For queries on the Contact model. Merge into existing `where`:
 *   const where = { orgId, ...memberContactScope(user) };
 */
export function memberContactScope(user: { id: string; role: string }): Record<string, unknown> {
  if (isPrivilegedRole(user.role)) return {};
  return { assignedUserId: user.id };
}

/**
 * For models with a `contact` relation (Conversation, Appointment):
 *   const where = { orgId, ...memberScopeViaContact(user) };
 */
export function memberScopeViaContact(user: { id: string; role: string }): Record<string, unknown> {
  if (isPrivilegedRole(user.role)) return {};
  return { contact: { assignedUserId: user.id } };
}

/**
 * Legacy — Zalo-account-access list. Kept for endpoints that still gate by
 * "can this member interact with this Zalo account at all" (e.g. listing
 * Zalo accounts the member can see in dropdowns). Returns null for owner/admin.
 */
export async function getAccessibleZaloAccountIds(
  userId: string,
  role: string,
): Promise<string[] | null> {
  if (isPrivilegedRole(role)) return null;
  const rows = await prisma.zaloAccountAccess.findMany({
    where: { userId },
    select: { zaloAccountId: true },
  });
  return rows.map((r) => r.zaloAccountId);
}
