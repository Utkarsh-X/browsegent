# Observation Layer Audit & Coverage Program Specification

This specification outlines the plan to implement a rigorous **Observation Layer Audit and Coverage Program** for BrowseGent v2. The objective is to verify how accurately, stably, and completely BrowseGent's DOM crawling substrate captures browser reality.

---

## 1. Goal & Testing Philosophy

The observation layer is the entry point of the entire pipeline. If it is inaccurate, unstable, or omits elements, the downstream subsystems (Refs, Continuity, Graph, Planner) will fail. 

Rather than running reasoning-heavy benchmarks, this program focuses entirely on **perception verification**:
1.  **Phase 1 (Invariants)**: Programmatic verification of coverage, filtering, and shadow roots using Playwright and dynamic `page.setContent()`.
2.  **Phase 2 (Real Website Audit)**: Script-based transitions (State A -> B -> C) on public websites to measure semantic extraction, stability, and loss rates.
3.  **Phase 3 (Audit Report)**: Summarize findings in a structured `OBSERVATION_AUDIT_REPORT.md`.

---

## 2. Phase 1: Local Invariant Audit

Tests will be created in `tests/integration/v2/observationAudit.test.ts`. Page content is injected dynamically in Playwright using `page.setContent()` to isolate DOM structures.

### 2.1 Coverage Invariant
*   **HTML**: Injects a form containing a `text input`, `textarea`, `button`, `link`, `checkbox`, `radio button`, `select dropdown`, and a `combobox` input.
*   **Assertion**: Gathers observation and asserts that every single control is successfully found and mapped to `V2Ref`s.

### 2.2 Hidden Element Invariant
*   **HTML**: Injects elements styled with `display: none`, `visibility: hidden`, `opacity: 0`, and `aria-hidden="true"`.
*   **Assertion**: Asserts that none of these elements pollute the active action surface (their `visibility` must be `'hidden'`).

### 2.3 Dynamic Paint Invariant
*   **HTML**: A script appends a button after 300ms.
*   **Assertion**: Gathers observation after stabilization, verifying the late-bound button is captured.

### 2.4 Open Shadow DOM Invariant
*   **HTML**: Creates a custom element with an open shadow root containing `<button>Shadow Action</button>`.
*   **Assertion**: Gathers observation and verifies `Shadow Action` is successfully crawled.
*   *Note*: Closed shadow roots are a known limitation and are excluded from required coverage.

### 2.5 Nested Open Shadow DOM Invariant
*   **HTML**: Nest an open shadow root inside another open shadow root containing `<button>Nested Action</button>`.
*   **Assertion**: Gathers observation and verifies the nested button is successfully crawled.

---

## 3. Phase 2: Real Website State Transitions & Known Controls

An offline audit script `scripts/run_observation_audit.ts` (run via `npm run audit:observation`) will execute 3-state transitions for the following target sites:

### 3.1 Wikipedia (Baseline Sanity Site)
*   **State A**: Homepage (`https://www.wikipedia.org/`).
    *   *Known Controls*: Search input, language dropdown, search button.
*   **State B**: Type "software engineering" and click search.
*   **State C**: Article page.
    *   *Known Controls*: Edit page button, contents list link.

### 3.2 Cambridge Dictionary
*   **State A**: Homepage (`https://dictionary.cambridge.org/`).
    *   *Known Controls*: Search input, search button.
*   **State B**: Type "sustainability" (capturing autocomplete popup).
    *   *Known Controls*: Search input, autocomplete dropdown item.
*   **State C**: Definition page.
    *   *Known Controls*: UK audio speaker button, US audio speaker button.

### 3.3 Amazon
*   **State A**: Homepage (`https://www.amazon.com/`).
    *   *Known Controls*: Search input, search submit button.
*   **State B**: Type "laptop" and click search button.
    *   *Known Controls*: Search input.
*   **State C**: Results page.
    *   *Known Controls*: Next page link, filter checkboxes, product cards.

### 3.4 GitHub
*   **State A**: Homepage (`https://github.com/`).
    *   *Known Controls*: Sign in link, Sign up button.
*   **State B**: Open repository `https://github.com/Utkarsh-X/browsegent`.
    *   *Known Controls*: Code tab link, Issues tab link.
*   **State C**: Click Issues tab.
    *   *Known Controls*: Search issues input, filters dropdown button.

### 3.5 Reddit (Exploratory Only, Non-Critical)
*   **State A**: Homepage (`https://www.reddit.com/`).
    *   *Known Controls*: Search input, login button.
*   **State B**: Open `https://www.reddit.com/r/javascript/`.
    *   *Known Controls*: Join subreddit button, post titles.
*   **State C**: Click first post link.
    *   *Known Controls*: Comments text box, upvote button.

---

## 4. Telemetry Metrics

For every observation captured during transitions, the script will compute and report:

1.  **Observation Loss Rate**:
    $$\text{Loss Rate} = 1 - \frac{\text{Observed Known Controls}}{\text{Total Expected Known Controls}}$$
2.  **Observation Stability**: Capture the page 5 times consecutively (no interaction, 50ms interval). Measure the variance in `refCount` and working set element IDs. (Expected variance should be $\approx 0$).
3.  **Duplicate Name Density**:
    $$\text{Duplicate Density} = \frac{\text{Duplicate Labels}}{\text{Total Refs}}$$
4.  **Actionability Coverage**:
    $$\text{Actionability Coverage} = \frac{\text{Actionable Refs}}{\text{Total Observed Refs}}$$
5.  **Segmented Latency Cost**:
    *   *Observation Time*: DOM extraction execution time.
    *   *Ref Generation Time*: Fingerprint hashing and RefService matching execution time.
    *   *Working Set Time*: Selector ranking and pruning execution time.

---

## 5. Next Steps

1.  Create `tests/integration/v2/observationAudit.test.ts`.
2.  Create `scripts/run_observation_audit.ts`.
3.  Execute the audit suite and output the findings to `OBSERVATION_AUDIT_REPORT.md`.
