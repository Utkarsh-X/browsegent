// ── llm.ts — Slim Orchestrator ──────────────────────────────────────────────
// Pipeline: provider.call → parser.robustJsonParse → validator.validate
// If invalid → targeted retry with validation errors → give up

import { logger } from '../logger';
import { countTokens } from '../brain1/serializer';
import type { ActionHistoryEntry } from '../graph/serializer';
import type { LLMPlanStep } from '../executor/types';

import { robustJsonParse } from './parser';
import { validatePlan } from './validator';
import { callProvider } from './providers';
import { SYSTEM_PROMPT, EXTRACT_SYSTEM_PROMPT, buildUserMessage } from './prompt';

// ── Types (re-exported for backward compatibility) ──────────────────────────

export interface LLMPlan {
  plan?: LLMPlanStep[];
  done?: boolean;
  val?: string;
  escalate?: 'user_needed' | 'captcha' | 'dead_end';
  reason?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export type PlanStep = LLMPlanStep;

export interface EscalationContext {
  goal: string;
  graphJson: string;
  actionHistory: ActionHistoryEntry[];
  reason: string;
  stepCount: number;
  contextWarnings?: string[];
  model?: string;
}

export interface LLMCallMetrics {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface LLMCallResult {
  plan: LLMPlan;
  metrics: LLMCallMetrics;
}

export interface ExtractContext {
  instruction: string;
  graphJson: string;
  schemaDescription: string;
  model?: string;
}

export interface ExtractCallResult {
  rawJson: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

// ── Main LLM call ───────────────────────────────────────────────────────────

export async function callLLM(ctx: EscalationContext): Promise<LLMCallResult> {
  const userMsg = buildUserMessage(ctx);
  const estimatedInputTokens = countTokens(SYSTEM_PROMPT + userMsg);

  logger.info('agent:llm', 'LLM call', {
    reason: ctx.reason,
    step: ctx.stepCount,
    inputTokens: estimatedInputTokens,
    historyLength: ctx.actionHistory.length,
  });

  const start = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // ── Attempt 1 ─────────────────────────────────────────────────────────
    let result = await callProvider(SYSTEM_PROMPT, userMsg, ctx.model);
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    let parsed = robustJsonParse(result.text);
    let validation = parsed
      ? validatePlan(parsed)
      : { valid: false, errors: ['No JSON could be extracted from model output'] };

    // ── Attempt 2: targeted retry with validation errors ──────────────────
    if (!validation.valid) {
      logger.warn('agent:llm', 'Attempt 1 failed, retrying with targeted feedback', {
        errors: validation.errors,
        rawPreview: result.text.slice(0, 200),
      });

      const feedback =
        `Your previous response was invalid:\n` +
        validation.errors.map(e => `- ${e}`).join('\n') +
        `\n\nRespond ONLY with a valid JSON object. Use these exact field names: ` +
        `"plan", "done", "val", "escalate", "reason", "confidence". ` +
        `Do NOT add any text before or after the JSON.`;

      result = await callProvider(SYSTEM_PROMPT, userMsg + '\n\n' + feedback, ctx.model);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      parsed = robustJsonParse(result.text);
      validation = parsed
        ? validatePlan(parsed)
        : { valid: false, errors: ['Retry also failed: no JSON extracted'] };
    }

    const durationMs = Date.now() - start;

    // ── Give up ───────────────────────────────────────────────────────────
    if (!validation.valid) {
      logger.warn('agent:llm', 'Both attempts failed — escalating to dead_end', {
        errors: validation.errors,
        rawPreview: result.text.slice(0, 300),
      });
      return {
        plan: {
          escalate: 'dead_end',
          reason: `LLM output invalid after retry: ${validation.errors.join('; ')}`,
        },
        metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, durationMs },
      };
    }

    // ── Success ───────────────────────────────────────────────────────────
    const plan = parsed as LLMPlan;
    logger.info('agent:llm', 'LLM response parsed', {
      hasPlan: !!plan.plan,
      isDone: !!plan.done,
      escalate: plan.escalate,
      planSteps: plan.plan?.length ?? 0,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs,
    });

    return {
      plan,
      metrics: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, durationMs },
    };

  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error('agent:llm', 'LLM call failed', err);
    return {
      plan: { escalate: 'dead_end', reason: `LLM error: ${String(err)}` },
      metrics: { inputTokens: estimatedInputTokens, outputTokens: 0, durationMs },
    };
  }
}

// ── Extract call ────────────────────────────────────────────────────────────

export async function callExtract(ctx: ExtractContext): Promise<ExtractCallResult> {
  const userMessage = `Instruction: ${ctx.instruction}
Expected format: ${ctx.schemaDescription}
Graph: ${ctx.graphJson}`;

  logger.info('agent:llm', 'Extract call', {
    instruction: ctx.instruction.slice(0, 80),
  });

  const start = Date.now();

  try {
    const result = await callProvider(EXTRACT_SYSTEM_PROMPT, userMessage, ctx.model);
    const durationMs = Date.now() - start;

    return {
      rawJson: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error('agent:llm', 'Extract call failed', err);
    return { rawJson: '{}', inputTokens: 0, outputTokens: 0, durationMs };
  }
}
