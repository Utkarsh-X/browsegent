import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';
import type { PlannerInput } from '../../../../src/v2/planner/types';

function findPlannerInputFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findPlannerInputFiles(fullPath, out);
    } else if (entry.endsWith('-input.json')) {
      out.push(fullPath);
    }
  }
  return out;
}

function loadTraceInput(): PlannerInput | undefined {
  const files = findPlannerInputFiles(join(process.cwd(), 'logs', 'webvoyager-lite'));
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // skip malformed files
    }
    const candidate = ((parsed as Record<string, unknown>).plannerInput ?? parsed) as Partial<PlannerInput>;
    if (candidate.version && candidate.current?.refs && candidate.current?.interactions && candidate.uncertainty) {
      return candidate as PlannerInput;
    }
  }
  return undefined;
}

test('PRC trace replay: compact render preserves key planner refs and is smaller than raw JSON', (t) => {
  const input = loadTraceInput();
  if (!input) {
    t.skip('No logs/webvoyager-lite planner input trace found');
    return;
  }

  const rawJson = `Planner input JSON:\n${JSON.stringify(input)}`;
  const ir = new PlannerRepresentationCompiler().compile(input);
  const rendered = `Planner input:\n${new PromptLayoutEngine().render(ir)}`;

  assert.ok(
    Buffer.byteLength(rendered, 'utf8') < Buffer.byteLength(rawJson, 'utf8'),
    'PRC render should be smaller than raw planner JSON',
  );

  const surface = input.workingSet?.actionSurface;
  if (surface) {
    // Action-surface refs always appear in PLANNER SURFACE section
    for (const refId of [
      ...surface.clickableRefs,
      ...surface.typeableRefs,
      ...surface.selectableRefs,
      ...surface.readableRefs,
    ]) {
      assert.ok(
        rendered.includes(refId),
        `action-surface ref ${refId} must appear in PRC render (PLANNER SURFACE section)`,
      );
    }
  }

  for (const failure of input.failures ?? []) {
    if (!failure.targetRef) continue;
    assert.ok(rendered.includes(failure.targetRef), `failure target ${failure.targetRef} must appear in PRC render`);
  }

  const selectableRefs = new Set(surface?.selectableRefs ?? []);
  for (const ref of Object.values(input.current.refs)) {
    if (!selectableRefs.has(ref.refId) || !ref.selectOptions?.length) continue;
    assert.ok(rendered.includes(ref.refId), `selectable ref ${ref.refId} must be visible in PRC render`);
    for (const option of ref.selectOptions) {
      assert.ok(rendered.includes(option), `select option "${option}" for ${ref.refId} must not be truncated or dropped`);
    }
  }
});
