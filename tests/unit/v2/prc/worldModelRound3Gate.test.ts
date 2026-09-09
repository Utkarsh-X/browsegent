import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PlannerRepresentationCompiler } from '../../../../src/v2/planner/prc/PlannerRepresentationCompiler';
import { PromptLayoutEngine } from '../../../../src/v2/planner/prc/PromptLayoutEngine';

/**
 * World-model round-3 C6 replay gate (progress-docs/research/world-model-round3.md §2.4–2.6).
 *
 * Fixtures are verbatim consecutive-episode pairs from validated runs, with the
 * expected renders computed by the validated Python renderer port. Two exporter
 * artifacts are corrected for, each documented in the fixture README:
 *
 * 1. Simulated carried lines: the exporter renders carried refs from observation
 *    records the pack does not ship. In production carried refs are ordinary
 *    working-set elements in `cur.refs`, so the expected wire is filtered to
 *    refs the pack's inputs actually contain before byte comparison.
 * 2. Exporter marker-strip bug: the exporter's delta-marker regex
 *    (` \+(?:chg|new)(?=/>)`) never matches the real render (` +new />`), so its
 *    classification baseline keeps delta markers and refs that appeared in the
 *    previous episode stay "changed" (full) in the fixtures. Production follows
 *    the report's spec (§2.4: stable = content-unchanged), so those refs render
 *    minimal. The parity assertion therefore compares per-line content, not
 *    full/minimal class, for the three affected fixtures — and byte-exact
 *    everywhere else.
 */

const FIXTURE_DIR = join(__dirname, 'fixtures', 'worldmodel');

const fixtureNames: string[] = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.cur.input.json'))
  .map(f => f.replace('.cur.input.json', ''))
  .sort();

const compile = (input: unknown) =>
  new PlannerRepresentationCompiler().compile(input as never, { stableOrder: false });

const engine = new PromptLayoutEngine();

const renderOff = (input: unknown): string =>
  engine.render(compile(input), { leanPlane: true });

const prevSurfaceLines = (input: unknown): string[] =>
  engine.render(compile(input), { leanPlane: true, pageModel: true })
    .split('\n')
    .filter(line => /^    \[v2ref[^\]]+\]/.test(line));

const renderWire = (input: unknown, prevLines: readonly string[] | undefined): string =>
  engine.render(compile(input), {
    leanPlane: true,
    pageModel: true,
    deltaSurface: true,
    previousSurfaceLines: prevLines,
  });

/** Expected wire minus the exporter's simulated carried lines (artifact 1). */
const reproducibleExpectedWire = (expectedWire: string, curRefIds: Set<string>): string =>
  expectedWire
    .split('\n')
    .filter(line => {
      const m = /^\s*\[(v2ref[^\]]+)\]/.exec(line);
      return !m || curRefIds.has(m[1]);
    })
    .join('\n');

/** Element lines of a payload, keyed by ref id, with their indent class. */
const elementLinesOf = (payload: string): Map<string, { line: string; minimal: boolean }> => {
  const byRef = new Map<string, { line: string; minimal: boolean }>();
  for (const line of payload.split('\n')) {
    const m = /^\s*\[(v2ref[^\]]+)\]/.exec(line);
    if (m) byRef.set(m[1], { line: line.trim(), minimal: line.startsWith('  [') });
  }
  return byRef;
};

describe('world-model round-3 C6 replay gate', () => {
  it('has a non-empty fixture pack', () => {
    assert.ok(fixtureNames.length >= 10, `expected >=10 fixtures, found ${fixtureNames.length}`);
  });

  it('(1) off-flag lean payload is byte-identical to expected.full.txt for every fixture', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const expected = readFileSync(join(FIXTURE_DIR, `${name}.expected.full.txt`), 'utf-8').replace(/\r\n/g, '\n');
      const actual = `Planner input:\n${renderOff(cur)}`;
      assert.equal(
        Buffer.compare(Buffer.from(actual, 'utf-8'), Buffer.from(expected, 'utf-8')),
        0,
        `off-path byte identity failed for ${name}`,
      );
    }
  });

  it('(2) wire payload matches expected.wire.txt (artifact-corrected)', () => {    let exactFixtures = 0;
    let artifactFixtures = 0;
    let totalFlips = 0;
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const prev = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.prev.input.json`), 'utf-8'));
      const expectedWire = readFileSync(join(FIXTURE_DIR, `${name}.expected.wire.txt`), 'utf-8').replace(/\r\n/g, '\n');
      const curRefIds = new Set(Object.keys((cur as { current: { refs: Record<string, unknown> } }).current.refs));

      const actual = `Planner input:\n${renderWire(cur, prevSurfaceLines(prev))}`;
      const expected = reproducibleExpectedWire(expectedWire, curRefIds);

      if (actual === expected) {
        exactFixtures += 1;
        continue;
      }

      // Artifact-2-corrected comparison: the exporter's delta-marker strip regex
      // (` \\+(?:chg|new)(?=/>)`) never matches the real render (` +chg />`), so its
      // classification baseline keeps markers and refs that DROPPED their marker
      // between prev and cur stay "changed" (full) in the fixture. Production
      // follows the spec (stable = content-unchanged) and renders them minimal.
      // A class flip is accepted only when the expected full line, delta-stripped,
      // equals the previous render's marker-free line — proving the content did
      // not change, so the minimal render is spec-faithful.
      const prevByRef = new Map<string, string>();
      for (const line of prevSurfaceLines(prev)) {
        const m = /^\s*\[(v2ref[^\]]+)\]/.exec(line);
        if (m) prevByRef.set(m[1], line.trim());
      }
      const actualLines = elementLinesOf(actual);
      const expectedLines = elementLinesOf(expected);
      assert.equal(actualLines.size, expectedLines.size, `${name}: element count differs`);
      let flips = 0;
      for (const [refId, expectedEntry] of expectedLines) {
        const actualEntry = actualLines.get(refId);
        assert.ok(actualEntry, `${name}: ref ${refId} missing from production wire`);
        if (actualEntry.line === expectedEntry.line) continue;
        assert.ok(
          !expectedEntry.minimal && actualEntry.minimal,
          `${name}: unexpected line difference for ${refId}\n  exp: ${JSON.stringify(expectedEntry.line)}\n  act: ${JSON.stringify(actualEntry.line)}`,
        );
        const stripped = expectedEntry.line.replace(/ \+(?:chg|new) \/>/, ' />');
        assert.equal(
          stripped,
          prevByRef.get(refId),
          `${name}: class flip for ${refId} is not the documented marker-drop artifact`,
        );
        flips += 1;
      }
      // Non-element lines (headers, structure) must match byte-exactly.
      const stripElements = (s: string) =>
        s.split('\n').filter(l => !/^\s*\[v2ref[^\]]+\]/.test(l)).join('\n');
      assert.equal(stripElements(actual), stripElements(expected), `${name}: non-element wire structure differs`);
      artifactFixtures += 1;
      totalFlips += flips;
    }
    assert.ok(exactFixtures + artifactFixtures === fixtureNames.length);
    // The artifact is bounded: only refs that dropped a marker flip class.
    assert.ok(totalFlips <= 32, `unexpected flip volume: ${totalFlips}`);
  });

  it('(3) wire surface structure: full block then minimal block, then CONTINUITY header', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const prev = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.prev.input.json`), 'utf-8'));
      const payload = renderWire(cur, prevSurfaceLines(prev));
      const surfaceStart = payload.indexOf('PLANNER SURFACE');
      assert.ok(surfaceStart >= 0, `no PLANNER SURFACE in ${name}`);
      const surfaceEnd = payload.indexOf('\nSTATE\n', surfaceStart);
      const surface = payload.slice(surfaceStart, surfaceEnd === -1 ? undefined : surfaceEnd);
      const lines = surface.split('\n');
      const fullIdx = lines.map((l, i) => (l.startsWith('    [v2ref') ? i : -1)).filter(i => i >= 0);
      const miniIdx = lines.map((l, i) => (l.startsWith('  [v2ref') ? i : -1)).filter(i => i >= 0);

      if (fullIdx.length > 0 && miniIdx.length > 0) {
        assert.ok(Math.max(...fullIdx) < Math.min(...miniIdx), `${name}: full block must precede minimal block`);
        assert.deepEqual(miniIdx, miniIdx.map((_, k) => miniIdx[0] + k), `${name}: minimal block must be contiguous`);
      }
      const continuityIdx = lines.findIndex(l => l.includes('CONTINUITY:'));
      if (continuityIdx >= 0 && miniIdx.length > 0) {
        assert.ok(Math.min(...miniIdx) < continuityIdx, `${name}: CONTINUITY header must follow the surface blocks`);
      }
      // No STABLE REFS id-list line exists under W2 (report §2.4).
      assert.ok(!surface.includes('STABLE REFS'), `${name}: STABLE REFS line leaked into W2 wire`);
    }
  });

  it('(4) stateless completeness: every cur.refs ref appears with kind+name in the wire', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const prev = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.prev.input.json`), 'utf-8'));
      const payload = renderWire(cur, prevSurfaceLines(prev));
      const refs = (cur as { current: { refs: Record<string, { kind: string; name: string }> } }).current.refs;

      for (const [refId, ref] of Object.entries(refs)) {
        const line = payload.split('\n').find(l => l.includes(`[${refId}]`));
        assert.ok(line, `${name}: ref ${refId} missing from wire payload entirely`);
        assert.match(line as string, new RegExp(`\\[${refId}\\] <${ref.kind} `), `${name}: ref ${refId} missing kind`);
        assert.match(line as string, /name="/, `${name}: ref ${refId} missing name attr`);
      }
    }
  });

  it('(5) always-full: failed, input/select, autocomplete/haspopup refs never render minimal', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const prev = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.prev.input.json`), 'utf-8'));
      const payload = renderWire(cur, prevSurfaceLines(prev));
      const ir = compile(cur);
      for (const element of ir.surface.elementsInRefOrder) {
        const alwaysFull = element.failure
          || element.kind === 'input'
          || element.kind === 'select'
          || Boolean(element.ariaAutocomplete)
          || Boolean(element.ariaHasPopup);
        if (!alwaysFull) continue;
        const line = payload.split('\n').find(l => l.includes(`[${element.refId}]`));
        assert.ok(line, `${name}: always-full ref ${element.refId} missing from wire`);
        assert.ok(line.startsWith('    [v2ref'), `${name}: always-full ref ${element.refId} rendered minimal: ${line}`);
      }
    }
  });

  it('(6) first-episode safety: no baseline means everything renders full', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const payload = renderWire(cur, undefined);
      const minimalElementLines = payload.split('\n')
        .filter(l => /^ {2}\[v2ref[^\]]+\] <[a-z]+ name="/.test(l));
      assert.equal(minimalElementLines.length, 0, `${name}: refs rendered minimal without a previous render`);
    }
  });

  it('(7) off-path byte identity: pageModel off ignores deltaSurface entirely', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const off = renderOff(cur);
      const offWithFlag = engine.render(compile(cur), {
        leanPlane: true,
        deltaSurface: true,
        previousSurfaceLines: ['  [v2ref_x] <generic name="x" />'],
      });
      assert.equal(off, offWithFlag, `${name}: deltaSurface leaked into the off-path`);
    }
  });

  it('(8) wire surface is never larger than the page-model full surface for the same input', () => {
    for (const name of fixtureNames) {
      const cur = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.cur.input.json`), 'utf-8'));
      const prev = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.prev.input.json`), 'utf-8'));
      const full = engine.render(compile(cur), { leanPlane: true, pageModel: true });
      const wire = renderWire(cur, prevSurfaceLines(prev));
      const surfaceOf = (s: string) => {
        const start = s.indexOf('PLANNER SURFACE');
        const end = s.indexOf('\nSTATE\n', start);
        return s.slice(start, end === -1 ? undefined : end);
      };
      assert.ok(
        Buffer.byteLength(surfaceOf(wire)) <= Buffer.byteLength(surfaceOf(full)),
        `${name}: wire surface larger than full surface`,
      );
    }
  });
});
