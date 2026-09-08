# World-model C6 fixture pack (round 3)

Recorded-episode fixtures for the C6 replay-verification gate
(`progress-docs/research/world-model-round3.md` §4). Each fixture is one
consecutive-episode pair copied **verbatim** from read-only run artifacts
(runs 18–22), plus the expected renders computed by the validated Python
renderer port (97.2% byte-exact against `providerPayload.userBytes`, median 0 B).

## Files per fixture `<name>`

| File | Content |
|---|---|
| `<name>.prev.input.json` | pre-render `PlannerInput` of episode N−1 (carry + line-identity source) |
| `<name>.cur.input.json` | pre-render `PlannerInput` of episode N (the render target) |
| `<name>.expected.full.txt` | expected **off-flag** SQ render of the cur input — byte-exact |
| `<name>.expected.wire.txt` | expected **pageModel+deltaSurface** L1 payload with the W2 wire surface — byte-exact |
| `manifest.json` | provenance, pair facts, byte lengths, invariant checklist |

## Assertions the TS harness makes (full list in manifest.json)

1. off-flag payload byte-identical to `expected.full.txt`;
2. H4 invariants: zero displacement, zero lane loss, K=32 carried cap, additive only;
3. wire parity: L1 + marker-normalized + W2 stable refs (`  [id] <kind name=".." />`)
   equals `expected.wire.txt` byte-exact;
4. stateless completeness: every plan-step ref of the cur episode appears with
   kind + name in the wire surface (full or minimal line);
5. always-full: every input/select/failed/changed ref renders a full line.

## Regeneration

Fixture pack exported by `%TEMP%\browsegent-wm\wm_r3_fixtures.py` (simulation
harness; lives outside the repo). Source artifacts are read-only run logs —
do not edit fixture inputs; re-export instead if the wire spec changes.

Coverage: 2 reuse, 1 microstate (K=32 cap-bound), 3 structural_local
(one cap-bound, one stable=0 edge), 4 navigation (one hard_reset, one
wire-loses pair, carried 0–17 refs/pair).
