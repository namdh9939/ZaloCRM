/**
 * weekly-report-routes.ts — Manager-focused weekly and monthly reports.
 * Both use the same 4 metric sections (team conversion, stage bottleneck,
 * lost reasons, interaction quality) with different date ranges. Monthly
 * additionally includes a per-week trend chart data.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { isPrivilegedRole } from '../../shared/utils/member-scope.js';
import {
  buildTeamConversion,
  buildStageBottleneck,
  buildLostReasons,
  buildInteractionQuality,
  buildWeeklyTrend,
} from './manager-report-helpers.js';

type QueryParams = Record<string, string>;

function resolveWeek(weekOf: string | undefined): { start: Date; end: Date } {
  const pivot = weekOf ? new Date(weekOf + 'T00:00:00') : new Date();
  if (isNaN(pivot.getTime())) return resolveWeek(undefined);
  const day = pivot.getDay();
  const offsetFromMonday = (day + 6) % 7;
  const start = new Date(pivot);
  start.setDate(start.getDate() - offsetFromMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

// monthOf = 'YYYY-MM' OR any day string — snaps to the 1st of that month.
function resolveMonth(monthOf: string | undefined): { start: Date; end: Date } {
  const raw = monthOf || new Date().toISOString().slice(0, 7);
  const match = /^(\d{4})-(\d{2})/.exec(raw);
  if (!match) return resolveMonth(undefined);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

export async function weeklyReportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/reports/weekly?weekOf=YYYY-MM-DD
  app.get('/api/v1/reports/weekly', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId, id: userId, role } = request.user!;
      const { weekOf } = request.query as QueryParams;
      const { start, end } = resolveWeek(weekOf);
      const memberUid = isPrivilegedRole(role) ? '' : userId;

      const [teamConversion, stageBottleneck, lostReasons, interactionQuality] = await Promise.all([
        buildTeamConversion(orgId, start, end, memberUid),
        buildStageBottleneck(orgId, memberUid),
        buildLostReasons(orgId, start, end, memberUid),
        buildInteractionQuality(orgId, start, end, memberUid),
      ]);

      return {
        weekStart: start.toISOString().slice(0, 10),
        weekEnd: new Date(end.getTime() - 1).toISOString().slice(0, 10),
        teamConversion,
        stageBottleneck,
        lostReasons,
        interactionQuality,
      };
    } catch (err) {
      logger.error('[reports] Weekly report error:', err);
      return reply.status(500).send({ error: 'Failed to build weekly report' });
    }
  });

  // GET /api/v1/reports/monthly?monthOf=YYYY-MM
  app.get('/api/v1/reports/monthly', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId, id: userId, role } = request.user!;
      const { monthOf } = request.query as QueryParams;
      const { start, end } = resolveMonth(monthOf);
      const memberUid = isPrivilegedRole(role) ? '' : userId;

      const [teamConversion, stageBottleneck, lostReasons, interactionQuality, weeklyTrend] = await Promise.all([
        buildTeamConversion(orgId, start, end, memberUid),
        buildStageBottleneck(orgId, memberUid),
        buildLostReasons(orgId, start, end, memberUid),
        buildInteractionQuality(orgId, start, end, memberUid),
        buildWeeklyTrend(orgId, start, end, memberUid),
      ]);

      return {
        monthStart: start.toISOString().slice(0, 10),
        monthEnd: new Date(end.getTime() - 1).toISOString().slice(0, 10),
        teamConversion,
        stageBottleneck,
        lostReasons,
        interactionQuality,
        weeklyTrend,
      };
    } catch (err) {
      logger.error('[reports] Monthly report error:', err);
      return reply.status(500).send({ error: 'Failed to build monthly report' });
    }
  });
}
