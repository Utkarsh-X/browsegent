# Efficiency Root-Cause Audit

Left: browsegent (webvoyager_lite_1780799594140)
Right: browser-use-local (webvoyager_lite_1780800317301)

| Metric | Left | Right | Left/Right |
| --- | ---: | ---: | ---: |
| Input tokens | 612683 | 188813 | 3.24x |
| Output tokens | 1483 | 17687 | 0.08x |
| Planner calls | 41 | 23 | 1.78x |
| Tool executions | 48 | 23 | 2.09x |
| Duration ms | 359407 | 378602 | 0.95x |

## BrowseGent Planner Input Section Breakdown

| Task | Inputs | Max Bytes | Avg Bytes | Max Refs | Max Primary | Max Secondary | Max Readable Evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| webvoyager_Cambridge__Dictionary__0 | 4 | 49825 | 48145 | 80 | 32 | 48 | 48 |
| webvoyager_ArXiv__0 | 13 | 58017 | 43294 | 80 | 32 | 48 | 48 |
| webvoyager_GitHub__0 | 9 | 59821 | 53368 | 80 | 32 | 48 | 48 |
| webvoyager_Google__Map__10 | 9 | 46669 | 34265 | 80 | 32 | 48 | 48 |
| webvoyager_Wolfram__Alpha__0 | 6 | 47094 | 35824 | 80 | 32 | 48 | 48 |

## Ref Execution Failure Audit

| Task | Total Failures | Failure Kinds | Repeated Target Refs |
| --- | ---: | --- | --- |
| webvoyager_Cambridge__Dictionary__0 | 1 | timeout:1 | none |
| webvoyager_ArXiv__0 | 9 | ambiguous_ref_resolution:7, timeout:2 | v2ref_333:1, v2ref_361:1, v2ref_425:1, v2ref_459:1, v2ref_472:1 |
| webvoyager_GitHub__0 | 5 | ambiguous_ref_resolution:2, low_confidence_ref:2, target_blocked:1 | v2ref_667:2, v2ref_1028:1, v2ref_1462:1, v2ref_254:1 |
| webvoyager_Google__Map__10 | 0 | none | none |
| webvoyager_Wolfram__Alpha__0 | 0 | none | none |

## Offline Compact Planner View Audit

| Task | Inputs | Avg Original Bytes | Avg Compact Bytes | Avg Compact/Original | Max Original | Max Compact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| webvoyager_Cambridge__Dictionary__0 | 4 | 48145 | 5468 | 11.4% | 49825 | 5605 |
| webvoyager_ArXiv__0 | 13 | 43294 | 5261 | 13.3% | 58017 | 6053 |
| webvoyager_GitHub__0 | 9 | 53368 | 5288 | 9.8% | 59821 | 8492 |
| webvoyager_Google__Map__10 | 9 | 34265 | 4490 | 15.5% | 46669 | 5968 |
| webvoyager_Wolfram__Alpha__0 | 6 | 35824 | 4876 | 14.9% | 47094 | 5387 |

## Initial Interpretation

- Worst BrowseGent input-token task: webvoyager_ArXiv__0.
- Worst BrowseGent ref-failure task: webvoyager_ArXiv__0 (9 failures).
- Input-token ratio left/right: 3.24x.
- Planner-call ratio left/right: 1.78x.
- This report is diagnostic only. Do not change runtime behavior from this output without the decision gate.

## Decision Gate

### Evidence Summary

- Token parity confidence: High. Accounted for by BrowseGent's `current` (full page refs) and `workingSet` (duplicated subsets) being serialized as verbose JSON objects.
- Biggest input-token cause: `current + workingSet duplication`, average original size of ~41.0 KB (mostly composed of `current.refs` and `workingSet.primaryRefs`/`secondaryRefs`).
- Biggest step-count cause: `ambiguous_ref_resolution` and `timeout`, with 9 failures on ArXiv and 5 failures on GitHub.
- Compact view average reduction: 13.0% of original size (an 87.0% reduction, bringing average payload from 41.0 KB down to ~5.0 KB).
- Remaining quality risk: Planner lacks granular structural details (like parent-child element nesting) and has only brief text labels/roles, which might increase `ambiguous_ref_resolution` rates if labels are similar.

### Decision

**1. Continue graph architecture with compact planner view.**

### Required Next Plan

- Create a runtime compact-planner-view implementation plan.
- Start with telemetry-only mode (log compact size alongside production runs).
- Compare current vs compact prompts on same traces before enforcing.

