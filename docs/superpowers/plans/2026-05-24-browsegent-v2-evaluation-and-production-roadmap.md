# BrowseGent v2 Evaluation and Production Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement follow-up implementation plans task-by-task. This roadmap is the operating design for evaluation and product-readiness; each implementation slice must get its own TDD plan before code changes.

**Goal:** Move BrowseGent v2 from MVR proof-of-concept to production-grade open-source browser-agent system through honest local testing, lightweight benchmarking, competitor comparison, and disciplined failure-driven hardening.

**Architecture:** Keep the v2 core bounded, replayable, observable, and planner-cognitive/runtime-non-cognitive. Expose a user-facing agent API and benchmark adapter layer above the v2 loop without letting evaluations or competitor APIs shape runtime behavior directly.

**Tech Stack:** TypeScript, Playwright, BrowseGent v2 harness, v2 planner loop, v2 trace replay, local deterministic fixtures, optional competitor adapters for browser-use, Stagehand/Browserbase, and Browser Harness.

---

## Current Position

BrowseGent v2 is MVR-ready for local testing. The current system has a browser-backed v2 agent loop, stable refs, operational projection, transition evidence, failure evidence, replay artifacts, and a release gate that can run without `.env`.

This is not yet production-grade. The immediate gap is not only task success; it is the lack of a neutral benchmark harness, public task API, competitor adapter contract, and strict anti-overfitting process.

## External Reference Model

The competitor landscape shows three patterns BrowseGent must support without copying their architecture:

- browser-use exposes a task-first API where users provide natural-language tasks, model/browser settings, files, structured output, max steps, and can inspect results/history.
- Stagehand exposes precise primitives: `observe`, `act`, `extract`, and `agent`, combining deterministic code paths with natural-language action resolution.
- Browserbase emphasizes production infrastructure: persistent sessions, real-time observability, recordings, deterministic evaluation environments, and human-verifiable evaluation data.
- Browser Harness is CDP-first and self-healing, where agents can edit helper functions around a thin browser harness.

BrowseGent should compete by exposing similar usability while preserving its own differentiator: ref-first continuity, trace replay, failure evidence, and explicit architecture boundaries.

## Non-Negotiable Operating Rules

1. Benchmarks are diagnostic, not the product.
2. No benchmark-specific runtime branches, prompts, domain rules, page heuristics, or answer shortcuts.
3. Any benchmark failure fix must identify a generic failure class.
4. Generic failure classes must be reproduced in local deterministic fixtures before runtime behavior changes.
5. Runtime fixes may expose operational evidence only; planner remains the only semantic decision-maker.
6. Every mutating browser action must remain trace-replayable.
7. Public claims must include denominator, task source, model, browser mode, retries, scorer, and known exclusions.
8. Competitor comparison must separate same-model fairness from best-available product comparison.

## Target User-Facing API

BrowseGent needs a public interface that accepts inputs like other browser agents while mapping cleanly into v2:

```ts
const result = await browsegent.run("Find the first visible product price", {
  url: "https://example.com",
  maxSteps: 12,
  model: "provider/model",
  output: "text",
  browser: {
    headless: true,
    profileDir: ".browsegent/profile",
    cdpUrl: undefined,
    viewport: { width: 1280, height: 720 },
  },
  trace: true,
});
```

Primitive-style API should also exist:

```ts
await bg.observe("find checkout controls");
await bg.act("click the submit button");
await bg.extract("extract product price", schema);
await bg.agent("complete this workflow", { maxSteps: 20 });
```

The first implementation should expose the task-first API and a BrowseGent benchmark adapter. The primitive API can follow after benchmark harness foundations exist.

## Evaluation Stack

### Layer 1: MVR Correctness Gate

Purpose: prove local contracts, replay, boundaries, and no-v1-regression.

Command:

```powershell
npm run check:v2:release
```

Required evidence:

- TypeScript build passes.
- Unit tests pass.
- v2 governance checks pass.
- Browser-backed v2 integration tests pass.
- Continuity stress passes.
- Agent smoke passes.
- Provider smoke skips cleanly unless explicitly enabled.
- Trace replay rejects incomplete mutation evidence.

### Layer 2: Local Capability Benchmark

Purpose: measure browser-agent behavior on deterministic hostile fixtures.

Task groups:

- Static read/extraction.
- Form input and submission.
- Repeated controls and ambiguous labels.
- Modal opening/closing.
- Overlay and blocked target.
- SPA route transition.
- Delayed content and layout shift.
- Virtualized or paginated list.
- Captcha-like block and honest escalation.
- No-action/dead-state page.

Primary metrics:

- `successRate`
- `traceCompleteRate`
- `replayValidRate`
- `avgPlannerCalls`
- `avgToolExecutions`
- `avgDurationMs`
- `failureTypes`
- `refSurvivalRate`
- `wrongRefRate`
- `deadStateEvidenceRate`

### Layer 3: Lightweight Real-Site Diagnostics

Purpose: discover real-world failure classes without using live sites as completion gates.

Rules:

- Small rotating set, not fixed forever.
- No runtime tuning to specific domains.
- Save trace, screenshot/recording when available, final result, and scorer output.
- If a failure matters, reproduce it in a local fixture before changing core runtime.

Starter categories:

- Search/read: docs, GitHub, Wikipedia, Hacker News.
- Navigation/extraction: product pages, listing pages, docs pages.
- Simple workflow: search box, filter, next page, modal.
- Dynamic page: SPA navigation, delayed content.

### Layer 4: Competitor Comparison

Purpose: understand market position honestly.

Adapters:

- `BrowseGentAdapter`
- `BrowserUseAdapter`
- `StagehandAdapter`
- `BrowserHarnessAdapter`
- Optional `BrowserbaseStagehandAdapter` for managed infra.

Tracks:

- Same-model local-browser track: fair architecture comparison where possible.
- Best-available product track: compare against cloud/hosted defaults, clearly labelled.
- Cost/latency track: compare tokens, duration, and successful runs per dollar.

Outputs:

- JSON report for machine analysis.
- Markdown summary for human review.
- Per-run trace paths and artifacts.
- Failure-class table, not just leaderboard score.

## Benchmark Sources

Use sources in this order:

1. Local deterministic fixture tasks for correctness and regression.
2. Custom neutral real-site tasks created by category, not by website tuning.
3. BU Bench subset for browser-use comparability.
4. Stagehand eval categories where adapter-compatible.
5. BrowseComp subset for research-style browsing, labelled separately because it measures hard information retrieval more than browser control.
6. Online-Mind2Web or WebVoyager only as external context; treat public leaderboard numbers cautiously because task drift and scoring differences can distort claims.

## Anti-Overfitting Protocol

Every benchmark failure enters this funnel:

```text
benchmark failure
  -> classify failure type
  -> inspect trace
  -> identify generic mechanism
  -> reproduce mechanism in local fixture
  -> write failing unit/integration test
  -> implement bounded runtime/planner-interface fix
  -> run local gate
  -> rerun held-out benchmark split
```

Forbidden fixes:

- Domain-specific text matching.
- Site-specific selectors.
- Benchmark task keywords in prompts.
- Hidden answer validation in runtime.
- Planner prompt changes aimed at one benchmark example.
- Increasing max steps or retries globally to hide a failure class.

Allowed fixes:

- Better ref lifecycle evidence.
- Better actionability detection.
- More precise operational projection.
- Improved trace artifact completeness.
- Bounded mechanical retries with trace.
- Planner input compression that preserves relevant operational evidence.
- Public API validation and clearer failure reporting.

## Release Stages

### Stage A: Evaluation Harness MVR

Build a neutral benchmark harness and first-party BrowseGent adapter.

Exit criteria:

- Can run local deterministic tasks through adapter contract.
- Produces stable JSON and Markdown reports.
- Stores trace path per task.
- Does not require competitor packages.
- Unit tests cover result scoring, failure classification, and report aggregation.

### Stage B: Public Agent API MVR

Expose task-first user input compatible with browser-agent expectations.

Exit criteria:

- `run(task, options)` maps to v2 agent mode.
- Existing `run(url, goal)` remains backward-compatible.
- Options support URL, model, max steps, browser settings, trace, and output mode.
- Result includes success, value/data, metrics, trace path, failure reason, and warnings.

### Stage C: Local Capability Benchmark

Create deterministic fixture suite for local benchmarking.

Exit criteria:

- Minimum 20 local tasks across hostile browser states.
- At least 3 repeats supported.
- Scorecard reports success, trace completeness, replay validity, latency, steps, and failure classes.
- Failing scenarios produce actionable trace evidence.

### Stage D: Competitor Adapter Bench

Add optional competitor adapters without making them required for normal tests.

Exit criteria:

- Competitor adapters are lazy/optional and skipped when dependency/config is missing.
- Same task schema runs BrowseGent and competitor adapters.
- Same-model and best-available modes are clearly separated.
- Reports disclose versions, model, browser mode, retry policy, and scorer.

### Stage E: Real-Site Diagnostics

Run rotating live-web diagnostics and convert failures into local fixtures.

Exit criteria:

- Real-site runs produce trace artifacts and failure classification.
- At least 10 live diagnostic tasks are run manually.
- No production claim relies only on real-site pass rate.
- At least three discovered failure classes are converted into local fixtures or explicitly rejected as out of scope.

### Stage F: Production-Grade Open-Source Readiness

Prepare the system for public use.

Exit criteria:

- Clean README/API docs.
- Installation and first-run instructions.
- Example scripts for task-first and primitive-style use.
- Release gate documented.
- Known limitations documented honestly.
- No secrets in traces.
- Public benchmark methodology documented.

## First Implementation Sequence

1. Create benchmark core types and report schema.
2. Add unit tests for report aggregation and anti-overfitting metadata.
3. Implement `BrowseGentAdapter` against current v2 public runtime.
4. Add first 8 deterministic local benchmark tasks.
5. Add runner CLI with `--adapter browsegent`, `--count`, `--repeat`, `--seed`, and `--report-dir`.
6. Add trace replay validation into benchmark scoring.
7. Add public task-first API wrapper.
8. Add docs for local MVR testing and benchmark methodology.
9. Add optional browser-use adapter.
10. Add optional Stagehand adapter.
11. Add optional Browser Harness adapter only after confirming its package/API shape.

## Decision Gates

Do not proceed to competitor adapters until Stage A and Stage B are stable.

Do not claim benchmark superiority until:

- BrowseGent and competitor versions are pinned.
- Same task set is run.
- Same scoring policy is used.
- Failed and skipped tasks are counted.
- Artifacts are retained.
- At least one held-out task split is used.

Do not treat BrowseComp as browser-control proof. Use it as a research-browsing diagnostic track.

## Immediate Next Step

Create a detailed implementation plan for Stage A and Stage B only. These are the foundation for all later evaluation and production work.

Stage A proves we can measure honestly.

Stage B proves users can operate BrowseGent like other browser agents.

Everything after that depends on those two stages being stable.
