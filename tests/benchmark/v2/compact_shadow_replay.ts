import { dirname, basename, join, resolve, relative } from 'node:path';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import type { CompactPlannerView } from '../../../src/v2/planner/CompactPlannerView';
import type { PlannerOutput } from '../../../src/v2/planner/types';
import { collectGeminiKeyPool, selectGeminiKeyForAttempt, applyGeminiKeySelection } from './gemini_key_pool';
import { RequestPacer } from '../../../src/providers/requestPacer';
import { buildCompactShadowInput } from '../../../src/v2/planner/CompactShadowInput';
import { callCompactShadowPlanner, type CompactShadowPlannerResult } from '../../../src/v2/planner/CompactShadowPlanner';
import { compareCompactShadow, type CompactShadowAgreement } from '../../../src/v2/planner/CompactShadowComparison';
import { callProvider } from '../../../src/providers';

export interface CompactReplayEpisode {
  runId: string;
  episodeId: string;
  compactArtifactPath: string;
  plannerOutputArtifactPath: string;
  compactPayload: { view: CompactPlannerView };
  productionOutput: PlannerOutput;
  productionFirstStepExecution: 'succeeded' | 'failed' | 'not_found' | 'not_applicable';
}

export interface ReplayOptions {
  root: string;
  model: string;
  maxEpisodes: number;
  keyIndex: number;
  requestRpm: number;
  includeFinalization: boolean;
  dryRun: boolean;
}

async function findTraceFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name === 'trace.json') {
        output.push(path);
      }
    }
  }
  await walk(root);
  return output;
}

export async function loadCompactReplayEpisodes(
  root: string,
  options?: { includeFinalization?: boolean }
): Promise<CompactReplayEpisode[]> {
  const traceFiles = await findTraceFiles(root);
  const episodes: CompactReplayEpisode[] = [];

  for (const traceFile of traceFiles) {
    let trace: any;
    try {
      trace = JSON.parse(await readFile(traceFile, 'utf8'));
    } catch {
      continue;
    }
    const runId = trace.runId || '';
    const compactViews = trace.artifacts?.compactPlannerViews ?? [];

    for (const viewArtifact of compactViews) {
      let compactArtifactPath = viewArtifact.path;
      const originalTracePath = trace.artifacts?.trace?.path;
      if (originalTracePath) {
        const originalRunRoot = dirname(originalTracePath);
        const relPath = relative(originalRunRoot, compactArtifactPath);
        compactArtifactPath = resolve(dirname(traceFile), relPath);
      } else {
        compactArtifactPath = resolve(dirname(traceFile), compactArtifactPath);
      }

      const dir = dirname(compactArtifactPath);
      const base = basename(compactArtifactPath);
      const parentDir = dirname(dir);
      const plannerOutputArtifactPath = join(parentDir, 'planner', base.replace('-compact.json', '-output.json'));

      const episodeId = base.replace('-compact.json', '');
      const isFinalization = episodeId.includes('finalization');
      if (isFinalization && !options?.includeFinalization) {
        continue;
      }

      try {
        const compactContent = JSON.parse(await readFile(compactArtifactPath, 'utf8'));
        if (!compactContent || !compactContent.view) continue;
        const compactPayload = compactContent as { view: CompactPlannerView };
        const view = compactPayload.view;

        const plannerOutputContent = JSON.parse(await readFile(plannerOutputArtifactPath, 'utf8'));
        if (!plannerOutputContent || !plannerOutputContent.output) continue;
        const productionOutput = plannerOutputContent.output as PlannerOutput;

        let productionFirstStepExecution: 'succeeded' | 'failed' | 'not_found' | 'not_applicable';
        const isDoneOrEscalate = productionOutput.done === true || productionOutput.escalate !== undefined;

        if (isDoneOrEscalate) {
          productionFirstStepExecution = 'not_applicable';
        } else if (productionOutput.plan && productionOutput.plan.length > 0) {
          const firstStep = productionOutput.plan[0];
          const steps = trace.steps || [];
          const matchingSteps = steps.filter((step: any) => {
            return step.kind === firstStep.tool &&
                   step.targetRef === firstStep.ref &&
                   step.beforeObservationId === view.observationEpoch?.observationId;
          });

          if (matchingSteps.length === 0) {
            productionFirstStepExecution = 'not_found';
          } else {
            const statuses = new Set(matchingSteps.map((s: any) => s.status));
            if (statuses.size === 1) {
              const status = matchingSteps[0].status;
              if (status === 'completed') {
                productionFirstStepExecution = 'succeeded';
              } else if (status === 'failed') {
                productionFirstStepExecution = 'failed';
              } else {
                productionFirstStepExecution = 'not_found';
              }
            } else {
              productionFirstStepExecution = 'not_found';
            }
          }
        } else {
          productionFirstStepExecution = 'not_found';
        }

        episodes.push({
          runId,
          episodeId,
          compactArtifactPath,
          plannerOutputArtifactPath,
          compactPayload,
          productionOutput,
          productionFirstStepExecution,
        });
      } catch {
        continue;
      }
    }
  }

  episodes.sort((a, b) => {
    const pathCompare = a.compactArtifactPath.localeCompare(b.compactArtifactPath);
    if (pathCompare !== 0) return pathCompare;
    return a.episodeId.localeCompare(b.episodeId);
  });

  return episodes;
}

export function parseArgs(args: string[]): ReplayOptions {
  const options: Partial<ReplayOptions> = {
    model: 'gemini/gemini-3.1-flash-lite',
    maxEpisodes: 10,
    keyIndex: 1,
    requestRpm: 8,
    includeFinalization: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root') {
      if (i + 1 >= args.length) throw new Error('--root requires a value.');
      options.root = args[++i];
    } else if (arg === '--model') {
      if (i + 1 >= args.length) throw new Error('--model requires a value.');
      options.model = args[++i];
    } else if (arg === '--max-episodes') {
      if (i + 1 >= args.length) throw new Error('--max-episodes requires a value.');
      const val = parseInt(args[++i], 10);
      if (isNaN(val) || val <= 0) {
        throw new Error('--max-episodes must be a positive integer.');
      }
      options.maxEpisodes = val;
    } else if (arg === '--key-index') {
      if (i + 1 >= args.length) throw new Error('--key-index requires a value.');
      const val = parseInt(args[++i], 10);
      if (isNaN(val) || val <= 0) {
        throw new Error('--key-index must be a positive one-based integer.');
      }
      options.keyIndex = val;
    } else if (arg === '--request-rpm') {
      if (i + 1 >= args.length) throw new Error('--request-rpm requires a value.');
      const val = parseInt(args[++i], 10);
      if (isNaN(val) || val <= 0) {
        throw new Error('--request-rpm must be a positive integer.');
      }
      options.requestRpm = val;
    } else if (arg === '--include-finalization') {
      options.includeFinalization = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  if (!options.root) {
    throw new Error('--root <path> is required.');
  }

  return options as ReplayOptions;
}

function formatDecision(output: PlannerOutput | undefined): string {
  if (!output) return 'None';
  if (output.done === true) return 'Done';
  if (output.escalate !== undefined) return `Escalate (${output.escalate})`;
  if (output.plan && output.plan.length > 0) {
    const step = output.plan[0];
    return `${step.tool}(${step.ref ?? ''})`;
  }
  return 'None';
}

function formatShadowDecision(result: CompactShadowPlannerResult | undefined): string {
  if (!result) return 'N/A';
  if (result.status === 'provider_error') return 'Provider Error';
  if (result.status === 'invalid_output') return 'Invalid Output';
  return formatDecision(result.output);
}

export async function runReplay(options: ReplayOptions): Promise<void> {
  let episodes = await loadCompactReplayEpisodes(options.root, {
    includeFinalization: options.includeFinalization,
  });

  const selectedCount = episodes.length;
  episodes = episodes.slice(0, options.maxEpisodes);

  const pool = collectGeminiKeyPool(process.env);
  const pacer = new RequestPacer();
  const minIntervalMs = Math.ceil(60_000 / options.requestRpm);

  let eligibleCount = 0;
  let ineligibleCount = 0;
  let validOutputs = 0;
  let invalidOutputs = 0;
  let providerErrors = 0;
  let tokenMeasuredCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let successfulProductionCohortSize = 0;
  let countsTowardSuccessfulProductionAgreementCount = 0;

  const productionFirstStepKindCounts: Record<string, number> = {
    ref_action: 0,
    no_ref_action: 0,
    termination: 0,
    empty: 0,
  };

  const agreementCounts: Record<CompactShadowAgreement, number> = {
    exact_first_action: 0,
    same_tool_different_ref: 0,
    different_tool: 0,
    both_done: 0,
    both_escalate: 0,
    production_done_shadow_action: 0,
    production_action_shadow_done: 0,
    production_escalate_shadow_action: 0,
    production_action_shadow_escalate: 0,
    shadow_invalid: 0,
    shadow_provider_error: 0,
    episode_ineligible: 0,
  };

  const missingProductionFirstRefsByTool: Record<string, number> = {};
  const missingProductionPlanRefsByTool: Record<string, number> = {};

  const results: Array<{
    episodeId: string;
    eligible: boolean;
    productionFirstStepExecution: string;
    productionOutputKind: string;
    shadowOutputKind: string;
    agreement: CompactShadowAgreement;
    productionFirstStep?: any;
    shadowFirstStep?: any;
    shadowTokens?: { input: number; output: number };
    error?: string;
    rawShadowResult?: CompactShadowPlannerResult;
  }> = [];

  let currentKeyIndex = options.keyIndex;

  for (const episode of episodes) {
    const shadowInputResult = buildCompactShadowInput(episode.compactPayload.view, episode.productionOutput);
    const { input, indexToRef, eligibility } = shadowInputResult;

    productionFirstStepKindCounts[eligibility.productionFirstStepKind] =
      (productionFirstStepKindCounts[eligibility.productionFirstStepKind] || 0) + 1;

    if (eligibility.missingProductionFirstRef && episode.productionOutput.plan?.[0]) {
      const tool = episode.productionOutput.plan[0].tool || 'unknown';
      missingProductionFirstRefsByTool[tool] = (missingProductionFirstRefsByTool[tool] || 0) + 1;
    }
    if (episode.productionOutput.plan) {
      for (const step of episode.productionOutput.plan) {
        if (step.ref && eligibility.missingProductionPlanRefs.includes(step.ref)) {
          const tool = step.tool || 'unknown';
          missingProductionPlanRefsByTool[tool] = (missingProductionPlanRefsByTool[tool] || 0) + 1;
        }
      }
    }

    if (!eligibility.eligible) {
      ineligibleCount++;
      const mockResult: CompactShadowPlannerResult = {
        status: 'invalid_output',
        rawText: '',
        errors: [],
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      };
      const comparison = compareCompactShadow(
        episode.productionOutput,
        mockResult,
        episode.productionFirstStepExecution,
        false
      );

      agreementCounts[comparison.agreement] = (agreementCounts[comparison.agreement] || 0) + 1;

      results.push({
        episodeId: episode.episodeId,
        eligible: false,
        productionFirstStepExecution: episode.productionFirstStepExecution,
        productionOutputKind: comparison.productionOutputKind,
        shadowOutputKind: comparison.shadowOutputKind,
        agreement: comparison.agreement,
        productionFirstStep: comparison.productionFirstStep,
        shadowFirstStep: comparison.shadowFirstStep,
      });

      continue;
    }

    eligibleCount++;

    if (options.dryRun) {
      const mockResult: CompactShadowPlannerResult = {
        status: 'invalid_output',
        rawText: '',
        errors: [],
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      };
      const comparison = compareCompactShadow(
        episode.productionOutput,
        mockResult,
        episode.productionFirstStepExecution,
        true
      );
      results.push({
        episodeId: episode.episodeId,
        eligible: true,
        productionFirstStepExecution: episode.productionFirstStepExecution,
        productionOutputKind: comparison.productionOutputKind,
        shadowOutputKind: comparison.shadowOutputKind,
        agreement: comparison.agreement,
        productionFirstStep: comparison.productionFirstStep,
        shadowFirstStep: comparison.shadowFirstStep,
      });
      continue;
    }

    await pacer.wait(minIntervalMs);

    let keySelection: any = undefined;
    if (pool.length > 0) {
      const normalizedIndex = ((currentKeyIndex - 1) % pool.length) + 1;
      keySelection = selectGeminiKeyForAttempt(episode.runId, pool, 0, normalizedIndex);
      currentKeyIndex++;
    }

    if (keySelection) {
      applyGeminiKeySelection(process.env, keySelection);
      console.log(`[Replay] Attempting episode ${episode.episodeId} using key index ${keySelection.keyIndex} (${keySelection.envName})`);
    }

    const shadowResult = await callCompactShadowPlanner(
      callProvider,
      input,
      indexToRef,
      options.model,
      { mode: episode.compactPayload.view.mode === 'finalization' ? 'finalization' : 'normal' }
    );

    if (shadowResult.status !== 'provider_error') {
      tokenMeasuredCalls++;
      totalInputTokens += shadowResult.inputTokens;
      totalOutputTokens += shadowResult.outputTokens;
    }

    if (shadowResult.status === 'valid') {
      validOutputs++;
    } else if (shadowResult.status === 'invalid_output') {
      invalidOutputs++;
    } else if (shadowResult.status === 'provider_error') {
      providerErrors++;
    }

    const comparison = compareCompactShadow(
      episode.productionOutput,
      shadowResult,
      episode.productionFirstStepExecution,
      true
    );

    agreementCounts[comparison.agreement] = (agreementCounts[comparison.agreement] || 0) + 1;

    if (episode.productionFirstStepExecution === 'succeeded') {
      successfulProductionCohortSize++;
      if (comparison.countsTowardSuccessfulProductionAgreement) {
        countsTowardSuccessfulProductionAgreementCount++;
      }
    }

    results.push({
      episodeId: episode.episodeId,
      eligible: true,
      productionFirstStepExecution: episode.productionFirstStepExecution,
      productionOutputKind: comparison.productionOutputKind,
      shadowOutputKind: comparison.shadowOutputKind,
      agreement: comparison.agreement,
      productionFirstStep: comparison.productionFirstStep,
      shadowFirstStep: comparison.shadowFirstStep,
      shadowTokens: { input: shadowResult.inputTokens, output: shadowResult.outputTokens },
      error: shadowResult.status === 'provider_error'
        ? shadowResult.error
        : (shadowResult.status === 'invalid_output' ? shadowResult.errors.join('; ') : undefined),
      rawShadowResult: shadowResult,
    });
  }

  if (options.dryRun) {
    console.log(`Dry run results:`);
    console.log(`- Selected: ${episodes.length}`);
    console.log(`- Eligible: ${eligibleCount}`);
    console.log(`- Ineligible: ${ineligibleCount}`);
    return;
  }

  const attemptedEpisodes = eligibleCount;
  const averageInputTokensMeasured = tokenMeasuredCalls > 0 ? totalInputTokens / tokenMeasuredCalls : 0;
  const averageOutputTokensMeasured = tokenMeasuredCalls > 0 ? totalOutputTokens / tokenMeasuredCalls : 0;
  const eligibilityRate = episodes.length > 0 ? eligibleCount / episodes.length : 0;
  const successfulProductionAgreementRate = successfulProductionCohortSize > 0
    ? countsTowardSuccessfulProductionAgreementCount / successfulProductionCohortSize
    : 0;

  const generatedAt = new Date().toISOString();

  const jsonReport = {
    version: 'compact_shadow_report.v1',
    root: options.root,
    model: options.model,
    generatedAt,
    selectedEpisodes: episodes.length,
    eligibleEpisodes: eligibleCount,
    ineligibleEpisodes: ineligibleCount,
    eligibilityRate,
    attemptedEpisodes,
    tokenMeasuredCalls,
    validOutputs,
    invalidOutputs,
    providerErrors,
    averageInputTokens: averageInputTokensMeasured,
    averageOutputTokens: averageOutputTokensMeasured,
    averageInputTokensMeasured,
    averageOutputTokensMeasured,
    productionFirstStepKindCounts,
    successfulProductionCohortSize,
    successfulProductionAgreementRate,
    agreementCounts,
    missingProductionFirstRefsByTool,
    missingProductionPlanRefsByTool,
    results: results.map(r => ({
      episodeId: r.episodeId,
      eligible: r.eligible,
      productionFirstStepExecution: r.productionFirstStepExecution,
      productionOutputKind: r.productionOutputKind,
      shadowOutputKind: r.shadowOutputKind,
      agreement: r.agreement,
      productionFirstStep: r.productionFirstStep,
      shadowFirstStep: r.shadowFirstStep,
      shadowTokens: r.shadowTokens,
      error: r.error,
    })),
  };

  const mdRows = results.map(r => {
    const shadowTokensStr = r.shadowTokens ? `${r.shadowTokens.input}/${r.shadowTokens.output}` : 'N/A';
    const prodDecision = formatDecision(episodes.find(e => e.episodeId === r.episodeId)?.productionOutput);
    const shadowDecision = formatShadowDecision(r.rawShadowResult);
    return `| ${r.episodeId} | ${r.eligible ? 'Eligible' : 'Ineligible'} | ${r.productionFirstStepExecution} | ${prodDecision} | ${shadowDecision} | ${r.agreement} | ${shadowTokensStr} | ${r.error || ''} |`;
  }).join('\n');

  const mdReport = `# Compact Shadow Planner Replay Report

## Statistics Summary

- **Generated At**: ${generatedAt}
- **Model**: \`${options.model}\`
- **Root Directory**: \`${options.root}\`
- **Selected Episodes**: ${episodes.length}
- **Eligible Episodes**: ${eligibleCount}
- **Ineligible Episodes**: ${ineligibleCount}
- **Eligibility Rate**: ${(eligibilityRate * 100).toFixed(2)}%
- **Attempted Episodes**: ${attemptedEpisodes}
- **Token-Measured Calls**: ${tokenMeasuredCalls}
- **Valid Shadow Outputs**: ${validOutputs}
- **Invalid Shadow Outputs**: ${invalidOutputs}
- **Provider Errors**: ${providerErrors}
- **Average Input Tokens**: ${averageInputTokensMeasured.toFixed(1)}
- **Average Output Tokens**: ${averageOutputTokensMeasured.toFixed(1)}
- **Average Input Tokens Measured**: ${averageInputTokensMeasured.toFixed(1)}
- **Average Output Tokens Measured**: ${averageOutputTokensMeasured.toFixed(1)}
- **Successful Production Cohort Size**: ${successfulProductionCohortSize}
- **Successful Production Agreement Rate**: ${(successfulProductionAgreementRate * 100).toFixed(2)}%

### Agreement Counts

| Agreement | Count |
| --- | --- |
${Object.entries(agreementCounts).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

### Missing Production First Refs by Tool

${Object.entries(missingProductionFirstRefsByTool).length > 0
  ? Object.entries(missingProductionFirstRefsByTool).map(([k, v]) => `- **${k}**: ${v}`).join('\n')
  : 'None'}

### Missing Production Plan Refs by Tool

${Object.entries(missingProductionPlanRefsByTool).length > 0
  ? Object.entries(missingProductionPlanRefsByTool).map(([k, v]) => `- **${k}**: ${v}`).join('\n')
  : 'None'}

## Episode Replay Table

| Episode ID | Eligibility | Production First Step Execution | Production First Decision | Shadow First Decision | Agreement | Shadow Input/Output Tokens | Validation or Provider Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
${mdRows}
`;

  const reportDir = join(options.root, 'compact-shadow');
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'compact_shadow_report.json'), JSON.stringify(jsonReport, null, 2), 'utf8');
  await writeFile(join(reportDir, 'compact_shadow_report.md'), mdReport, 'utf8');

  console.log(`Replay finished. Reports written under ${reportDir}`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    await runReplay(options);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
