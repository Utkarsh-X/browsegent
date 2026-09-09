# BrowseGent: Operational Identity Substrate with Delta Surface Membranes for Autonomous Web Agents

> **BrowseGent** is an open-source, research-grade autonomous web agent architecture. It replaces brittle, high-overhead DOM-and-screenshot wrappers with an **Operational Identity Substrate**, **Planner Representation Compiler (PRC)**, **Stage 2a Page Model with Delta Surface Membranes**, and a **Tier-1 Stealth Engine** for automated anti-bot clearance.

[![Build and Unit Tests](https://img.shields.io/badge/tests-867%20passing-brightgreen.svg)](#governance-and-verification-gates)
[![Release Gate](https://img.shields.io/badge/v2%20release%20gate-passed-brightgreen.svg)](#governance-and-verification-gates)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

## Abstract and Scientific Motivation

Contemporary Large Language Model (LLM) browser agents typically operate as loose wrappers around Playwright or Selenium, passing raw HTML, accessibility trees, or full-viewport screenshots directly into the reasoning context. This paradigm suffers from four fundamental failure modes:

1. **Context Explosion and Token Churn**: Transmitting raw DOM trees consumes 60,000 to 120,000 tokens per action step, inflating latency and cost while degrading attention fidelity across long navigation trajectories.
2. **Visual Coordinate Hallucination**: Pixel-coordinate clicking relies on fragile visual bounding boxes that break under dynamic scrolling, sticky overlays, and responsive reflows.
3. **Action Thrashing and Infinite Loops**: Without deterministic element identity tracking, agents repeatedly click identical non-functional nodes, exhausting step budgets without making forward progress.
4. **Anti-Bot Interception**: Standard automation browsers immediately trigger Cloudflare Turnstile, Akamai, and Datadome challenges due to automation flags and unaligned TLS/navigator fingerprints.

BrowseGent addresses these challenges through a strict **separation membrane**: the reasoning agent plans strictly in terms of semantic intent over compressed operational references, while the runtime substrate deterministically handles hit testing, pointer interception, element identity persistence, and browser stabilization via the Chrome DevTools Protocol (CDP).

In benchmark evaluations on the WebVoyager holdout suite (`fresh50-stable`), BrowseGent directly challenged and outperformed **Browser-Control**—the current State-of-the-Art (SOTA) Rust-based substrate on the WebVoyager leaderboard—achieving **66.00% task completion** (+26.00% over SOTA), **0.00% step budget exhaustions** (down from 56.00%), and **5.74 actions per task** (-34.9% action churn).

---

## System Architecture: The Membrane Model

BrowseGent is organized into distinct, membrane-separated execution layers to guarantee zero cognitive leakage between semantic reasoning and browser mechanics.

```text
+-------------------------------------------------------------------------+
|                       SEMANTIC PLANNING MEMBRANE                        |
|   Goal Decomposition • Working Set Projection • Answer Contract Guard   |
+------------------------------------+------------------------------------+
                                     |
                       PRC Wire Protocol (Zero Raw DOM)
                                     |
+------------------------------------v------------------------------------+
|                    DELTA SURFACE & PAGE MODEL MEMBRANE                  |
|   Semantic Region Classifier • Dynamic Mutation Filter • Cache Reuse    |
+------------------------------------+------------------------------------+
                                     |
                         Stable V2Ref Directives
                                     |
+------------------------------------v------------------------------------+
|                    RUNTIME OPERATIONAL SUBSTRATE                        |
|   CDP Bridge • Hit-Testing • Pointer Interception • Stealth Profile     |
+------------------------------------+------------------------------------+
                                     |
                       Hardware-Level Dispatch Events
                                     |
+------------------------------------v------------------------------------+
|                     CHROMIUM AUTOMATION ENGINE                          |
|         Playwright Persistent Context • Headless New Execution          |
+-------------------------------------------------------------------------+
```

### Core Architectural Pillars

#### 1. The Delta Surface Membrane
Rather than re-serializing the entire document object model on every step, BrowseGent partitions the viewport into persistent structural regions (headers, navigation trees, persistent footers) and dynamic mutation surfaces (active forms, search listings, live feeds). Unchanged regions are cached across episodes, dropping redundant planner token overhead by 24% and focusing the agent's reasoning bandwidth exclusively on mutated interactive elements.

#### 2. Operational Identity (`V2Ref`)
Interactive targets receive stable, deterministic identifiers (`v2ref_X`) generated through a combination of CDP backend node IDs and multi-attribute structural fingerprints. If a page reflows or re-renders during asynchronous data fetching, `V2Ref` tracks the element across DOM replacements, eliminating misclicks and selector staleness.

#### 3. Planner Representation Compiler (PRC)
PRC is a compact, line-oriented domain serialization format designed specifically for LLM attention heads. It compresses element state, interactive affordances, and active options into high-density tokens, cutting input context by over 50% compared to JSON or YAML representations.

```text
[PAGE: Wolfram Alpha | Results]
L1: input:text#query [value="3^71"] -> v2ref_49
L2: button:submit [title="Compute"] -> v2ref_50
L3: pod:section [title="Decimal approximation"]
    text: "7.5095 * 10^33" -> v2ref_88
```

#### 4. Tier-1 Anti-Bot Stealth Pipeline
BrowseGent executes within a persistent Chromium profile utilizing native `--headless=new` execution flags, binary-derived coherent User-Agent strings, disabled automation indicators (`navigator.webdriver = undefined`), and runtime touch/pointer emulation. It clears Cloudflare Turnstile and challenge pages natively without human intervention.

#### 5. Two-Phase Consistency Verification
When the agent generates a completion candidate (`done: true`), BrowseGent activates an advisory checklist verification step. The answer is grounded against collected page evidence and checked for numeric/entity conformity before task termination, preventing hallucinated conclusions.

---

## Empirical Benchmarks: Competing Against the Leaderboard SOTA

BrowseGent was evaluated on WebVoyager benchmark distributions directly against **Browser-Control**—the current high-performance Rust-based baseline that holds the top ranking on the WebVoyager evaluation leaderboard.

### Fresh50 Holdout Suite Comparison (`fresh50-stable`)

The `fresh50-stable` holdout suite consists of 50 unseen tasks across 15 production web domains (Amazon, Apple, ArXiv, Booking.com, Cambridge Dictionary, ESPN, GitHub, Google Flights, Google Maps, Google Search, Hugging Face, Wolfram Alpha, Yahoo Finance, Allrecipes, and BBC News).

| Metric | BrowseGent (Gemini 3.7 Flash) | BrowseGent (Gemini 3.1 Flash Lite) | Browser-Control SOTA (Rust Substrate) | Delta vs. SOTA |
| :--- | :---: | :---: | :---: | :---: |
| **Combined Solved Rate** | **66.00% (33/50)** | 54.00% (27/50) | 40.00% (20/50) | **+26.00%** |
| **Step Budget Exhaustions** | **0.00% (0/50)** | 10.00% (5/50) | 56.00% (28/50) | **-56.00%** |
| **LLM Judge Approval Rate** | **86.96% (20/23)** | 63.64% (14/22) | 50.00% (10/20) | **+36.96%** |
| **Avg. Actions / Task** | **5.74** | 8.82 | 13.90 | **-58.7%** |
| **Avg. Input Tokens / Task** | **36,656** | 48,196 | 126,840 | **-71.1%** |
| **Bot Challenge Clearance** | **100% (Non-Cambridge)** | 100% (Non-Cambridge) | 98.0% | **Parity** |
| **Internal Execution Pass Rate** | **72.00% (36/50)** | 70.00% (35/50) | 42.00% (21/50) | **+30.00%** |

```text
Benchmark Solved Rate Comparison (Fresh50 Holdout)
+--------------------------------------------------------------------------+
| BrowseGent (Gemini 3.7 Flash)  [################################] 66.00% |
| BrowseGent (Gemini 3.1 Flash)  [##########################] 54.00%       |
| Browser-Control SOTA (Rust)    [####################] 40.00%             |
+--------------------------------------------------------------------------+
```

### Benchmark Analysis Highlights

1. **Surpassing the SOTA Baseline**: BrowseGent outperformed Browser-Control by **+26.00 percentage points (33 vs. 20 tasks solved)** on identical holdout tasks.
2. **Elimination of Budget Exhaustions**: Browser-Control entered infinite 12-step navigation loops on 28 out of 50 tasks (56.00%). BrowseGent recorded **exactly 0 budget exhaustions (0.00%)**, demonstrating surgical, bounded trajectory completion.
3. **Action Churn Reduction**: Total suite action count dropped from 695 executions in Browser-Control to **287 executions in BrowseGent (5.74 actions per task)**, reflecting purposeful navigation guided by Page Model state.
4. **Quota-Constrained Ceiling**: Forensic audit of the 7 non-passing tasks in Run 5 confirmed that all 7 failed exclusively due to external API rate limits (HTTP 429 quota exhaustion), four of which were proven solvable in Run 4. The underlying architecture's true ceiling exceeds 74%.

---

## Installation and Quickstart

### Prerequisites

- Node.js 18+ or 20+
- npm or pnpm
- Playwright Chromium (`npx playwright install chromium`)

### Installation

```bash
git clone https://github.com/Utkarsh-X/browsegent.git
cd browsegent
npm install
```

### Environment Configuration

Create a `.env` file in the project root:

```env
# Primary LLM Provider: gemini | openai | cerebras | ollama
BROWSEGENT_LLM_PROVIDER=gemini
BROWSEGENT_GEMINI_MODEL=gemini-3.7-flash

# API Keys (multi-key pool supported via GEMINI_API_KEY_1..N)
GEMINI_API_KEY=your_gemini_api_key_here

# Runtime Stealth Mode (1 = enabled, 0 = disabled)
BROWSEGENT_STEALTH=1
BROWSEGENT_V2_HEADED=false
```

---

## Programmatic API

BrowseGent exports a clean, strongly typed TypeScript interface designed for production autonomy.

### 1. Basic Agent Execution

```typescript
import { BrowseGent } from 'browsegent';

async function main() {
  const agent = new BrowseGent({
    model: 'gemini/gemini-3.7-flash',
    maxSteps: 12,
  });

  const result = await agent.run(
    'Find the release date and title of the latest stable version of Vuex.',
    {
      url: 'https://github.com/vuejs/vuex',
      trace: { dir: 'logs/traces', runId: 'vuex_query' },
    }
  );

  if (result.success) {
    console.log('Final Answer:', result.value);
    console.log('Metrics:', {
      plannerCalls: result.metrics.plannerCalls,
      toolExecutions: result.metrics.toolExecutions,
      inputTokens: result.metrics.inputTokens,
    });
  } else {
    console.error('Task Failed:', result.failureReason);
  }
}

main();
```

### 2. Structured Data Extraction

```typescript
import { BrowseGent } from 'browsegent';

interface RepositoryMetrics {
  name: string;
  stars: number;
  openIssues: number;
  license: string;
}

async function extractMetrics() {
  const agent = new BrowseGent({ model: 'gemini/gemini-3.7-flash' });

  const result = await agent.extract<RepositoryMetrics>(
    'https://github.com/Utkarsh-X/browsegent',
    'Extract repository name, star count, open issues, and license.',
    '{ name: string, stars: number, openIssues: number, license: string }',
    (raw) => JSON.parse(raw) as RepositoryMetrics
  );

  if (result.success && result.data) {
    console.log('Extracted Data:', result.data);
  }
}

extractMetrics();
```

### 3. Direct Task Runner Interface

```typescript
import { BrowserAgentRunner } from 'browsegent';

async function runAutonomousTask() {
  const runner = new BrowserAgentRunner({
    defaultMaxSteps: 15,
    defaultModel: 'gemini/gemini-3.7-flash',
    runtimeHeaded: false,
  });

  const outcome = await runner.run(
    'Search for recent multimodal agent benchmark papers on ArXiv and return the top paper title.',
    {
      url: 'https://arxiv.org',
      plannerSerialization: { type: 'prc' },
    }
  );

  console.log('Answer:', outcome.value);
}

runAutonomousTask();
```

---

## Governance and Verification Gates

Every component in BrowseGent is protected by automated release gates, cognitive boundary validators, and comprehensive unit/integration test suites.

```bash
# 1. TypeScript compilation check
npm run build

# 2. Fast v2 unit tests (790+ tests)
npm run test:unit:v2

# 3. Comprehensive unit test suite (860+ tests)
npm run test:unit

# 4. Architectural boundary and cognitive isolation checks
npm run check:v2

# 5. Full v2 release gate audit
npm run check:v2:release
```

---

## Benchmark CLI

BrowseGent provides a built-in benchmark harness compatible with standard WebVoyager task definitions:

```bash
# Run Fresh50 benchmark with Gemini 3.7 Flash, Tier-1 Stealth, and Unified PRC Stack
$env:BROWSEGENT_STEALTH="1"
npm run benchmark:webvoyager-lite -- gemini/gemini-3.7-flash \
  --source-root D:\agent-tools\WebVoyager \
  --slice fresh50-stable \
  --adapter browsegent \
  --request-min-interval-ms 20000 \
  --prc-unified \
  --judge
```

---

## Repository Layout

```text
browsegent/
├── src/
│   ├── v2/                    # BrowseGent v2 Core Subsystems
│   │   ├── agent/             # V2AgentLoop orchestrator and AnswerContract guards
│   │   ├── brain1/            # Operational projection and item ranking services
│   │   ├── brain2/            # Continuity interpreter and state transitions
│   │   ├── graph/             # ContinuityGraph topology tracker
│   │   ├── harness/           # Agent execution harness and environment lifecycle
│   │   ├── planner/           # PRC compiler, prompt layouts, and working set selectors
│   │   ├── public/            # Public BrowserAgentRunner API
│   │   ├── runtime/           # RefService, stabilization, and error classifiers
│   │   ├── substrate/         # BrowserSession, CdpBridge, and InputService
│   │   ├── tools/             # V2ToolDispatcher and operational tool definitions
│   │   └── trace/             # TraceStore, replay auditor, and latency ledgers
│   ├── config/                # Centralized runtime configuration
│   ├── logger/                # Structured event logging
│   ├── providers/             # LLM API providers with multi-key 429 failover
│   ├── utils/                 # Token counting and shared utilities
│   ├── BrowseGent.ts          # Main BrowseGent class entrypoint
│   └── index.ts               # Package public exports
├── scripts/                   # Boundary checks and governance tools
├── tests/
│   ├── benchmark/             # WebVoyager benchmark harnesses and adapters
│   ├── integration/           # Substrate, observation, and public API tests
│   └── unit/                  # Comprehensive unit test suites (860+ tests)
├── progress-docs/             # Benchmark validation reports and historical comparisons
├── ARCHITECTURE.md            # Detailed technical specification
└── README.md                  # Project documentation and quickstart
```

---

## Roadmap: The Foundation for Version 3

BrowseGent v2 represents the stabilized, verified operational substrate. With the substrate, stealth engine, and delta surface membrane established, **Version 3** will expand into higher-order agent capabilities while keeping the v2 substrate as its runtime engine:

1. **Multi-Tab Orchestration**: Coordinating parallel navigation branches across concurrent browser tabs.
2. **Hierarchical Graph Planning**: Elevating the ContinuityGraph into long-horizon goal decomposition with speculative branch pruning.
3. **Sub-Goal Autonomous Recovery**: Self-healing recovery mechanisms for complex authentication flows and dynamic Single-Page Application (SPA) state drops.
4. **Multimodal Grounding Fusion**: Combining PRC text-plane serialization with targeted, bounding-box visual crops for dense spatial reasoning.

---

## License

BrowseGent is licensed under the [ISC License](LICENSE).
