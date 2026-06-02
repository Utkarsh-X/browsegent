import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  V2PlannerClient,
  V2PlannerClientError,
  type PlannerInput,
  type PlannerOutput,
  type V2PlannerCallResult,
  type V2PlannerClientLike,
} from '../../../src/v2';

export type ProviderSmokeStatus = 'skipped' | 'passed' | 'failed';

export interface ProviderSmokeRunOptions {
  runId?: string;
  outputRoot?: string;
  fixture?: string;
  model?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  plannerInput?: PlannerInput;
  plannerClient?: V2PlannerClientLike;
}

export interface ProviderSmokeSummary {
  runId: string;
  status: ProviderSmokeStatus;
  fixture: string;
  fixtureUrl: string;
  reportPath: string;
  failureReason?: string;
  validationErrors?: string[];
  rawText?: string;
  output?: PlannerOutput;
  metrics?: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
}

export async function runProviderSmoke(options: ProviderSmokeRunOptions = {}): Promise<ProviderSmokeSummary> {
  const env = options.env ?? process.env;
  const runId = options.runId ?? `provider_smoke_${Date.now()}`;
  const outputRoot = options.outputRoot ?? join(process.cwd(), 'logs', 'v2-provider-smoke');
  const runRoot = join(outputRoot, runId);
  const fixture = options.fixture ?? 'static-controls.html';
  const fixtureUrl = pathToFileURL(resolve('tests/fixtures/v2', fixture)).toString();
  const reportPath = join(runRoot, 'report.json');

  await mkdir(runRoot, { recursive: true });

  if (readEnv(env, 'BROWSEGENT_RUN_PROVIDER_SMOKE') !== 'true') {
    return writeSummary(reportPath, {
      runId,
      status: 'skipped',
      fixture,
      fixtureUrl,
      reportPath,
      failureReason: 'provider_smoke_not_enabled',
    });
  }

  if (readEnv(env, 'BROWSEGENT_V2_RUNTIME') !== 'agent') {
    return writeSummary(reportPath, {
      runId,
      status: 'failed',
      fixture,
      fixtureUrl,
      reportPath,
      failureReason: 'provider_smoke_requires_agent_runtime',
    });
  }

  try {
    const plannerInput = options.plannerInput ?? buildFixturePlannerInput(fixtureUrl);
    const plannerClient = options.plannerClient ?? new V2PlannerClient();
    const result = await plannerClient.call({
      plannerInput,
      model: options.model,
    });

    return writeSummary(reportPath, passedSummary(runId, fixture, fixtureUrl, reportPath, result));
  } catch (error) {
    if (error instanceof V2PlannerClientError) {
      return writeSummary(reportPath, {
        runId,
        status: 'failed',
        fixture,
        fixtureUrl,
        reportPath,
        failureReason: 'provider_output_validation_failed',
        validationErrors: error.errors,
        rawText: error.rawText,
      });
    }

    return writeSummary(reportPath, {
      runId,
      status: 'failed',
      fixture,
      fixtureUrl,
      reportPath,
      failureReason: `provider_smoke_error:${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function passedSummary(
  runId: string,
  fixture: string,
  fixtureUrl: string,
  reportPath: string,
  result: V2PlannerCallResult,
): ProviderSmokeSummary {
  return {
    runId,
    status: 'passed',
    fixture,
    fixtureUrl,
    reportPath,
    output: result.output,
    rawText: result.rawText,
    validationErrors: [],
    metrics: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
    },
  };
}

async function writeSummary<TSummary extends ProviderSmokeSummary>(
  reportPath: string,
  summary: TSummary,
): Promise<TSummary> {
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

function buildFixturePlannerInput(fixtureUrl: string): PlannerInput {
  return {
    version: 'v2.planner_input.v1',
    episodeId: 'episode_provider_smoke',
    goal: `Inspect the local fixture at ${fixtureUrl} and return a valid v2 planner JSON response.`,
    current: {
      projectionId: 'projection_provider_smoke',
      observationId: 'obs_provider_smoke',
      generationId: 1,
      page: {
        url: fixtureUrl,
        title: 'Static Controls Fixture',
      },
      stats: {
        interactionCount: 2,
        readableCount: 2,
        navigationCount: 0,
        regionCount: 0,
      },
      refs: {
        v2ref_1: {
          refId: 'v2ref_1',
          kind: 'button',
          role: 'button',
          name: 'Submit form',
          text: 'Submit form',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 10,
        },
        v2ref_2: {
          refId: 'v2ref_2',
          kind: 'input',
          role: 'textbox',
          name: 'Search docs',
          visibility: 'visible',
          actionability: 'ready',
          state: 'live',
          confidence: 1,
          score: 8,
        },
      },
      interactions: [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }],
      readables: [{ refId: 'v2ref_1', rank: 1 }, { refId: 'v2ref_2', rank: 2 }],
      navigation: [],
      regions: [],
      warnings: [],
    },
    uncertainty: {
      level: 'none',
      signals: [],
    },
  };
}

function readEnv(env: Partial<NodeJS.ProcessEnv>, name: string): string | undefined {
  const value = env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

if (require.main === module) {
  runProviderSmoke()
    .then(summary => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (summary.status === 'failed') {
        process.exitCode = 1;
      }
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
