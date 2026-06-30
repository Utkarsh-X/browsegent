# BrowseGent

> **BrowseGent** is a research-grade browser automation agent featuring dual-perception DOM engines, CDP identity-backed targeting, and a fully instrumented evaluation harness. 

[![Build and Eval Suite](https://github.com/Utkarsh-X/browsegent/actions/workflows/eval.yml/badge.svg)](https://github.com/Utkarsh-X/browsegent/actions/workflows/eval.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

---

## 🌟 Overview

BrowseGent represents a major departure from brittle "wrapper agents" that rely on the LLM to write CSS/XPath selectors or recover from rendering loops. 

Instead, BrowseGent separates **semantic planning** (what to do next) from **runtime execution stability** (resolving elements, verifying visibility, and managing DOM settlement). 

It features two architectural variants within the same repository:
1. **BrowseGent v1 (Dual-Brain Perception)**: Utilizes a custom Chrome extension perception layer. `Brain1` builds a typed, FNV-1a hashed DOM graph, and `Brain2` intercepts and attributes DOM mutations to clicks, fetches, and XHRs.
2. **BrowseGent v2 (Operational Identity Substrate)**: A headless/headed runtime utilizing the Chrome DevTools Protocol (CDP) to track stable reference IDs (`V2Ref`) across transitions, score multiple selector candidates semantically, and automatically quarantine broken targets without planner intervention.

> [!IMPORTANT]
> For a deep dive into the BrowseGent v2 runtime substrate, fingerprints, and stabilization layers, please read the **[ARCHITECTURE.md](file:///d:/BrowseGent/ARCHITECTURE.md)**.

---

## 🚀 Key Features

- **Operational Identity (`V2Ref`)**: Target references survive React rerenders, dynamic ClassName obfuscation, and page updates by utilizing a combination of hard/soft fingerprints and multi-candidate scoring.
- **Strict Boundary Separation**: Code check guards enforce that the runtime substrate has no semantic or cognitive leakage from the planner layer.
- **Deterministic Action Executions**: Center-point collision checks and pointer-intercept checking run before clicking, preventing click failures.
- **Trace Replay & Auditing**: Every run records observations, planner requests, transitions, and failures. The replay auditor verifies runs deterministically.
- **Rich LLM Provider Support**: Native integrations with Google Gemini, OpenAI, Cerebras, and local Ollama endpoints.

---

## 📊 Benchmark & Optimization Performance

BrowseGent v2 has been thoroughly benchmarked on the `mvr5-stable` 5-task validation slice. The benchmark validates both the operational pass rate and the token/payload efficiency of the **Planner Representation Compiler (PRC)**.

### 1. Performance Evolution & Scorecard

Below is the strict verification pass rate and token consumption trend comparing different development milestones of BrowseGent and other baseline approaches:

| Benchmark Milestone | Planner Serializer | Strict Pass Rate | Total Input Tokens | Total User Message Bytes | Avg. Planner Calls |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **BrowseGent v2 (June 7)** | `json` | 40% (2/5) | 612,683 | - | 8.2 |
| **BrowseGent v2 (Pre-PRC - June 23)** | `json` | 80% (4/5) | 559,099 | - | 7.4 |
| **BrowseGent v2 (PRC v1.0 - June 28)** | `prc` | 100% (5/5) | 344,538 | 1,111,905 B | 10.0 |
| **BrowseGent v2 (PRC v1.1 - June 30)** | `prc` | 80% (4/5)* | 217,560 | 681,293 B | 8.0 |
| **BrowseGent v2 (PRC v1.1.2 - June 30)** | `prc` | **80% (4/5)** | **276,227** | **499,475 B** | **7.0** |
| **Browser-Use Baseline (June 23)** | DOM Tree | 80% (4/5) | 152,853** | - | 3.6 |

> [!NOTE]
> \* The single failing task in the `PRC v1.1` and `PRC v1.1.2` runs was due to external Cloudflare CAPTCHA environment blocking (`environment_block`).
> \*\* Browser Use input tokens exclude the GitHub task which timed out and failed.

### 2. Optimization Impact & Efficiency Gains

Direct head-to-head comparison from JSON Pre-PRC to the hardened PRC v1.1.2:

*   **Input Token Reduction:** PRC v1.1.2 consumes **50.6% fewer input tokens** compared to the JSON baseline (**276,227** vs. **559,099** tokens).
*   **User Message Payload Compression:** Ref-first elements encoding and overlay dropdown whitelisting achieved **26.7% user message bytes savings** over PRC v1.1 (**499,475** vs. **681,293** bytes).
*   **Format Stability:** Reduced formatting validation retries to only **1** across all 5 benchmark runs combined (97.2% first-call success).

### 3. Stable Task Status Details

| Stable Task | Pre-PRC (June 23) | PRC v1.1.1 (June 30) | PRC v1.1.2 (June 30) | Notes |
| :--- | :---: | :---: | :---: | :--- |
| **ArXiv Search** | ✅ Pass | ✅ Pass | **✅ Pass** | Search for latest preprints. |
| **Google Maps Info** | ❌ Fail | ✅ Pass | **✅ Pass** | Successfully extracts location contact and hours. |
| **Wolfram Alpha Math** | ✅ Pass | ✅ Pass | **✅ Pass** | Empty read loop quarantined; loop recovery active. |
| **GitHub Sort Dropdown** | ✅ Pass | ❌ Fail*** | **✅ Pass** | **Fixed**: Overlay dropdown options whitelisted and selected. |
| **Cambridge Dictionary** | ✅ Pass | ❌ Fail* | **❌ Fail**\* | Cloudflare CAPTCHA blocked; verified normal runtime logic. |

> [!NOTE]
> \*\*\* GitHub sort dropdown options were previously hidden from the projection overlay, causing a failure. Hardening overlay projection resolved this completely.

---

## 📂 Project Structure

```text
browsegent/
├── src/
│   ├── v2/                  # BrowseGent v2 Runtime, Substrate, Planner, and Trace Store
│   │   ├── agent/           # V2AgentLoop orchestrator & AnswerContract validation
│   │   ├── substrate/       # BrowserSession, CDPBridge, InputService, and ObservationService
│   │   ├── runtime/         # RefService, Stabilization, and Transition classification
│   │   ├── planner/         # PlannerWorkingSetSelector, InputComposer, and validation schemas
│   │   ├── graph/           # ContinuityGraph topology tracker
│   │   └── trace/           # TraceStore logging and TraceReplayAuditor
│   ├── brain1/              # Legacy Perception Layer Service (v1)
│   ├── brain2/              # Legacy Mutation Attribution Service (v1)
│   ├── agent/               # Legacy Agent Loop & Guards (v1)
│   ├── adapters/            # Legacy Browser page adapters (v1)
│   ├── config/              # Shared configuration schemas
│   ├── providers/           # LLM API callers
│   └── stealth/             # Anti-fingerprinting stealth configurations
├── extension/               # Chrome Content Script and build scripts for Brain1/Brain2 (v1)
├── scripts/                 # Boundary checking and project validation utilities
├── tests/
│   ├── unit/                # TS Unit tests (tested via node runtime)
│   ├── eval/                # Legacy 30-task evaluation benchmark
│   └── benchmark/v2/        # New v2 benchmark and report comparison tools
├── package.json             # Commands, scripts, and dependencies
└── ARCHITECTURE.md          # BrowseGent v2 technical specification
```

---

## 🛠️ Installation & Setup

### Prerequisites
- **Node.js**: Version 20 or newer.
- **Chromium Browser**: Playwright will download Chromium automatically during configuration.

### Setup Steps
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment template file:
   ```bash
   cp .env.example .env
   ```

3. Configure your API keys in the `.env` file:
   ```env
   # Set your preferred provider (gemini, openai, cerebras, or ollama)
   BROWSEGENT_LLM_PROVIDER=gemini
   GEMINI_API_KEY=your_gemini_key_here
   OPENAI_API_KEY=your_openai_key_here
   ```

4. Build the extension bundle (required if running the legacy v1 agent):
   ```bash
   npm run extension:build
   ```

---

## 🏎️ Developer Commands

### 1. Build and Compile checks
Verify typescript compiles without emitting files:
```bash
npm run build
```

### 2. Run Architectural Boundary Checks
BrowseGent v2 enforces strict boundaries to prevent planner logic from leaking into execution substrates. Run the automated checks:
```bash
# Check boundaries, no-cognition leakages, and release gates
npm run check:v2
```

### 3. Run Unit Tests
Run standard Node.js unit tests on the v2 runtime components:
```bash
npm run test:unit
```

### 4. Run BrowseGent v2 Benchmarks
To run the automated v2 evaluation benchmarks and inspect metrics:
```bash
# Execute the v2 benchmark runner
npm run benchmark:v2

# Compare reports after multiple benchmark runs
npm run benchmark:v2:compare
```

### 5. Run Legacy Evaluations (v1)
BrowseGent comes with a 30-task evaluation suite (10 Core + 20 Extended tasks) to assess performance:
```bash
# Run the core 10-task evaluation
npm run eval

# Run a specific task (e.g., hacker_news_top)
npm run eval -- --task hacker_news_top

# Run all 30 benchmark tasks
npm run eval -- --suite all
```

---

## 🤖 Supported LLM Providers

| Provider | Integration Type | Features |
| :--- | :--- | :--- |
| **Gemini** | Cloud REST | Default provider. Leverages native JSON schema validation and retry/backoff. |
| **OpenAI** | Cloud REST | Utilizes OpenAI Chat Completions with structured outputs. |
| **Cerebras** | Cloud SDK | High-speed inference with automatic execution retries. |
| **Ollama** | Local REST | Allows offline operation using local models. |

---

## 🔬 Research Context

BrowseGent is a research project designed to explore browser agent reliability. Rather than building a commercial scraping wrapper, this architecture aims to prove that **browser agents become significantly more reliable when perception, action identity, and DOM stabilization are modeled explicitly** in a deterministic runtime substrate.

---

## 📄 License

This project is open-source under the **ISC License**. See the `package.json` file for details.
