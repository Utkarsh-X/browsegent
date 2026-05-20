import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runContinuityStress } from '../../eval/v2/run_continuity_stress';
import type { ContinuityScenario } from '../../eval/v2/continuity_scenarios';
import type { BrowserObservation, V2Ref, V2ToolResult } from '../../../src/v2';
import type { TraceManifest } from '../../../src/v2/trace/types';

function makeRef(overrides: Partial<V2Ref> = {}): V2Ref {
  return {
    refId: 'ref_primary',
    generationId: 1,
    targetId: 'target_primary',
    selectorCandidates: ['#primary'],
    role: 'button',
    name: 'Primary',
    text: 'Primary',
    visibility: 'visible',
    actionability: 'ready',
    continuityConfidence: 1,
    state: 'live',
    ...overrides,
  };
}

function makeObservation(observationId: string, refs: V2Ref[]): BrowserObservation {
  return {
    observationId,
    sessionId: 'session_stress',
    generationId: 1,
    url: 'file:///fixture.html',
    title: 'Stress Fixture',
    timestamp: 1,
    refs,
    warnings: [],
    stats: {
      refCount: refs.length,
      visibleRefCount: refs.length,
      durationMs: 1,
    },
  };
}

test('runContinuityStress writes report and scenario results with bounded metrics', async () => {
  const outputDir = await freshDir('stress-runner');
  const scenarios: ContinuityScenario[] = [
    {
      id: 'passing_scenario',
      fixture: 'passing.html',
      action: { kind: 'clickByName', name: 'Primary' },
    },
    {
      id: 'failing_scenario',
      fixture: 'failing.html',
      action: { kind: 'clickByName', name: 'Missing' },
    },
  ];

  const result = await runContinuityStress({
    runId: 'stress_unit',
    outputDir,
    traceDir: join(outputDir, 'v2-runs'),
    headed: false,
    scenarios,
    harnessFactory: ({ scenario }) => new FakeStressHarness(scenario.id),
  });

  const reportJson = JSON.parse(await readFile(join(outputDir, 'stress_unit', 'report.json'), 'utf8'));
  const scenarioResultsJson = JSON.parse(await readFile(join(outputDir, 'stress_unit', 'scenario-results.json'), 'utf8'));
  const failed = result.scenarioResults.find(item => item.scenarioId === 'failing_scenario');
  const passed = result.scenarioResults.find(item => item.scenarioId === 'passing_scenario');

  assert.equal(result.report.scenarioCount, 2);
  assert.equal(result.report.failedCount, 1);
  assert.equal(reportJson.failedCount, 1);
  assert.equal(scenarioResultsJson.length, 2);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.failureType, 'target_ref_missing');
  assert.match(failed?.tracePath ?? '', /trace\.json$/);
  assert.equal(passed?.metrics.traceComplete, true);
  assert.equal(passed?.metrics.wrongRefCount, 0);
  assert.equal(passed?.metrics.projectionSize, 1);
  assert.equal(passed?.metrics.transitionClassDistribution.structural_local, 1);
  assert.equal(typeof passed?.metrics.refSurvival, 'number');
});

class FakeStressHarness {
  private readonly manifest: TraceManifest;
  private opened = false;

  constructor(private readonly scenarioId: string) {
    this.manifest = {
      runId: `run_${scenarioId}`,
      runtimeMode: 'mvr',
      startTime: 1,
      steps: [],
      artifacts: {
        trace: { kind: 'trace', id: 'trace', path: `logs/${scenarioId}/trace.json` },
        observations: [
          { kind: 'observation', id: `${scenarioId}_before`, path: `logs/${scenarioId}/observations/before.json` },
          { kind: 'observation', id: `${scenarioId}_after`, path: `logs/${scenarioId}/observations/after.json` },
        ],
        transitions: [],
        graph: [],
        planner: [],
        screenshots: [],
      },
    };

    if (scenarioId === 'passing_scenario') {
      this.manifest.steps.push({
        stepId: 'step_click',
        index: 0,
        kind: 'click',
        status: 'completed',
        startedAt: 1,
        beforeObservationId: `${scenarioId}_before`,
        afterObservationId: `${scenarioId}_after`,
        warnings: [],
        result: {
          success: true,
          kind: 'click',
          targetRef: 'ref_primary',
          traceStepId: 'step_click',
          evidence: {
            beforeObservationId: `${scenarioId}_before`,
            afterObservationId: `${scenarioId}_after`,
            transitionClass: 'structural_local',
            strength: 'moderate',
            generationChanged: false,
            urlChanged: false,
            refChanges: {
              appeared: [],
              disappeared: [],
              weakened: [],
              preserved: ['ref_primary'],
            },
            notes: [],
          },
        },
      });
    }
  }

  async open(): Promise<BrowserObservation> {
    this.opened = true;
    return makeObservation(`${this.scenarioId}_before`, [makeRef()]);
  }

  async observe(): Promise<BrowserObservation> {
    if (!this.opened) throw new Error('not_opened');
    return makeObservation(`${this.scenarioId}_after`, [makeRef()]);
  }

  async click(refId: string): Promise<V2ToolResult> {
    if (this.scenarioId === 'failing_scenario') {
      return {
        success: false,
        kind: 'click',
        targetRef: refId,
        traceStepId: 'step_failed',
        error: {
          code: 'target_not_found',
          message: 'Target ref missing in fake harness.',
          retryable: false,
        },
      };
    }

    return {
      success: true,
      kind: 'click',
      targetRef: refId,
      traceStepId: 'step_click',
      evidence: {
        beforeObservationId: `${this.scenarioId}_before`,
        afterObservationId: `${this.scenarioId}_after`,
        transitionClass: 'structural_local',
        strength: 'moderate',
        generationChanged: false,
        urlChanged: false,
        refChanges: {
          appeared: [],
          disappeared: [],
          weakened: [],
          preserved: [refId],
        },
        notes: [],
      },
    };
  }

  async type(refId: string): Promise<V2ToolResult> {
    return this.click(refId);
  }

  async flushTrace(): Promise<TraceManifest> {
    return this.manifest;
  }

  async close(): Promise<void> {}
}

async function freshDir(name: string): Promise<string> {
  const root = join(process.cwd(), 'logs', 'v2-unit-stress', name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}
