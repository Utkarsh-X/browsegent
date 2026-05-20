import test from 'node:test';
import assert from 'node:assert/strict';

async function loadBoundaryChecker() {
  try {
    return await import('../../../scripts/check_v2_boundaries');
  } catch (error) {
    assert.fail(`expected v2 boundary checker module to exist: ${(error as Error).message}`);
  }
}

async function loadCognitionChecker() {
  try {
    return await import('../../../scripts/check_v2_no_cognition_leakage');
  } catch (error) {
    assert.fail(`expected v2 cognition leakage checker module to exist: ${(error as Error).message}`);
  }
}

test('v2 boundary checker flags forbidden dependency directions', async () => {
  const { checkV2Boundaries } = await loadBoundaryChecker();

  const result = checkV2Boundaries([
    {
      path: 'src/v2/substrate/ObservationService.ts',
      content: "import { buildPrompt } from '../../agent/prompt';\n",
    },
    {
      path: 'src/v2/runtime/FailureClassifier.ts',
      content: "import { PlannerInputComposer } from '../planner/PlannerInputComposer';\n",
    },
    {
      path: 'src/v2/graph/ContinuityGraph.ts',
      content: "import { createProvider } from '../../providers';\n",
    },
    {
      path: 'src/v2/brain1/ProjectionService.ts',
      content: "import { ContinuityInterpreter } from '../brain2/ContinuityInterpreter';\n",
    },
    {
      path: 'src/v2/runtime/TransitionService.ts',
      content: "import { TraceStore } from '../trace/TraceStore';\n",
    },
    {
      path: 'src/BrowseGent.ts',
      content: "import { scenarios } from '../tests/eval/v2/continuity_scenarios';\n",
    },
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map(violation => violation.ruleId),
    [
      'substrate-no-agent-imports',
      'runtime-no-planner-or-provider-imports',
      'graph-no-llm-or-provider-imports',
      'brain1-no-brain2-imports',
      'runtime-services-no-trace-imports',
      'src-no-eval-imports',
    ],
  );
});

test('v2 boundary checker accepts approved runtime dependency directions', async () => {
  const { checkV2Boundaries } = await loadBoundaryChecker();

  const result = checkV2Boundaries([
    {
      path: 'src/v2/brain2/ContinuityInterpreter.ts',
      content: "import { ContinuityGraph } from '../graph/ContinuityGraph';\n",
    },
    {
      path: 'src/v2/harness/BrowseGentV2Harness.ts',
      content: "import { TraceStore } from '../trace/TraceStore';\n",
    },
    {
      path: 'src/v2/adapter/V1CompatibilityAdapter.ts',
      content: "import { PlannerInputComposer } from '../planner/PlannerInputComposer';\n",
    },
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('v2 cognition checker flags strategic phrases in protected runtime modules only', async () => {
  const { checkV2NoCognitionLeakage } = await loadCognitionChecker();

  const result = checkV2NoCognitionLeakage([
    {
      path: 'src/v2/runtime/FailureClassifier.ts',
      content: "const message = 'try another workflow';\n",
    },
    {
      path: 'src/v2/brain1/ProjectionService.ts',
      content: "const note = 'task complete';\n",
    },
    {
      path: 'docs/governance/CI_AND_ENFORCEMENT.md',
      content: 'The governance docs may discuss workflow checks.\n',
    },
    {
      path: 'src/v2/planner/types.ts',
      content: "export const plannerPhrase = 'user wants';\n",
    },
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map(violation => `${violation.phrase}:${violation.path}`),
    [
      'try another:src/v2/runtime/FailureClassifier.ts',
      'workflow:src/v2/runtime/FailureClassifier.ts',
      'task complete:src/v2/brain1/ProjectionService.ts',
    ],
  );
});

test('v2 cognition checker accepts operational text in protected runtime modules', async () => {
  const { checkV2NoCognitionLeakage } = await loadCognitionChecker();

  const result = checkV2NoCognitionLeakage([
    {
      path: 'src/v2/runtime/FailureClassifier.ts',
      content: "const message = 'target is blocked by an overlay';\n",
    },
    {
      path: 'src/v2/graph/ContinuityGraph.ts',
      content: "const state = 'structural_local';\n",
    },
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});
