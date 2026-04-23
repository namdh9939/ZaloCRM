/**
 * manager-report-helpers.ts — 4 metric builders shared between weekly and
 * monthly manager reports. Each builder takes (orgId, dateRange, memberFilter)
 * and returns a formatted section.
 */
import { prisma } from '../../shared/database/prisma-client.js';

export const STATUS_LABELS: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

export const LOST_REASON_LABELS: Record<string, string> = {
  price: 'Giá cao',
  not_ready: 'Chưa sẵn sàng / chưa có nhu cầu',
  competitor: 'Chọn đối thủ',
  not_fit: 'Không hợp nhu cầu',
  lost_contact: 'Mất liên lạc',
  other: 'Khác',
};

// ── 1. Team conversion funnel per sale ────────────────────────────────────────
export async function buildTeamConversion(
  orgId: string, start: Date, end: Date, memberUid: string,
) {
  const rows = await prisma.$queryRaw<Array<{
    user_id: string; full_name: string; role: string;
    leads_received: bigint; leads_advised: bigint; leads_converted: bigint;
  }>>`
    SELECT
      u.id AS user_id, u.full_name, u.role,
      COUNT(c.id) FILTER (WHERE c.created_at >= ${start} AND c.created_at < ${end}) AS leads_received,
      COUNT(c.id) FILTER (WHERE c.created_at >= ${start} AND c.created_at < ${end}
                          AND c.status IN ('contacted','interested','converted','lost')) AS leads_advised,
      COUNT(c.id) FILTER (WHERE c.created_at >= ${start} AND c.created_at < ${end}
                          AND c.status = 'converted') AS leads_converted
    FROM users u
    LEFT JOIN contacts c ON c.assigned_user_id = u.id AND c.merged_into IS NULL AND c.is_group = false
    WHERE u.org_id = ${orgId}
      AND (${memberUid}::text = '' OR u.id = ${memberUid})
    GROUP BY u.id, u.full_name, u.role
    HAVING COUNT(c.id) FILTER (WHERE c.created_at >= ${start} AND c.created_at < ${end}) > 0
       OR ${memberUid}::text = ''
    ORDER BY leads_converted DESC, leads_received DESC
  `;

  return rows.map((r) => {
    const received = Number(r.leads_received);
    const advised = Number(r.leads_advised);
    const converted = Number(r.leads_converted);
    return {
      userId: r.user_id,
      fullName: r.full_name,
      role: r.role,
      leadsReceived: received,
      leadsAdvised: advised,
      leadsConverted: converted,
      reachRate: received === 0 ? null : Math.round((advised / received) * 100),
      closeRate: advised === 0 ? null : Math.round((converted / advised) * 100),
    };
  });
}

// ── 2. Stage bottleneck — current snapshot of time-in-stage ───────────────────
export async function buildStageBottleneck(orgId: string, memberUid: string) {
  const rows = await prisma.$queryRaw<Array<{
    status: string | null; count: bigint; avg_days: number | null; max_days: number | null;
  }>>`
    WITH latest_change AS (
      SELECT DISTINCT ON (contact_id) contact_id, changed_at
      FROM contact_status_history
      WHERE org_id = ${orgId}
      ORDER BY contact_id, changed_at DESC
    )
    SELECT
      c.status,
      COUNT(*)::bigint AS count,
      AVG(EXTRACT(EPOCH FROM (NOW() - lc.changed_at)) / 86400) AS avg_days,
      MAX(EXTRACT(EPOCH FROM (NOW() - lc.changed_at)) / 86400) AS max_days
    FROM contacts c
    LEFT JOIN latest_change lc ON lc.contact_id = c.id
    WHERE c.org_id = ${orgId}
      AND c.merged_into IS NULL
      AND c.is_group = false
      AND c.status IS NOT NULL
      AND (${memberUid}::text = '' OR c.assigned_user_id = ${memberUid})
    GROUP BY c.status
    ORDER BY CASE c.status
      WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'interested' THEN 3
      WHEN 'converted' THEN 4 WHEN 'lost' THEN 5 ELSE 99
    END
  `;

  return rows.map((r) => ({
    status: r.status,
    label: STATUS_LABELS[r.status ?? ''] ?? r.status ?? '',
    count: Number(r.count),
    avgDaysInStage: r.avg_days !== null ? Math.round(Number(r.avg_days) * 10) / 10 : null,
    maxDaysInStage: r.max_days !== null ? Math.round(Number(r.max_days) * 10) / 10 : null,
  }));
}

// ── 3. Top lost reasons in the period ─────────────────────────────────────────
export async function buildLostReasons(
  orgId: string, start: Date, end: Date, memberUid: string,
) {
  const rows = await prisma.$queryRaw<Array<{ reason: string | null; count: bigint }>>`
    SELECT lost_reason AS reason, COUNT(*)::bigint AS count
    FROM contacts
    WHERE org_id = ${orgId}
      AND status = 'lost'
      AND updated_at >= ${start}
      AND updated_at < ${end}
      AND is_group = false
      AND (${memberUid}::text = '' OR assigned_user_id = ${memberUid})
    GROUP BY lost_reason
    ORDER BY count DESC
  `;

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return rows.map((r) => {
    const count = Number(r.count);
    return {
      reason: r.reason ?? 'unspecified',
      label: r.reason ? (LOST_REASON_LABELS[r.reason] ?? r.reason) : 'Chưa ghi chú',
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
}

// ── 4. Interaction quality — reply time, dead chats, proactive rate ───────────
export async function buildInteractionQuality(
  orgId: string, start: Date, end: Date, memberUid: string,
) {
  const [replyTimes, deadRows, proactiveRows] = await Promise.all([
    prisma.$queryRaw<Array<{ user_id: string; avg_minutes: number | null }>>`
      WITH pairs AS (
        SELECT
          c.assigned_user_id AS user_id,
          m.sent_at AS contact_sent_at,
          LEAD(m.sent_at) OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS next_sent_at,
          LEAD(m.sender_type) OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS next_sender
        FROM messages m
        JOIN conversations conv ON conv.id = m.conversation_id
        JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.org_id = ${orgId}
          AND m.sender_type = 'contact'
          AND m.sent_at >= ${start} AND m.sent_at < ${end}
          AND c.is_group = false AND c.assigned_user_id IS NOT NULL
          AND (${memberUid}::text = '' OR c.assigned_user_id = ${memberUid})
      )
      SELECT user_id, AVG(EXTRACT(EPOCH FROM (next_sent_at - contact_sent_at)) / 60) AS avg_minutes
      FROM pairs
      WHERE next_sender = 'self' AND next_sent_at IS NOT NULL
      GROUP BY user_id
    `,
    prisma.$queryRaw<Array<{ user_id: string; dead_count: bigint }>>`
      SELECT c.assigned_user_id AS user_id, COUNT(*)::bigint AS dead_count
      FROM conversations conv
      JOIN contacts c ON c.id = conv.contact_id
      WHERE conv.org_id = ${orgId}
        AND conv.is_replied = false
        AND conv.last_message_at < NOW() - INTERVAL '24 hours'
        AND c.is_group = false AND c.assigned_user_id IS NOT NULL
        AND (${memberUid}::text = '' OR c.assigned_user_id = ${memberUid})
      GROUP BY c.assigned_user_id
    `,
    prisma.$queryRaw<Array<{ user_id: string; total_self: bigint; proactive_self: bigint }>>`
      WITH sale_msgs AS (
        SELECT
          c.assigned_user_id AS user_id,
          LAG(m.sender_type) OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS prev_sender
        FROM messages m
        JOIN conversations conv ON conv.id = m.conversation_id
        JOIN contacts c ON c.id = conv.contact_id
        WHERE conv.org_id = ${orgId}
          AND m.sender_type = 'self'
          AND m.sent_at >= ${start} AND m.sent_at < ${end}
          AND c.is_group = false AND c.assigned_user_id IS NOT NULL
          AND (${memberUid}::text = '' OR c.assigned_user_id = ${memberUid})
      )
      SELECT user_id,
             COUNT(*)::bigint AS total_self,
             COUNT(*) FILTER (WHERE prev_sender = 'self')::bigint AS proactive_self
      FROM sale_msgs GROUP BY user_id
    `,
  ]);

  const userIds = Array.from(new Set([
    ...replyTimes.map((r) => r.user_id),
    ...deadRows.map((r) => r.user_id),
    ...proactiveRows.map((r) => r.user_id),
  ].filter(Boolean)));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, orgId },
        select: { id: true, fullName: true },
      })
    : [];

  const userMap = new Map<string, {
    userId: string; fullName: string;
    avgReplyMinutes: number | null; deadConversations: number; proactiveRate: number | null;
  }>();
  for (const u of users) {
    userMap.set(u.id, {
      userId: u.id, fullName: u.fullName,
      avgReplyMinutes: null, deadConversations: 0, proactiveRate: null,
    });
  }
  for (const r of replyTimes) {
    const e = userMap.get(r.user_id);
    if (e && r.avg_minutes !== null) e.avgReplyMinutes = Math.round(Number(r.avg_minutes));
  }
  for (const r of deadRows) {
    const e = userMap.get(r.user_id);
    if (e) e.deadConversations = Number(r.dead_count);
  }
  for (const r of proactiveRows) {
    const e = userMap.get(r.user_id);
    if (e) {
      const total = Number(r.total_self);
      const proactive = Number(r.proactive_self);
      e.proactiveRate = total === 0 ? null : Math.round((proactive / total) * 100);
    }
  }
  return Array.from(userMap.values());
}

// ── 5. Weekly trend (for monthly report) — 1 data point per week ──────────────
export async function buildWeeklyTrend(
  orgId: string, monthStart: Date, monthEnd: Date, memberUid: string,
) {
  const rows = await prisma.$queryRaw<Array<{ week_start: Date; leads: bigint; converted: bigint }>>`
    SELECT
      DATE_TRUNC('week', c.created_at) AS week_start,
      COUNT(*)::bigint AS leads,
      COUNT(*) FILTER (WHERE c.converted_at >= ${monthStart} AND c.converted_at < ${monthEnd})::bigint AS converted
    FROM contacts c
    WHERE c.org_id = ${orgId}
      AND c.is_group = false
      AND c.merged_into IS NULL
      AND c.created_at >= ${monthStart}
      AND c.created_at < ${monthEnd}
      AND (${memberUid}::text = '' OR c.assigned_user_id = ${memberUid})
    GROUP BY DATE_TRUNC('week', c.created_at)
    ORDER BY week_start ASC
  `;
  return rows.map((r) => ({
    weekStart: r.week_start.toISOString().slice(0, 10),
    leads: Number(r.leads),
    converted: Number(r.converted),
  }));
}
