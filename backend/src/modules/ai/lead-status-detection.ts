/**
 * lead-status-detection.ts — AI phân tích hội thoại và đề xuất trạng thái khách hàng.
 *
 * Flow:
 *   1. Trigger từ message-handler khi có tin nhắn mới (debounced 30s/contact).
 *   2. Load 100 tin nhắn gần nhất của tất cả conversations thuộc contact.
 *   3. Gọi AI với prompt lead-status để nhận JSON { suggestedStatus, statusReason }.
 *   4. Áp dụng rule "chỉ tiến không lùi" — so weight với contact.status hiện tại.
 *   5. Ghi vào contact.suggestedStatus + suggestedStatusReason + suggestedStatusAt.
 *      Nhân viên sẽ Apply (commit vào status + log history) hoặc Reject (clear).
 *
 * Không bao giờ ghi thẳng vào contact.status — luôn đi qua suggested + manual approve.
 */
import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { getAiConfig } from './ai-service.js';
import { buildLeadStatusPrompt } from './prompts/lead-status.js';
import { getProviderConfig } from './provider-registry.js';
import { generateWithAnthropic } from './providers/anthropic.js';
import { generateWithGemini } from './providers/gemini.js';
import { generateWithOpenaiCompat } from './providers/openai-compat.js';

// ── Socket.IO ─────────────────────────────────────────────────────────────────
// Set once at app startup (see app.ts) so this module can emit realtime events
// to the frontend without going through request handlers.
let io: SocketServer | null = null;
export function setLeadStatusIo(socketIo: SocketServer): void {
  io = socketIo;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_WEIGHT: Record<string, number> = {
  new: 1,
  consulting: 2,
  quoting: 3,
  nurturing: 4,
  converted: 5,
};

const ALLOWED_SUGGESTIONS = new Set(['consulting', 'quoting', 'nurturing', 'lost']);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeadStatusResult {
  suggestedStatus: string | null;
  statusReason: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function clearSuggestion(contactId: string, orgId: string): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { suggestedStatus: null, suggestedStatusReason: null, suggestedStatusAt: null },
  });
  io?.emit('contact:suggestion-updated', {
    contactId,
    orgId,
    suggestedStatus: null,
    suggestedStatusReason: null,
  });
}

/**
 * Strict no-regression rule: AI chỉ được suggest weight CAO HƠN status hiện tại.
 * Ngoại lệ: 'lost' luôn được phép (có thể xảy ra ở bất kỳ giai đoạn nào).
 * Đã 'converted' rồi thì KHÔNG suggest gì cả (kể cả lost — manual review).
 */
function isSuggestionValid(currentStatus: string | null, suggested: string): boolean {
  if (suggested === 'lost') {
    return currentStatus !== 'converted';
  }
  const currentWeight = STATUS_WEIGHT[currentStatus || 'new'] ?? 1;
  const suggestedWeight = STATUS_WEIGHT[suggested] ?? 0;
  return suggestedWeight > currentWeight;
}

// ── Core function ─────────────────────────────────────────────────────────────

export interface DetectOptions {
  providerOverride?: string;
  modelOverride?: string;
}

/**
 * Phân tích tất cả conversations của 1 contact và đề xuất trạng thái mới.
 * Ghi vào contact.suggestedStatus nếu có thay đổi; clear nếu AI nói null hoặc
 * suggestion bằng status hiện tại.
 */
export async function detectLeadStatus(
  contactId: string,
  orgId: string,
  options?: DetectOptions,
): Promise<LeadStatusResult | null> {
  // 1. Load contact + tất cả conversations + 100 tin nhắn gần nhất
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, orgId, contactType: 'customer' },
    select: {
      id: true,
      fullName: true,
      crmName: true,
      status: true,
      suggestedStatus: true,
    },
  });

  if (!contact) return null;

  // Skip nếu đã converted — converted phải được nhân viên xử lý thủ công,
  // không cần AI suggest gì thêm.
  if (contact.status === 'converted') {
    if (contact.suggestedStatus) await clearSuggestion(contactId, orgId);
    return null;
  }

  const messages = await prisma.message.findMany({
    where: {
      isDeleted: false,
      conversation: { contactId, orgId },
    },
    orderBy: { sentAt: 'desc' },
    take: 100,
    select: {
      senderType: true,
      senderName: true,
      content: true,
      sentAt: true,
    },
  });

  if (messages.length < 2) return null; // Quá ít tin để phân tích

  const ordered = messages.reverse();
  const customerMessages = ordered.filter((m) => m.senderType !== 'self');
  if (customerMessages.length < 2) return null;

  // 2. Build user prompt context
  const contextLines = ordered.map((msg) => {
    const author = msg.senderType === 'self' ? 'staff' : (msg.senderName || 'customer');
    const content = (msg.content || '(empty)').replace(/<\/?conversation_context>/gi, '');
    return `[${msg.sentAt.toISOString()}] ${author}: ${content}`;
  });

  const userPrompt = [
    `<conversation_context>`,
    `Customer: ${contact.crmName || contact.fullName || 'Khách hàng'}`,
    `Current status: ${contact.status || 'new'}`,
    contextLines.join('\n'),
    `</conversation_context>`,
  ].join('\n');

  // 3. Gọi AI
  const aiConfig = await getAiConfig(orgId);
  if (!aiConfig.enabled) return null;

  const provider = options?.providerOverride || aiConfig.provider;
  const model = options?.modelOverride || aiConfig.model;

  const apiKey = await getProviderApiKey(orgId, provider);
  if (!apiKey) return null;

  const systemPrompt = buildLeadStatusPrompt();

  let raw: string;
  try {
    raw = await callAi(provider, apiKey, model, systemPrompt, userPrompt);
  } catch (err) {
    logger.warn(`[lead-status] AI call failed for contact=${contactId}:`, err);
    return null;
  }

  // 4. Parse JSON
  let parsed: { suggestedStatus?: unknown; statusReason?: unknown };
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    logger.warn(`[lead-status] Failed to parse AI response for contact=${contactId}:`, raw.slice(0, 200));
    return null;
  }

  const rawSuggested = typeof parsed.suggestedStatus === 'string' ? parsed.suggestedStatus : null;
  const reason = typeof parsed.statusReason === 'string' ? parsed.statusReason : '';

  // AI từ chối suggest (null) hoặc trả status không hợp lệ → clear suggestion
  if (!rawSuggested || !ALLOWED_SUGGESTIONS.has(rawSuggested)) {
    if (contact.suggestedStatus) await clearSuggestion(contactId, orgId);
    return { suggestedStatus: null, statusReason: reason };
  }

  // 5. Apply strict no-regression rule
  if (!isSuggestionValid(contact.status, rawSuggested)) {
    if (contact.suggestedStatus) await clearSuggestion(contactId, orgId);
    return null;
  }

  // 6. Persist suggestion (chưa commit vào contact.status — đợi nhân viên Apply)
  const trimmedReason = reason.slice(0, 500);
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      suggestedStatus: rawSuggested,
      suggestedStatusReason: trimmedReason,
      suggestedStatusAt: new Date(),
    },
  });

  io?.emit('contact:suggestion-updated', {
    contactId,
    orgId,
    suggestedStatus: rawSuggested,
    suggestedStatusReason: trimmedReason,
  });

  logger.info(
    `[lead-status] contact=${contactId} current=${contact.status} suggested=${rawSuggested}`,
  );

  return { suggestedStatus: rawSuggested, statusReason: reason };
}

// ── Debounced trigger ─────────────────────────────────────────────────────────

const DEBOUNCE_MS = 30_000; // 30 giây sau tin nhắn cuối → mới chạy AI
const pendingTimers = new Map<string, NodeJS.Timeout>();

/**
 * Schedule một lần phát hiện trạng thái cho contact, debounce 30s.
 * Nếu có tin nhắn mới đến trong 30s → reset timer (tránh gọi AI mỗi tin).
 */
export function scheduleLeadStatusDetection(contactId: string, orgId: string): void {
  const existing = pendingTimers.get(contactId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(contactId);
    detectLeadStatus(contactId, orgId).catch((err) => {
      logger.warn(`[lead-status] Debounced run failed for contact=${contactId}:`, err);
    });
  }, DEBOUNCE_MS);

  pendingTimers.set(contactId, timer);
}
