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
