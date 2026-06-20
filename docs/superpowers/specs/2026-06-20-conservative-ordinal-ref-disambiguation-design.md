# Conservative Ordinal Ref Disambiguation Design

## Status

Approved design for the next BrowseGent V2 ref-resolution hardening slice.

## Problem

`ObservationService` records `nthRoleName`, but `RefResolver` deliberately does not use it. An earlier implementation awarded ordinal identity too broadly, allowing unrelated same-role elements to gain false uniqueness. Removing that behavior restored the required safety property, but exact duplicate controls can still end in `ambiguous_ref_resolution`.

The objective is to recover only current, live references whose duplicate position is still supported by exact semantic evidence. A wrong action is more harmful than an explicit ambiguity failure.

## Decision

Use ordinal evidence only as a deterministic final tie-break among candidates with the same exact semantic identity:

1. The candidate is visible and already admitted by the resolver's bounded selector search.
2. The ref is live and originates from the harness's current observation.
3. The candidate role exactly matches the ref role after shared normalization.
4. The candidate accessible name exactly matches the ref accessible name after shared normalization.
5. The candidate belongs to the same ordered role/name group used to calculate `nthRoleName`.
6. The candidate's live ordinal in that group equals the ref's recorded ordinal.

Ordinal evidence must not add a general score bonus, admit a weak candidate, or create identity from role, name, text, geometry, or position alone.

## Architecture

Keep the change inside the substrate boundary:

- `ObservationService` remains responsible for recording semantic identity and ordinal metadata.
- `RefResolver` remains responsible for live verification and safe disambiguation.
- Planner prompts, Brain1/Brain2 behavior, graph state, ref lanes, and extraction lanes do not change.
- No AX-tree, visual, fuzzy, XPath, site-specific, or LLM-based fallback is introduced.

The implementation should share or exactly mirror normalization and accessible-name rules between observation and resolution. If those rules cannot be made equivalent in this slice, ordinal resolution must fail closed.

## Resolution Flow

The existing bounded selector collection and candidate scoring run first.

When multiple candidates share the highest score:

1. Check that the ref is live and belongs to the current harness observation.
2. Check that the ref has a non-empty role, non-empty accessible name, and positive `nthRoleName`.
3. Restrict consideration to tied candidates whose normalized live role and accessible name exactly equal the ref values.
4. Build the live semantic group from visible interactive elements with that exact normalized role/name pair.
5. Preserve deterministic document order within the current document or frame.
6. Select a candidate only when exactly one tied candidate occupies the recorded ordinal.
7. Otherwise retain `ambiguous_ref_resolution`.

Ordinal indexing must use one convention throughout observation and resolution. BrowseGent currently records a one-based ordinal, so the resolver must treat `1` as the first matching element.

The ordinal path must not bypass existing overflow safeguards. A broad selector that overflows remains subject to the current candidate cap and weak-selector rejection.

Ordinal resolution is not a stale-ref healing mechanism. A weakened, invalid, or non-current ref must continue through the existing recovery policy rather than gaining identity from position.

## Accessible Name Contract

Ordinal matching requires an accessible name, not arbitrary page text. The resolver may use the same bounded sources used by observation, such as explicit ARIA labeling and native control naming, but it must not substitute unrelated descendant text when the observation recorded a different name.

If the observation and resolver cannot establish the same normalized accessible name, the candidate is not eligible for ordinal disambiguation.

Text-only duplicate elements are outside this slice. They remain ambiguous unless existing resolver evidence already yields a unique target.

## Safety Rules

The resolver must fail with `ambiguous_ref_resolution` when:

- role, accessible name, or ordinal metadata is missing;
- the ref is not live in the current observation;
- no exact semantic group exists;
- the recorded ordinal is outside the live group;
- more than one candidate maps to the ordinal;
- document/frame scope cannot be reproduced consistently;
- candidate collection overflow or existing safety checks reject the result.

The resolver must never:

- use ordinal among role-only or name-only matches;
- apply fuzzy name or text similarity;
- use geometry as semantic identity;
- select the closest ordinal;
- silently fall back to the first match;
- expand the candidate cap to improve benchmark success.

## Residual Risk

Role, accessible name, and ordinal describe a semantic position, not a durable entity identity. If two semantically identical controls reorder after observation without BrowseGent observing the transition, ordinal matching cannot prove that the underlying entity is unchanged.

This slice limits that risk by allowing ordinal disambiguation only for a live ref from the current observation and by refusing all weakened or stale recovery. It does not claim durable identity across arbitrary DOM mutation. Eliminating that residual requires separately designed context identity, backend-node fast-path resolution, or mutation-epoch verification.

## Diagnostics

Successful ordinal resolution should report:

- `reason: resolved_exact_semantic_ordinal`;
- normalized role and name;
- expected ordinal;
- semantic group size;
- selected candidate identity key.

Failed ordinal attempts should preserve `ambiguous_ref_resolution` and report a bounded reason such as:

- `ordinal_metadata_incomplete`;
- `exact_semantic_group_missing`;
- `ordinal_out_of_range`;
- `ordinal_candidate_not_unique`;
- `semantic_scope_unstable`.

Diagnostics must stay bounded and must not serialize full DOM, AX trees, or large text regions.

## Test Strategy

Use TDD with focused resolver tests before implementation.

Required cases:

1. Two exact role/name duplicates resolve to the recorded ordinal.
2. Unrelated same-role candidates receive no ordinal advantage.
3. Same-role candidates with different accessible names receive no ordinal advantage.
4. Name-only or text-only matches cannot use ordinal identity.
5. Missing or out-of-range ordinal metadata remains ambiguous.
6. Duplicate candidates that cannot be mapped uniquely remain ambiguous.
7. A live current-observation ref with preserved exact semantic order resolves safely.
8. A weakened, stale, or non-current ref cannot use ordinal resolution.
9. Existing candidate bounds and overflow behavior remain unchanged.
10. Existing stale, blocked, and detached recovery tests remain green.

After focused tests pass, run the V2 unit and integration suites plus build and static V2 checks. Do not use benchmark score as the acceptance criterion for this slice.

## Deferred Work

Local parent, sibling, row, region, continuity-graph, AX, or visual context may improve duplicate resolution, but BrowseGent does not currently expose a proven stable and bounded context signature for this purpose. That capability requires separate trace evidence, design, and tests.

Browser Use-style permissive fallback ladders and Alumnium-style fuzzy instruction caching are also excluded. They optimize recovery rate but do not satisfy this slice's identity-proof requirement.

## Acceptance Criteria

The slice is complete when:

- an exact semantic duplicate can be selected by its recorded ordinal;
- ordinal evidence cannot distinguish semantically different candidates;
- ordinal evidence cannot heal stale, weakened, or non-current refs;
- all uncertain cases fail explicitly without a browser action;
- diagnostics explain ordinal success or refusal without context bloat;
- existing resolver safety bounds and regression suites pass;
- no planner, prompt, benchmark, website, or architecture-specific tuning is introduced.
