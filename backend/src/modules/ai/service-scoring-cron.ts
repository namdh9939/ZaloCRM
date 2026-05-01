/**
 * service-scoring-cron.ts — Cron tự động chấm Điểm Phục Vụ hằng ngày.
 * Chạy 23:00 UTC = 06:00 giờ Việt Nam, lặp qua tất cả org có AI bật.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { batchScoreConversations } from './service-scoring.js';

async function runDailyServiceScoring(): Promise<void> {
  const enabledConfigs = await prisma.aiConfig.findMany({
    where: { enabled: true },
    select: { orgId: true },
  });

  for (const cfg of enabledConfigs) {
    try {
      const result = await batchScoreConversations({
        orgId: cfg.orgId,
        maxAgeHours: 24,
        activeWithinHours: 48,
        batchLimit: 100,
        providerOverride: 'gemini',
        modelOverride: 'gemini-3-flash',
      });
      logger.info(
        `[service-scoring-cron] org=${cfg.orgId} processed=${result.processed} errors=${result.errors}`,
      );
    } catch (err) {
      logger.error(`[service-scoring-cron] Failed org=${cfg.orgId}:`, err);
    }
  }
}

export function startServiceScoringCron(): void {
  // 23:00 UTC = 06:00 giờ Việt Nam (UTC+7)
  cron.schedule('0 23 * * *', async () => {
    logger.info('[service-scoring-cron] Daily run started');
    try {
      await runDailyServiceScoring();
      logger.info('[service-scoring-cron] Daily run completed');
    } catch (err) {
      logger.error('[service-scoring-cron] Cron error:', err);
    }
  });
  logger.info('[service-scoring-cron] Started (daily 23:00 UTC = 06:00 Vietnam)');
}
