/**
 * service-scoring.ts — Chấm điểm Phục Vụ (Service Quality Score) cho từng hội thoại.
 *
 * Flow:
 *   1. Load messages của conversation (tối đa 100 tin gần nhất).
 *   2. Gọi AI với prompt service-score để nhận JSON kết quả.
 *   3. Lưu kết quả vào conversations.service_score / service_label / ...
 *   4. Cập nhật denormalized cache trên contacts.service_score / service_label.
 *   5. Nếu managerActionRequired = true → emit socket event cho admin.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getAiConfig } from './ai-service.js';
import { buildServiceScorePrompt } from './prompts/service-score.js';
import { getProviderConfig } from './provider-registry.js';
import { generateWithAnthropic } from './providers/anthropic.js';
import { generateWithGemini } from './providers/gemini.js';
import { generateWithOpenaiCompat } from './providers/openai-compat.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServiceScoreResult {
  serviceScore: number | null;
  serviceLabel: 'success' | 'info' | 'warning' | 'error' | null;
  attitudeAnalysis: {
    isPolite: boolean;
    hasEmpathy: boolean;
    hasFatalError: boolean;
  };
  deductions: string[];
  bonuses: string[];
  managerActionRequired: boolean;
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapScoreToLabel(score: number): 'success' | 'info' | 'warning' | 'error' {
  if (score >= 85) return 'success';
  if (score >= 70) return 'info';
  if (score >= 50) return 'warning';
  return 'error';
}

function sanitizeResult(raw: Partial<ServiceScoreResult>): ServiceScoreResult {
  const score = typeof raw.serviceScore === 'number'
    ? Math.max(0, Math.min(100, raw.serviceScore))
    : null;

  const label = score !== null
    ? mapScoreToLabel(score)
    : null;

  const hasFatal = raw.attitudeAnalysis?.hasFatalError ?? false;
  const managerRequired = (score !== null && score < 50) || hasFatal || (raw.managerActionRequired ?? false);

  return {
    serviceScore: score,
    serviceLabel: label,
    attitudeAnalysis: {
      isPolite: raw.attitudeAnalysis?.isPolite ?? true,
      hasEmpathy: raw.attitudeAnalysis?.hasEmpathy ?? false,
      hasFatalError: hasFatal,
    },
    deductions: Array.isArray(raw.deductions) ? raw.deductions : [],
    bonuses: Array.isArray(raw.bonuses) ? raw.bonuses : [],
    managerActionRequired: managerRequired,
    summary: raw.summary || 'Không có tóm tắt.',
  };
}

async function getProviderApiKey(orgId: string, provider: string): Promise<string> {
  const providerDef = getProviderConfig(provider);
  if (providerDef?.authToken) return providerDef.authToken;
  const setting = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: `ai_${provider}_api_key` },
  });
  return setting?.valuePlain || '';
}

async function callAi(
  provider: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
): Promise<string> {
  const providerDef = getProviderConfig(provider);
  const baseUrl = providerDef?.baseUrl || '';
  if (provider === 'anthropic') return generateWithAnthropic(baseUrl, apiKey, model, system, prompt);
  if (provider === 'gemini') return generateWithGemini(baseUrl, apiKey, model, system, prompt);
  if (provider === 'openai') return generateWithOpenaiCompat(`${baseUrl}/v1/chat/completions`, apiKey, model, system, prompt);
  if (provider === 'qwen') return generateWithOpenaiCompat(`${baseUrl}/compatible-mode/v1/chat/completions`, apiKey, model, system, prompt);
  if (provider === 'kimi') return generateWithOpenaiCompat(`${baseUrl}/v1/chat/completions`, apiKey, model, system, prompt);
  throw new Error(`Unsupported AI provider: ${provider}`);
}

// ── Core scoring function ─────────────────────────────────────────────────────

export interface ScoreOptions {
  providerOverride?: string;
  modelOverride?: string;
}

export async function scoreConversation(
  conversationId: string,
  orgId: string,
  options?: ScoreOptions,
): Promise<ServiceScoreResult> {
  // 1. Load conversation + messages
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    include: {
      contact: { select: { id: true, fullName: true } },
      messages: {
        where: { isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: 100,
        select: { senderType: true, senderName: true, content: true, sentAt: true },
      },
    },
  });

  if (!conversation) throw new Error('Conversation not found');

  const messages = [...conversation.messages].reverse();

  // 2. Đếm tin nhắn của nhân viên
  const staffMessages = messages.filter((m) => m.senderType === 'self');
  if (staffMessages.length < 3) {
    // Không đủ dữ liệu — trả về null score, không gọi AI
    const result: ServiceScoreResult = {
      serviceScore: null,
      serviceLabel: null,
      attitudeAnalysis: { isPolite: true, hasEmpathy: false, hasFatalError: false },
      deductions: [],
      bonuses: [],
      managerActionRequired: false,
      summary: 'Không đủ dữ liệu để đánh giá (cần ít nhất 3 tin nhắn của nhân viên).',
    };
    await persistScore(conversationId, conversation.contactId, result);
    return result;
  }

  // 3. Build prompt context
  const contextLines = messages.map((msg) => {
    const author = msg.senderType === 'self' ? 'staff' : (msg.senderName || 'customer');
    const content = (msg.content || '(empty)').replace(/<\/?conversation_context>/gi, '');
    return `[${msg.sentAt.toISOString()}] ${author}: ${content}`;
  });

  const userPrompt = [
    `<conversation_context>`,
    `Customer: ${conversation.contact?.fullName || 'Khách hàng'}`,
    contextLines.join('\n'),
    `</conversation_context>`,
  ].join('\n');

  // 4. Gọi AI
  const aiConfig = await getAiConfig(orgId);
  if (!aiConfig.enabled) throw new Error('AI is disabled for this organization');

  const provider = options?.providerOverride || aiConfig.provider;
  const model = options?.modelOverride || aiConfig.model;

  const apiKey = await getProviderApiKey(orgId, provider);
  if (!apiKey) throw new Error('AI provider key is not configured');

  const systemPrompt = buildServiceScorePrompt();
  const raw = await callAi(provider, apiKey, model, systemPrompt, userPrompt);

  // 5. Parse JSON
  let parsed: Partial<ServiceScoreResult>;
  try {
    // Trích xuất JSON block nếu AI bọc trong markdown
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<ServiceScoreResult>;
  } catch {
    logger.warn(`[service-scoring] Failed to parse AI response for conv ${conversationId}:`, raw.slice(0, 200));
    parsed = { summary: raw.slice(0, 500), managerActionRequired: false };
  }

  const result = sanitizeResult(parsed);

  // 6. Persist
  await persistScore(conversationId, conversation.contactId, result);

  logger.info(
    `[service-scoring] conv=${conversationId} score=${result.serviceScore} label=${result.serviceLabel} managerRequired=${result.managerActionRequired}`,
  );

  return result;
}

async function persistScore(
  conversationId: string,
  contactId: string | null,
  result: ServiceScoreResult,
): Promise<void> {
  const now = new Date();

  // Cập nhật conversation
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      serviceScore: result.serviceScore,
      serviceLabel: result.serviceLabel,
      serviceScoreData: result as any,
      serviceScoreAt: now,
      managerActionRequired: result.managerActionRequired,
    },
  });

  // Cập nhật denormalized cache trên contact (nếu có)
  if (contactId && result.serviceScore !== null) {
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        serviceScore: result.serviceScore,
        serviceLabel: result.serviceLabel,
      },
    });
  }
}

// ── Batch scoring (cronjob / on-demand) ──────────────────────────────────────

export interface BatchScoreOptions {
  orgId: string;
  /** Chỉ chấm conversations chưa được chấm hoặc chấm trước X giờ */
  maxAgeHours?: number;
  /** Chỉ chấm conversations có tin nhắn từ nhân viên trong N giờ qua */
  activeWithinHours?: number;
  /** Số conversation tối đa mỗi lần chạy */
  batchLimit?: number;
  /** Override AI provider (mặc định lấy từ ai_configs của org) */
  providerOverride?: string;
  /** Override AI model (mặc định lấy từ ai_configs của org) */
  modelOverride?: string;
}

export async function batchScoreConversations(opts: BatchScoreOptions): Promise<{
  processed: number;
  errors: number;
  results: Array<{ conversationId: string; score: number | null; label: string | null }>;
}> {
  const {
    orgId,
    maxAgeHours = 24,
    activeWithinHours = 48,
    batchLimit = 50,
    providerOverride,
    modelOverride,
  } = opts;

  const now = new Date();
  const staleThreshold = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);
  const activeThreshold = new Date(now.getTime() - activeWithinHours * 60 * 60 * 1000);

  // Tìm conversations cần chấm:
  //   - Có tin nhắn gần đây (activeWithinHours)
  //   - Chưa chấm hoặc chấm đã cũ
  const conversations = await prisma.conversation.findMany({
    where: {
      orgId,
      lastMessageAt: { gte: activeThreshold },
      OR: [
        { serviceScoreAt: null },
        { serviceScoreAt: { lte: staleThreshold } },
      ],
    },
    select: { id: true },
    orderBy: { lastMessageAt: 'desc' },
    take: batchLimit,
  });

  let processed = 0;
  let errors = 0;
  const results: Array<{ conversationId: string; score: number | null; label: string | null }> = [];

  for (const conv of conversations) {
    try {
      const result = await scoreConversation(conv.id, orgId, { providerOverride, modelOverride });
      results.push({ conversationId: conv.id, score: result.serviceScore, label: result.serviceLabel });
      processed++;
    } catch (err) {
      logger.warn(`[service-scoring] Error scoring conv=${conv.id}:`, err);
      errors++;
    }
  }

  logger.info(`[service-scoring] Batch done: processed=${processed} errors=${errors}`);
  return { processed, errors, results };
}
