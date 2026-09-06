# Run 23 — Validation Report: T1 Stealth Launch Prototype (Turnstile Bypass & Persistence)

Run `webvoyager_lite_1788703918678`, balanced30, evaluated with `BROWSEGENT_STEALTH=1` (`--planner-serialization prc --judge --prc-lean-plane --planner-conditional-prompt`).

This run represents the inaugural live benchmark deployment of the **T1 Stealth Launch architecture** (`launchPersistentContext` + `--headless=new` + `--disable-blink-features=AutomationControlled` + consistent Chrome 134 UA & Client Hints + suite-persistent profile).

---

## 1. Headline Telemetry & Landmark Breakthrough

| Metric | Run 20 (Record) | Run 21 | Run 22 | **Run 23 (Stealth ON)** | Notes / Delta |
|---|---|---|---|---|---|
| **Bot CAPTCHA Walls** | 6 (20.00%) | 6 (20.00%) | 6 (20.00%) | **2 (6.67%)** | **-66.7% bot wall reduction (Record Low)** |
| **Strict Score** | **12/30 (40.00%)** | 9/30 (30.00%) | 7/30 (23.33%) | 7/30 (23.33%) | Hampered by 7 startup crashes (below) |
| **Judge Score Rate** | 54.55% (6/11) | 38.46% (5/13) | 46.15% (6/13) | 40.00% (4/10) | 4 approvals out of 10 evaluated |
| **Combined Solved** | **18/30 (60.00%)** | 14/30 (46.67%) | 13/30 (43.33%) | 11/30 (36.67%) | 11 tasks solved despite 7 unattempted tasks |
| **Internal Pass Rate** | **76.67% (23/30)** | 73.33% (22/30) | 66.67% (20/30) | 56.67% (17/30) | 17/23 = 73.91% completion on started tasks |
| **Avg. Planner Steps / Task** | 6.40 | 7.30 | 7.10 | **6.30** | -0.80 steps / task |
| **Avg. Input Tokens / Task** | 32,185 | 37,385 | 36,357 | 35,923 | Stable token economy |
| **Mean Tokens / Call** | 5,092 | 5,121 | 5,230 | 5,767 | Full element density |
| **Total Actions (Full Suite)**| 163 | 192 | 185 | **166** | 5.53 actions / task |
| **Avg. Total Duration / Task**| 66.91 s | 75.75 s | 74.44 s | 85.29 s | Inflated by the 7 stuck startups (40–114s each) |
| **Transient 503 Retries** | 0 | 0 | 0 | **0** | Flawless API connection |
| **Runtime Crash Count** | 0 | 0 | 0 | **7** | Browser-launch deaths, zero agent-loop crashes |

---

## 2. The Landmark Achievement: Turnstile Bot Wall Collapse

In all 22 prior benchmark iterations, Cloudflare Turnstile bot challenges formed an impassable wall on **6 to 7 tasks per run** (Allrecipes, Cambridge Dictionary, and Google Search).

In Run 23 with `BROWSEGENT_STEALTH=1`:
1. **`Allrecipes__3` Cleared**: Successfully bypassed the Cloudflare Turnstile challenge. The agent performed 13 steps of interactive search and browsing, terminating with an internal pass.
2. **`Allrecipes__10` Cleared**: Successfully bypassed Turnstile on step 1 and completed an 11-step exploratory trajectory to an internal pass.
3. **`Google__Search__0` Strict Victory**: Bypassed Google bot challenge heuristics and achieved an **exact ground-truth STRICT PASS** in 13 steps.
4. **Remaining Bot Walls Capped at 2**: Only Cambridge Dictionary (`Cambridge__Dictionary__0` and `Cambridge__Dictionary__10`) failed to bypass, which serves an aggressive server-side managed challenge requiring dedicated TLS fingerprinting.

This definitively confirms the core thesis: **hardened browser launch primitives eliminate 67% of environmental bot blocks on WebVoyager**.

---

## 3. Task Performance Rosters

### Strict Ground-Truth Passes (7 Tasks)
1. `webvoyager_Amazon__0`
2. `webvoyager_Amazon__10`
3. `webvoyager_Apple__0`
4. `webvoyager_ESPN__0`
5. `webvoyager_Google__Map__10`
6. `webvoyager_Google__Search__0` (**Stealth Victory**: First-ever strict pass on Google Search after clearing bot walls)
7. `webvoyager_Wolfram__Alpha__0`

### LLM Judge Approvals (4 Tasks)
1. `webvoyager_Apple__10`
2. `webvoyager_Coursera__0`
3. `webvoyager_Coursera__10`
4. `webvoyager_Wolfram__Alpha__10` (**5th consecutive pass in a row!** Unbroken D1 prose extraction stability).

---

## 4. Forensic Autopsy: The 7 `runtime_startup_failure` Tasks

Despite the Turnstile breakthrough, 7 tasks registered zero steps and failed immediately with `runtime_startup_failure`:
`ArXiv__0`, `ArXiv__10`, `BBC__News__0`, `BBC__News__10`, `ESPN__10`, `Google__Search__10`, `Huggingface__10`.

### Root Cause Identification (corrected post-diagnosis)

An earlier draft attributed the deaths to the context-reuse path (`this.page!` after nulling). That path **cannot fire at task startup**: each benchmark task constructs a fresh `new BrowseGent(...)` → fresh `BrowserSession` with `context === undefined`, so every task takes the first-launch branch, which does assign `this.page`. The reuse-path `this.page!` dereference is a **real latent bug** (it breaks any second `open()` inside a task, i.e. mid-task navigate) but no trace in run 23 contains its TypeError signature.

What the artifacts actually show:

- 7 tasks died **inside `open()`/the launch sequence**, 0 planner calls, no trace directory, durations 40–114s (a clean sequential stealth launch takes 0.3–1.2s — verified by reproducing the exact committed launch sequence 6/6 times in isolation against the same sites).
- The stealth profile's `Preferences` recorded `exit_type: "Crashed"` — Chromium processes were dying at/near launch during the run instead of exiting cleanly.
- The recorded error (`BrowserSession has no active page`) is the masked downstream symptom of an `open()` that resolved without delivering a live page; the exact micro-sequence (launch-then-die vs. profile-lock contention with an orphaned Chromium from the killed first attempt of run 23) is not fully reconstructable post-hoc. The owner's post-run headed experiments reproduced the same signature — launch with no window ever appearing.
- The committed T1 code had **no launch liveness verification and no retry**, so a half-dead launch propagated as garbage instead of failing precisely.

### Fix (commit `d563a0a`, 940/940 unit · tsc clean · check:v2 clean)

1. `launchStealthAttempt()` — verifies the acquired page is live at acquisition; closes the context quietly on any failure.
2. `openStealthContext()` — one self-healing relaunch, then `stealth_launch_failed after retry: <cause>` (names stale-profile-lock suspicion explicitly).
3. Reuse path — acquires a fresh live page and **rebuilds the context from scratch** if it died underneath (fixes the latent `this.page!` bug too).
4. `gotoWithRetry()` — fails fast when the page dies mid-load instead of retrying goto on a corpse.
5. `assertLivePage()` postcondition on **every** `open()` path (stealth and legacy): `open()` resolves with a live page or throws precisely — the masked "no active page" class is now structurally impossible.
6. Regression test: second `open()` on the same session yields a live page (would have caught the reuse bug).

### Impact & Projection

The 7 dead tasks include baseline anchors with historically high solve rates (run 20 scored 6/7 of them combined). With launch resilience fixed, the same stack projects back into the measured band **with the wall clears permanent**: ~16–20/30 combined (53–67%), above the run-20 record because 2–4 tasks that were captcha-locked in every prior run are now runnable.

---

## 5. Campaign Verdict

Run 23 is a successful proof of the stealth hypothesis:
- Turnstile is cracked for Allrecipes and Google Search (Google__Search__0 = strict exact).
- Bot walls fell from 20% of the benchmark to 6.7% (Cambridge only), environment-blocked count 6→0.
- The startup outage was a launch-resilience gap, fixed in commit `d563a0a`; a revalidation run (fix ON, nothing else changed) is the next benchmark spend, then the token program (T-A) gets its own flag-gated A/B.
- Operational hazard now on record: killing a run mid-flight orphans its Chromium, which keeps holding the stealth profile's singleton lock; the fixed launch path names this error instead of hanging silently.

---

## 6. Revalidation (Run 24, webvoyager_lite_1788718289231 — fix d563a0a ON)

| Metric | Run 20 (prior record) | Run 23 (stealth, buggy) | **Run 24 (stealth + fix)** |
| --- | ---: | ---: | ---: |
| Internal pass | 23/30 (76.7%) | 17/30 | **24/30 (80.0%) — record** |
| Strict | 12 (40%) | 7 | **12 (40%)** |
| Judge | 6/11 | 4/10 | **6/12 (50%)** |
| Combined | 18 | 11 | **18** |
| Startup deaths | 0 | 7 | **1** (root-caused, see §7) |
| Bot walls | 6–7 tasks | 2 | **2 (Cambridge only)** |

Walls held and advanced: **Allrecipes__3 judge PASS** (first judged pass on Allrecipes), Google__Search__0 strict exact again, Google__Search__10 ran. Durable wins replicated: GitHub__0 strict exact, Wolfram__0 exact, Wolfram__10 judge (6th consecutive), Apple__0 strict again, BBC News ×2 strict, ArXiv__0 strict. Remaining fails: Booking__0 planner_invalid_output_dead_end, Booking__10 answer_contract_failed:incomplete_answer, Flights__10 max steps, Cambridge ×2 (Cloudflare managed challenge), ESPN__0 (capture race, §7).

## 7. Second root cause found via run 24's unmasked error (fix b87f0e7)

ESPN__0 died at startup with the raw stack `page.evaluate: TypeError: Cannot read properties of null (reading 'getAttribute')` at `<anonymous>:421:33` — line 421 col 33 of the combined `CAPTURE_PAGE_CONTENT_SCRIPT` evaluate is exactly `READ_PAGE_LANG_SCRIPT`: `document.documentElement.getAttribute('lang')`. A page that calls `document.open()` (SPA soft-reset) briefly has **no documentElement**, so the lang probe threw and killed the entire capture → task. This is the run-23 failure family with the mask removed. Fixed with an in-page optional-chain guard; the established capture-retry design (navigation-race errors only) was deliberately kept so in-page script errors keep surfacing honestly.

## 8. Campaign verdict after revalidation

- Stealth is proven: two consecutive stealth runs, walls 6→2, Google Search + Allrecipes now runnable, zero environment-blocked tasks.
- The stack at run 24 (with both fixes) sits at record internal rate (80%) with the band's top combined score — the same stack that scored 18 in run 20, now covering 28 runnable tasks instead of 23.
- Next benchmark spend: T-A cache-aligned rendering A/B (token-first priority) with both fixes in.

## 9. Stealth research folded + T1 hardening landed (2026-09-07)

Research: `stealth-hardening-plan.md` (owner-run agent, worktree BrowseGent-arch-stealth). Key verdicts, all measured: Allrecipes/Google walls are triggered by the HeadlessChrome UA token; our Chrome/134 spoof vs native userAgentData 145 was a remotely checkable contradiction; Cambridge is a **driver-bound** Cloudflare managed challenge (same binary undriven clears in <65s; every driven variant challenges forever; Turnstile widget never renders).

**Landed (commit `3960a60`):** coherent binary-derived UA (Chrome/145.0.0.0, no hardcoded versions), extraHTTPHeaders client-hint overrides removed (they were partially ignored and incoherent), window-size offset (inner≠outer). Probed through production BrowserSession headless: **Allrecipes CLEARED 2.0s (360 interactive), Google CLEARED 0.5s (45)**; UA↔brands coherence pinned by unit test.

**Patchright probe (the decisive Cambridge experiment):** patchright 1.62.3 + coherent UA + persistent profile → **STILL_CHALLENGED at 121.5s** (same signature: "Just a moment...", zero Turnstile iframes). Together with the research's rebrowser result, this confirms the wall at a depth beyond all public driver patches. **Decision: no Patchright adoption** (no measured benefit; not worth a fork dependency + second browser binary). Cambridge-class walls stay honest `captcha_wall`, in-denominator. Stealth research loop is **closed** — no further rounds on Cambridge.

**Deferred (research-ranked low):** T2 undriven warm-up (optional, low load-bearing), V1 extension pruning (not on the v2 hot path). Note: `patchright` was installed `--no-save` for the probe and remains in node_modules only.
