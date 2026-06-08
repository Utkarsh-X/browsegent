import type { PlannerOutput } from './types';
import type { V2PlannerProvider } from './V2PlannerClient';
import type { CompactShadowPlannerInput } from './CompactShadowInput';
import { robustJsonParse } from '../../agent/parser';
import { buildV2PlannerResponseSchema } from './V2PlannerResponseSchema';
import { PlannerOutputSchema } from './PlannerOutputSchema';
import { buildCompactShadowSystemPrompt, buildCompactShadowUserMessage } from './CompactShadowPrompt';

export type CompactShadowPlannerResult =
  | { status: 'valid'; output: PlannerOutput; rawOutput: PlannerOutput; rawText: string; inputTokens: number; outputTokens: number; durationMs: number }
  | { status: 'invalid_output'; rawText: string; errors: string[]; inputTokens: number; outputTokens: number; durationMs: number }
  | { status: 'provider_error'; error: string; inputTokens: number; outputTokens: number; durationMs: number };

export async function callCompactShadowPlanner(
  provider: V2PlannerProvider,
  input: CompactShadowPlannerInput,
  indexToRef: Record<string, string>,
  model?: string,
  options?: { mode?: 'normal' | 'finalization' },
): Promise<CompactShadowPlannerResult> {
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    // 1. Build compact prompts
    const systemPrompt = buildCompactShadowSystemPrompt();
    const userMessage = buildCompactShadowUserMessage(input);

    // 2. Call provider exactly once
    const providerResult = await provider(systemPrompt, userMessage, model, {
      responseSchema: buildV2PlannerResponseSchema(),
    });

    inputTokens = providerResult.inputTokens;
    outputTokens = providerResult.outputTokens;
    const rawText = providerResult.text;

    // 3. Parse JSON from provider text
    const parsed = robustJsonParse(rawText);
    if (!parsed) {
      return {
        status: 'invalid_output',
        rawText,
        errors: ['Planner response did not contain a valid JSON object'],
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startedAt,
      };
    }

    // Clone parsed object to avoid mutating rawOutput
    const rawOutput = parsed as PlannerOutput;
    const normalizedOutput = JSON.parse(JSON.stringify(rawOutput)) as PlannerOutput;

    // 4. Walk through the plan steps and replace compact indexes with runtime refs
    if (normalizedOutput.plan && Array.isArray(normalizedOutput.plan)) {
      for (let i = 0; i < normalizedOutput.plan.length; i++) {
        const step = normalizedOutput.plan[i];
        if (step && typeof step === 'object') {
          const stepRecord = step as unknown as Record<string, unknown>;

          if (stepRecord.sel !== undefined || stepRecord.selector !== undefined) {
            const durationMs = Date.now() - startedAt;
            return {
              status: 'invalid_output',
              rawText,
              errors: [`Step ${i + 1} uses forbidden alias "sel" or "selector"`],
              inputTokens,
              outputTokens,
              durationMs,
            };
          }

          const stepRef = stepRecord.ref;
          if (typeof stepRef === 'string') {
            const runtimeRef = indexToRef[stepRef];
            if (typeof runtimeRef !== 'string') {
              const durationMs = Date.now() - startedAt;
              return {
                status: 'invalid_output',
                rawText,
                errors: [`Step ${i + 1} has unknown compact index "${stepRef}"`],
                inputTokens,
                outputTokens,
                durationMs,
              };
            }
            step.ref = runtimeRef;
          }
        }
      }
    }

    // 5. Validate the normalized output object
    const actionSurface = {
      clickableRefs: [] as string[],
      typeableRefs: [] as string[],
      selectableRefs: [] as string[],
      readableRefs: [] as string[],
      ambiguousRefs: [] as string[],
    };
    for (const action of input.actions) {
      const ref = indexToRef[action.index];
      if (!ref) continue;
      if (action.tools.includes('click')) actionSurface.clickableRefs.push(ref);
      if (action.tools.includes('type')) actionSurface.typeableRefs.push(ref);
      if (action.tools.includes('select')) actionSurface.selectableRefs.push(ref);
    }
    for (const read of input.reads) {
      const ref = indexToRef[read.index];
      if (!ref) continue;
      if (read.tools.includes('get')) actionSurface.readableRefs.push(ref);
    }

    const validationContext = {
      allowedRefs: Object.values(indexToRef),
      actionSurface,
      mode: options?.mode ?? 'normal',
      actionCompatibilityScope: options?.mode === 'finalization' ? ('all_steps' as const) : ('first_step' as const),
    };

    const schema = new PlannerOutputSchema();
    const validation = schema.validate(normalizedOutput, validationContext);
    const durationMs = Date.now() - startedAt;

    if (validation.ok) {
      return {
        status: 'valid',
        output: validation.value,
        rawOutput,
        rawText,
        inputTokens,
        outputTokens,
        durationMs,
      };
    } else {
      return {
        status: 'invalid_output',
        rawText,
        errors: validation.errors,
        inputTokens,
        outputTokens,
        durationMs,
      };
    }

  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      status: 'provider_error',
      error: errorMessage,
      inputTokens,
      outputTokens,
      durationMs,
    };
  }
}
