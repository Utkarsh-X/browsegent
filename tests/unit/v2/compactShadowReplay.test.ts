import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCompactReplayEpisodes, runReplay } from '../../benchmark/v2/compact_shadow_replay';

test('loadCompactReplayEpisodes - correct join, finalization exclusion, step matching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compact-shadow-replay-test-'));

  try {
    // Create two run directories
    const run1Dir = join(root, 'run1');
    const run2Dir = join(root, 'run2');
    await mkdir(run1Dir, { recursive: true });
    await mkdir(run2Dir, { recursive: true });

    const compact1Dir = join(run1Dir, 'compact-planner');
    const planner1Dir = join(run1Dir, 'planner');
    await mkdir(compact1Dir, { recursive: true });
    await mkdir(planner1Dir, { recursive: true });

    const compact2Dir = join(run2Dir, 'compact-planner');
    const planner2Dir = join(run2Dir, 'planner');
    await mkdir(compact2Dir, { recursive: true });
    await mkdir(planner2Dir, { recursive: true });

    // Run 1:
    // episode1 (normal): succeeded step
    // episode2-finalization: should be excluded by default
    const trace1 = {
      runId: 'run1',
      artifacts: {
        trace: { path: join(run1Dir, 'trace.json') },
        compactPlannerViews: [
          { path: join(compact1Dir, 'episode1-compact.json') },
          { path: join(compact1Dir, 'episode2-finalization-compact.json') }
        ]
      },
      steps: [
        {
          kind: 'click',
          targetRef: 'ref_1',
          beforeObservationId: 'obs_1',
          status: 'completed'
        }
      ]
    };

    const view1 = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode1',
      goal: 'Goal 1',
      observationEpoch: { observationId: 'obs_1' },
      actions: [],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const prodOutput1 = {
      plan: [{ tool: 'click', ref: 'ref_1' }],
      confidence: 'high'
    };

    const finalizationView = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode2-finalization',
      goal: 'Finalization Goal',
      observationEpoch: { observationId: 'obs_final' },
      actions: [],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const finalizationProdOutput = {
      done: true,
      confidence: 'high'
    };

    await writeFile(join(run1Dir, 'trace.json'), JSON.stringify(trace1), 'utf8');
    await writeFile(join(compact1Dir, 'episode1-compact.json'), JSON.stringify({ view: view1 }), 'utf8');
    await writeFile(join(planner1Dir, 'episode1-output.json'), JSON.stringify({ output: prodOutput1 }), 'utf8');
    await writeFile(join(compact1Dir, 'episode2-finalization-compact.json'), JSON.stringify({ view: finalizationView }), 'utf8');
    await writeFile(join(planner1Dir, 'episode2-finalization-output.json'), JSON.stringify({ output: finalizationProdOutput }), 'utf8');

    // Run 2:
    // episode3 (normal): failed step
    // episode4 (normal): missing output artifact (should be skipped)
    const trace2 = {
      runId: 'run2',
      artifacts: {
        trace: { path: join(run2Dir, 'trace.json') },
        compactPlannerViews: [
          { path: join(compact2Dir, 'episode3-compact.json') },
          { path: join(compact2Dir, 'episode4-compact.json') }
        ]
      },
      steps: [
        {
          kind: 'type',
          targetRef: 'ref_3',
          beforeObservationId: 'obs_3',
          status: 'failed'
        }
      ]
    };

    const view3 = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode3',
      goal: 'Goal 3',
      observationEpoch: { observationId: 'obs_3' },
      actions: [],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const prodOutput3 = {
      plan: [{ tool: 'type', ref: 'ref_3' }],
      confidence: 'medium'
    };

    const view4 = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode4',
      goal: 'Goal 4'
    };

    await writeFile(join(run2Dir, 'trace.json'), JSON.stringify(trace2), 'utf8');
    await writeFile(join(compact2Dir, 'episode3-compact.json'), JSON.stringify({ view: view3 }), 'utf8');
    await writeFile(join(planner2Dir, 'episode3-output.json'), JSON.stringify({ output: prodOutput3 }), 'utf8');
    // Write view 4 but no output artifact
    await writeFile(join(compact2Dir, 'episode4-compact.json'), JSON.stringify({ view: view4 }), 'utf8');

    // Load episodes - default (exclude finalization)
    const episodesDefault = await loadCompactReplayEpisodes(root);
    assert.equal(episodesDefault.length, 2);

    // Validate deterministic ordering (since they are sorted by compactArtifactPath first, then episodeId)
    assert.equal(episodesDefault[0].episodeId, 'episode1');
    assert.equal(episodesDefault[0].runId, 'run1');
    assert.equal(episodesDefault[0].productionFirstStepExecution, 'succeeded');
    assert.deepEqual(episodesDefault[0].productionOutput, prodOutput1);

    assert.equal(episodesDefault[1].episodeId, 'episode3');
    assert.equal(episodesDefault[1].runId, 'run2');
    assert.equal(episodesDefault[1].productionFirstStepExecution, 'failed');
    assert.deepEqual(episodesDefault[1].productionOutput, prodOutput3);

    // Load episodes - include finalization
    const episodesAll = await loadCompactReplayEpisodes(root, { includeFinalization: true });
    // Finalization should be included now. Total 3 episodes (episode1, episode2-finalization, episode3)
    assert.equal(episodesAll.length, 3);

    const finalizationEp = episodesAll.find(e => e.episodeId === 'episode2-finalization');
    assert.ok(finalizationEp);
    assert.equal(finalizationEp.productionFirstStepExecution, 'not_applicable');
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test('loadCompactReplayEpisodes - absent or ambiguous trace step match becomes not_found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compact-shadow-replay-ambiguous-test-'));

  try {
    const runDir = join(root, 'run');
    await mkdir(runDir, { recursive: true });

    const compactDir = join(runDir, 'compact-planner');
    const plannerDir = join(runDir, 'planner');
    await mkdir(compactDir, { recursive: true });
    await mkdir(plannerDir, { recursive: true });

    // Case A: Absent matching step
    // Case B: Ambiguous matching steps (multiple steps with different status)
    const trace = {
      runId: 'run',
      artifacts: {
        trace: { path: join(runDir, 'trace.json') },
        compactPlannerViews: [
          { path: join(compactDir, 'episode-absent-compact.json') },
          { path: join(compactDir, 'episode-ambiguous-compact.json') }
        ]
      },
      steps: [
        {
          kind: 'click',
          targetRef: 'ref_ambig',
          beforeObservationId: 'obs_ambig',
          status: 'completed'
        },
        {
          kind: 'click',
          targetRef: 'ref_ambig',
          beforeObservationId: 'obs_ambig',
          status: 'failed'
        }
      ]
    };

    const viewAbsent = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode-absent',
      goal: 'Goal',
      observationEpoch: { observationId: 'obs_absent' },
      actions: [],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const prodOutputAbsent = {
      plan: [{ tool: 'click', ref: 'ref_absent' }],
      confidence: 'high'
    };

    const viewAmbiguous = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode-ambiguous',
      goal: 'Goal',
      observationEpoch: { observationId: 'obs_ambig' },
      actions: [],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const prodOutputAmbiguous = {
      plan: [{ tool: 'click', ref: 'ref_ambig' }],
      confidence: 'high'
    };

    await writeFile(join(runDir, 'trace.json'), JSON.stringify(trace), 'utf8');
    await writeFile(join(compactDir, 'episode-absent-compact.json'), JSON.stringify({ view: viewAbsent }), 'utf8');
    await writeFile(join(plannerDir, 'episode-absent-output.json'), JSON.stringify({ output: prodOutputAbsent }), 'utf8');
    await writeFile(join(compactDir, 'episode-ambiguous-compact.json'), JSON.stringify({ view: viewAmbiguous }), 'utf8');
    await writeFile(join(plannerDir, 'episode-ambiguous-output.json'), JSON.stringify({ output: prodOutputAmbiguous }), 'utf8');

    const episodes = await loadCompactReplayEpisodes(root);
    assert.equal(episodes.length, 2);

    const absentEp = episodes.find(e => e.episodeId === 'episode-absent');
    assert.ok(absentEp);
    assert.equal(absentEp.productionFirstStepExecution, 'not_found');

    const ambiguousEp = episodes.find(e => e.episodeId === 'episode-ambiguous');
    assert.ok(ambiguousEp);
    assert.equal(ambiguousEp.productionFirstStepExecution, 'not_found');
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test('runReplay - token averages do not count provider errors and first-step kinds are tracked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compact-shadow-replay-run-test-'));

  try {
    const runDir = join(root, 'run');
    await mkdir(runDir, { recursive: true });

    const compactDir = join(runDir, 'compact-planner');
    const plannerDir = join(runDir, 'planner');
    await mkdir(compactDir, { recursive: true });
    await mkdir(plannerDir, { recursive: true });

    // We will create two episodes:
    // 1. episode1: eligible, will succeed and return 100/50 tokens.
    // 2. episode2: eligible, will fail with a provider error.
    const trace = {
      runId: 'run',
      artifacts: {
        trace: { path: join(runDir, 'trace.json') },
        compactPlannerViews: [
          { path: join(compactDir, 'episode1-compact.json') },
          { path: join(compactDir, 'episode2-compact.json') }
        ]
      },
      steps: [
        {
          kind: 'click',
          targetRef: 'ref_1',
          beforeObservationId: 'obs_1',
          status: 'completed'
        },
        {
          kind: 'click',
          targetRef: 'ref_2',
          beforeObservationId: 'obs_2',
          status: 'completed'
        }
      ]
    };

    const view1 = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode1',
      goal: 'Goal 1',
      observationEpoch: { observationId: 'obs_1' },
      actions: [{ id: 1, refId: 'ref_1', label: 'Button 1', tools: ['clickable'] }],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const prodOutput1 = {
      plan: [{ tool: 'click', ref: 'ref_1' }],
      confidence: 'high'
    };

    const view2 = {
      version: 'compact_planner_view.v1',
      episodeId: 'episode2',
      goal: 'Goal 2',
      observationEpoch: { observationId: 'obs_2' },
      actions: [{ id: 1, refId: 'ref_2', label: 'Button 2', tools: ['clickable'] }],
      reads: [],
      omitted: { originalCurrentRefs: 0, originalPrimaryRefs: 0, originalSecondaryRefs: 0, originalReadableEvidence: 0 }
    };

    const prodOutput2 = {
      plan: [{ tool: 'click', ref: 'ref_2' }],
      confidence: 'high'
    };

    await writeFile(join(runDir, 'trace.json'), JSON.stringify(trace), 'utf8');
    await writeFile(join(compactDir, 'episode1-compact.json'), JSON.stringify({ view: view1 }), 'utf8');
    await writeFile(join(plannerDir, 'episode1-output.json'), JSON.stringify({ output: prodOutput1 }), 'utf8');
    await writeFile(join(compactDir, 'episode2-compact.json'), JSON.stringify({ view: view2 }), 'utf8');
    await writeFile(join(plannerDir, 'episode2-output.json'), JSON.stringify({ output: prodOutput2 }), 'utf8');

    // Set mock environment variables
    const originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = 'mock-key';
    process.env.BROWSEGENT_GEMINI_RETRIES = '1';

    // Mock global fetch
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      callCount++;
      if (callCount === 1) {
        // Success response
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    { text: JSON.stringify({ plan: [{ tool: 'click', ref: 'a1' }], confidence: 'high' }) }
                  ]
                }
              }
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 50
            }
          })
        } as any;
      } else {
        // Provider error (throw an error)
        throw new Error('Mock fetch network error');
      }
    };

    try {
      await runReplay({
        root,
        model: 'gemini/gemini-3.1-flash-lite',
        maxEpisodes: 10,
        keyIndex: 1,
        requestRpm: 60,
        includeFinalization: false,
        dryRun: false
      });

      // Verify report contents
      const reportJsonPath = join(root, 'compact-shadow', 'compact_shadow_report.json');
      const report = JSON.parse(await readFile(reportJsonPath, 'utf8'));

      console.log('DIAGNOSTIC - REPORT RESULTS:', JSON.stringify(report.results, null, 2));

      assert.equal(report.selectedEpisodes, 2);
      assert.equal(report.eligibleEpisodes, 2);
      assert.equal(report.ineligibleEpisodes, 0);
      assert.equal(report.tokenMeasuredCalls, 1);
      assert.equal(report.validOutputs, 1);
      assert.equal(report.providerErrors, 1);
      assert.equal(report.averageInputTokensMeasured, 100);
      assert.equal(report.averageOutputTokensMeasured, 50);

      // Check first-step kinds
      assert.deepEqual(report.productionFirstStepKindCounts, {
        ref_action: 2,
        no_ref_action: 0,
        termination: 0,
        empty: 0
      });
    } finally {
      // Restore global fetch and env
      globalThis.fetch = originalFetch;
      process.env = originalEnv;
    }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
