# BrowseGent

> A research-grade browser automation agent with dual-brain DOM perception, CDP identity-backed targeting, and a fully instrumented evaluation harness.

![Eval Suite](https://github.com/Utkarsh-X/browsegent/actions/workflows/eval.yml/badge.svg)

---

## Overview

BrowseGent is a TypeScript browser automation agent that observes a page, asks an LLM for a bounded action plan, executes through deterministic browser adapters, and re-observes until it can answer the task. Its main difference from a plain Playwright AI wrapper is the dual-brain perception layer: Brain1 builds a typed, scored DOM graph with stable hashes and CDP `backendNodeId` identities, while Brain2 attributes DOM mutations to clicks, fetches, and XHRs. The agent uses CDP identity-backed clicks with stable-hash recovery before falling back to DOM clicks, and its behavior is measured by a 30-task eval harness with persisted reports.

## Demo

No demo GIF is committed yet. To record one:

```bash
npm run demo
```

The demo script runs `flipkart_pagination` in headful mode so a screen recorder can capture multi-step pagination and price extraction. To convert a recording to GIF:

```bash
ffmpeg -i demo.mp4 -vf "fps=10,scale=1280:-1" demo.gif
```

---

## Architecture

### Brain1 - DOM Perception Layer

Brain1 is implemented by the Chrome extension content script in `extension/content.ts` and coordinated by `src/brain1/service.ts`. The content script runs in the page world, walks the DOM including open shadow roots, and classifies output nodes as `trigger`, `input`, `data`, or `table_cell`.

Each node carries three scores: `selectorScore`, `interactionScore`, and `actionabilityScore`. Confidence is derived as `high`, `medium`, or `low`. Stable hashes use FNV-1a over a signature shaped like `tag|role|nameLike|attrSignature|classSignature|ancestorPath|ordinal`, making recovery less dependent on brittle CSS selectors.

The output is capped at 240 nodes with per-type caps of 40 inputs, 60 triggers, 110 data nodes, and 30 table cells. Brain1 then enriches up to 8 medium/low confidence candidates through page inspection, performs up to 2 targeted region rescans, and resolves CDP `backendNodeId` values for up to 12 top-priority nodes via `DOM.describeNode`.

### Brain2 - Mutation Attribution Layer

Brain2 is also injected from `extension/content.ts`. It installs a `MutationObserver` for `childList`, `subtree`, `attributes`, and `characterData`, and wraps `fetch` plus `XMLHttpRequest` before requests fire. Pending click, scroll, timer, fetch, and XHR causes are matched to later mutations inside a calibrated RTT window.

Noise filters suppress analytics, ad, tracking, menu, nav, header, footer, page-init, and small-text churn. Deltas expose causal chains shaped as `initiator -> transport -> url/confidence`, and the extension exposes `window.__browsegent_brain2.getDeltas()` and `clearDeltas()` for the agent loop.

### Agent Loop

| Phase | What Happens | Deterministic vs LLM |
|-------|--------------|----------------------|
| beforeStep | Sync Brain2 deltas into graph | Deterministic |
| Loop guards | Utility checks, stagnation detection, fingerprint comparison | Deterministic |
| Serialize | Graph -> compact JSON context | Deterministic |
| LLM call | Plan generation, up to 5 actions | LLM |
| Parse + validate | `robustJsonParse` -> `validatePlan` -> retry | Deterministic |
| Execute | Per-action execution with progress assessment | Deterministic |
| afterAct | Brain1 rescan, clear Brain2 deltas | Deterministic |

### CDP Click Path

Path A, identity-backed: `backendNodeId` -> `DOM.scrollIntoViewIfNeeded` -> `DOM.getBoxModel` plus `DOM.getContentQuads` -> centroid computation -> occlusion check with `elementFromPoint` -> `Input.dispatchMouseEvent` for move, press, and release. If the target is stale, BrowseGent re-resolves by selector and stable hash before retrying.

Path B, DOM fallback: `querySelector` -> `scrollIntoView` -> `el.click()`.

### Loop Detection and Safety

The target utility guard currently exposes 11 block reasons:

| Reason | Purpose |
|--------|---------|
| `low_confidence_target` | Blocks weak targets with no strong candidate evidence. |
| `read_before_click` | Forces read-only discovery before ambiguous extraction clicks. |
| `same_page_anchor` | Avoids low-value anchor jumps on extraction tasks. |
| `outbound_with_answer_available` | Prevents leaving a page that already has strong goal data. |
| `pagination_churn` | Requires answer-evidence reads after pagination. |
| `pagination_answer_observed` | Stops extra pagination once answer evidence exists. |
| `read_after_interaction_churn` | Stops repeated interactions with no reads. |
| `read_after_submit_transition` | Forces reads after submit-like transitions. |
| `submit_control_recovery` | Stops retyping after a failed submit-like control. |
| `weak_interaction_repeat` | Stops repeated weak clicks after form entry. |
| `stale_read_selector` | Blocks stale or brittle read selectors. |

The agent also tracks action and graph fingerprints to detect repetition and stagnation. If Brain2 reports 3 or more new deltas during an active plan, the loop aborts the stale plan and asks the LLM to replan from the updated graph.

---

## Evaluation

### Results

Latest core report: `logs/eval_runs/1776832390956_core_r1_gemini_gemini_3_1_flash_lite_preview/report.json`, timestamp `2026-04-22T04:45:56.848Z`.

| Metric | Value |
|--------|-------|
| Core suite pass rate | 9/10 (90%) |
| Total eval runs logged | 60 |
| Avg LLM calls per task | 2.1 |
| Avg cost per 10-task run | $0.00789375 on Gemini Flash Lite |
| Eval suite size | 30 tasks (10 core + 20 extended) |

### Task Breakdown, Latest Core Run

| Task | Result | LLM Calls | Notes |
|------|--------|-----------|-------|
| wikipedia_featured | FAIL | 1 | Perception error; returned `Nihilism`, too short for the featured-article validation. |
| hacker_news_top | PASS | 1 | Static DOM. |
| bbc_headline | PASS | 1 | News homepage heading extraction. |
| flipkart_pagination | PASS | 3 | Multi-page navigation and price extraction. |
| amazon_global | PASS | 10 | Dense product grid. |
| github_repo_stars | PASS | 1 | Repository metadata extraction. |
| reddit_technology | PASS | 1 | Anti-bot social page. |
| theverge_cloudflare | PASS | 1 | Cloudflare-protected homepage. |
| vercel_docs | PASS | 1 | SPA documentation page. |
| producthunt_today | PASS | 1 | Dynamic content extraction. |

### Known Limitations

- Wikipedia failure: Brain1 can snapshot sidebar or adjacent content over the intended featured-article region.
- `getEventListeners` can return `null` under `--headless=new`, so listener enrichment is opportunistic.
- Cross-origin iframes are not supported by the CDP identity click path; `unsupported_frame` blocks or falls back depending on context.
- Shadow DOM selectors fall back to the host selector, with a lower selector score.
- Extended adversarial tasks such as Indeed, NYT, and Reuters have historically failed because of CAPTCHAs, paywalls, consent walls, or bot controls.

---

## Supported LLM Providers

| Provider | Mode | Notes |
|----------|------|-------|
| Gemini | Cloud REST | JSON schema mode, retry/backoff, default provider. |
| OpenAI | Cloud REST | Chat completions with `json_object` response format. |
| Cerebras | OpenAI-compatible SDK | 3 retries. |
| Ollama | Local REST | Uses `/v1/chat/completions` on the configured Ollama base URL. |

---

## Installation

Prerequisites: Node.js 20 or newer and a Chromium-compatible browser. Playwright installs Chromium for eval runs.

```bash
npm install
cp .env.example .env
npm run extension:build
npm run eval -- --task hacker_news_top
```

Fill at least one cloud provider API key in `.env`, or configure Ollama with a local model and set `BROWSEGENT_LLM_PROVIDER=ollama`.

---

## Running Evaluations

```bash
# Core suite, 10 tasks
npm run eval

# Extended suite, 20 tasks
npm run eval -- --suite extended

# All 30 tasks
npm run eval -- --suite all

# Specific task
npm run eval -- --task wikipedia_featured

# Custom model
npm run eval -- gemini/gemini-3.1-flash-lite-preview

# With repeats
npm run eval -- --suite core --repeat 3
```

Reports are saved under `logs/eval_runs/` as `report.json` and `debug.jsonl`.

---

## Project Structure

```text
browsegent/
|-- src/
|   |-- brain1/
|   |-- brain2/
|   |-- agent/
|   |-- adapters/
|   |-- executor/
|   |-- graph/
|   |-- config/
|   |-- logger/
|   |-- providers/
|   `-- stealth/
|-- extension/
|-- tests/
|   |-- eval/
|   `-- unit/
|-- scripts/
|-- logs/              # gitignored eval outputs
|-- _archive/          # moved legacy code
|-- .env.example
|-- .gitignore
|-- package.json
|-- tsconfig.json
`-- README.md
```

---

## Roadmap

- Improve extended adversarial suite reliability.
- Add cross-origin iframe support for identity-backed targeting.
- Improve direct Shadow DOM targeting beyond host-selector fallback.
- Add structured benchmarking against browser-use and Stagehand baselines.
- Add a Web UI or API server.
- Add a Docker container for reproducible eval runs.

---

## Research Context

BrowseGent is a research project rather than a production automation product. The architecture deliberately keeps the LLM responsible for high-level plan generation while deterministic code handles perception, validation, execution, identity recovery, and loop safety. The implementation favors CDP identities over pure Playwright locators and stable hashes over fragile CSS selectors because the main research question is whether browser agents become more reliable when perception and action identity are explicitly modeled.

---

## Running CI

The eval workflow runs on pushes and pull requests to `main` or `master`, and can also be launched manually with `workflow_dispatch`. To enable cloud evals on a fork:

1. Go to repository Settings -> Secrets and variables -> Actions.
2. Add `GEMINI_API_KEY` as a repository secret.
3. Run the workflow or push to the default branch.

The README badge points to `Utkarsh-X/browsegent` and will become live after the first workflow run.

---

## License

ISC, matching `package.json`.
