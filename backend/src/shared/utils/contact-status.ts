/**
 * Compute the `convertedAt` delta for a Contact status transition.
 *
 * Rules:
 *  - Status transitioning TO 'converted': stamp with the user-supplied date
 *    (`providedConvertedAt`) if given, else with the current time.
 *  - Status transitioning AWAY from 'converted': clear (null).
 *  - Status stays 'converted' and user supplied a date: overwrite with it
 *    (supports manual back-/forward-dating).
 *  - Otherwise: leave untouched (returns {}).
 *
 * Merge the returned fragment into your Prisma update `data`:
 *   data: { status, ...computeConvertedAtDelta(newStatus, current.status, body.convertedAt) }
 */
export function computeConvertedAtDelta(
  newStatus: string | null | undefined,
  currentStatus: string | null | undefined,
  providedConvertedAt?: string | Date | null,
): { convertedAt?: Date | null } {
  const hasProvided = providedConvertedAt !== undefined;
  const toDate = (v: string | Date | null | undefined): Date | null => {
    if (!v) return null;
    const d = typeof v === 'string' ? new Date(v) : v;
    return isNaN(d.getTime()) ? null : d;
  };

  // Status changed TO converted — stamp with provided date or now
  if (newStatus === 'converted' && currentStatus !== 'converted') {
    return { convertedAt: hasProvided ? toDate(providedConvertedAt) : new Date() };
  }
  // Status changed AWAY from converted — always clear
  if (newStatus && newStatus !== 'converted' && currentStatus === 'converted') {
    return { convertedAt: null };
  }
  // Status stays converted — respect user's manual date if provided
  if (newStatus === 'converted' && hasProvided) {
    return { convertedAt: toDate(providedConvertedAt) };
  }
  return {};
}
