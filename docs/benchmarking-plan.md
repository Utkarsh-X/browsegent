Yes, `MinorJerry/WebVoyager` should become our **Track B public-benchmark track**. It should not replace our local 24-task MVR benchmark.

Source facts from the official repo:
- Dataset: [`data/WebVoyager_data.jsonl`](https://github.com/MinorJerry/WebVoyager/blob/main/data/WebVoyager_data.jsonl)
- Reference answers: [`data/reference_answer.json`](https://github.com/MinorJerry/WebVoyager/blob/main/data/reference_answer.json)
- Official runner uses Selenium, `max_iter`, screenshots, accessibility-tree option, and GPT-4V evaluator.
- Official README says there are `643` tasks across `15` websites and warns that Booking/Google Flights tasks are time-sensitive.

**Benchmark Structure**
We should now build two tracks:

```text
Track A: Local MVR competitor benchmark
Purpose: controlled product-quality comparison.
Tasks: our 24 deterministic local tasks.
Competitors: BrowseGent, Browser Use local agent, Browser Use Cloud SDK, Browserbase Browse CLI.

Track B: WebVoyager-lite / WebVoyager replication
Purpose: public benchmark credibility.
Tasks: selected WebVoyager tasks from MinorJerry/WebVoyager.
Competitors: BrowseGent, Browser Use local agent first, then others.
```

**Initial WebVoyager Task List**
Start with a balanced `30-task WebVoyager-lite` set: 2 tasks from each of the 15 websites.

```text
Allrecipes--3
Allrecipes--10
Amazon--0
Amazon--10
Apple--0
Apple--10
ArXiv--0
ArXiv--10
BBC News--0
BBC News--10
Booking--0
Booking--10
Cambridge Dictionary--0
Cambridge Dictionary--10
Coursera--0
Coursera--10
ESPN--0
ESPN--10
GitHub--0
GitHub--10
Google Flights--0
Google Flights--10
Google Map--0
Google Map--10
Google Search--0
Google Search--10
Huggingface--0
Huggingface--10
Wolfram Alpha--0
Wolfram Alpha--10
```

Booking and Google Flights contain old dates like `2024`. For a fair 2026 run, we need a documented date-normalization rule, not silent edits. Example: replace past travel dates with future dates relative to run date and store both original and normalized task text.

**Implementation Plan**
Add shared adapter support first:

```text
tests/benchmark/v2/adapter_factory.ts
tests/benchmark/v2/adapters/BrowserUseLocalAdapter.ts
tests/benchmark/v2/adapters/BrowserUseCloudAdapter.ts
tests/benchmark/v2/adapters/BrowserbaseBrowseAdapter.ts
```

Then add WebVoyager-specific files:

```text
tests/benchmark/webvoyager/types.ts
tests/benchmark/webvoyager/source_loader.ts
tests/benchmark/webvoyager/task_selection.ts
tests/benchmark/webvoyager/date_normalizer.ts
tests/benchmark/webvoyager/run_webvoyager_lite.ts
tests/benchmark/webvoyager/evaluator.ts
docs/evaluation/webvoyager-benchmarking.md
```

Do not vendor the WebVoyager repo inside BrowseGent. If we need a local clone, put it outside:

```text
D:\agent-tools\WebVoyager
```

**Adapter Plan**
Browser Use local comes first. It is the most relevant competitor because their public WebVoyager claim is about the main agent, not just Cloud SDK.

Browserbase Browse CLI comes second. It needs a wrapper because raw `browse` is not exactly task-in/result-out like BrowseGent.

Browser Use Cloud SDK comes third. Useful for commercial/API comparison, but separate from Browser Use local.

**Metrics**
For both tracks, collect:

```text
pass/fail
final answer
duration
model
planner/tool/action steps where available
cost estimate where available
screenshots/artifacts
failure type
manual-review flag
evaluator result
raw logs
```

For WebVoyager specifically, also collect:

```text
original task text
normalized task text
website
reference answer if available
judge verdict
human override if used
reason for exclusion if skipped
```

**Scoring Rules**
We need three scores:

```text
raw_auto_score
manual_reviewed_score
strict_score
```

`strict_score` should count ambiguous/impossible/outdated/environment-blocked tasks as failures unless they are explicitly excluded before the run. This prevents leaderboard-style score inflation.

**Execution Order**
1. Build `--adapter` support into the existing local runner.
2. Add `BrowserUseLocalAdapter`.
3. Run Browser Use on our 24 local tasks.
4. Add WebVoyager task loader and 30-task WebVoyager-lite selection.
5. Run BrowseGent on WebVoyager-lite.
6. Run Browser Use local on WebVoyager-lite.
7. Compare failure classes.
8. Only then decide whether to add self-healing, visual reasoning, iframe/shadow-DOM support, or stronger orchestration.

This gives us honest evidence in two directions: controlled product quality and public benchmark credibility.