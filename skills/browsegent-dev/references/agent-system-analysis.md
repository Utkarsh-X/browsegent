# Agent System Analysis

## Purpose

This document captures what BrowseGent should borrow from the browser-use Agent System docs for the current phase, what it should explicitly avoid, and how those concepts map onto BrowseGent's real codebase.

Current phase focus:

- agent core and execution loop
- agent state and history management
- loop detection and behavioral nudges

Deferred for later:

- browser state summary as a formal subsystem
- message compaction
- follow-up task memory
- full agent checkpointing / restore
- richer prompt/output mode matrix

## Docs Reviewed

From `/d:/BrowseGent/browser-use-docs(inspiration-only)/Agent System/`:

- `Agent-System.md`
- `Agent-Core-and-Execution-Loop.md`
- `Agent-State-and-History-Management.md`
- `Message-Manager-and-Prompt-Construction.md`
- `System-Prompts-and-Output-Formats.md`
- `Agent-Configuration-and-Settings.md`
- `Loop-Detection-and-Behavioral-Nudges.md`

## Current BrowseGent Baseline

BrowseGent already has:

- a working observe -> plan -> act -> re-observe loop
- typed LLM plan envelopes and shared action types
- a functioning Action System
- compact graph serialization with recent action history
- structured executor results

BrowseGent does not yet have:

- explicit loop detection
- no-progress signaling
- page fingerprint tracking
- prompt-level nudge injection
- separated runtime state vs prompt history vs persistent history models

Relevant repo files:

- `/d:/BrowseGent/src/agent/loop.ts`
- `/d:/BrowseGent/src/agent/planExecutor.ts`
- `/d:/BrowseGent/src/agent/prompt.ts`
- `/d:/BrowseGent/src/graph/serializer.ts`
- `/d:/BrowseGent/src/executor/types.ts`

## What To Borrow Directly

## 1. Dedicated Loop Detector

browser-use is correct to make loop detection a small, explicit subsystem instead of scattering heuristics across the agent loop.

BrowseGent should add a focused detector object that tracks:

- recent executed action fingerprints
- recent page/graph fingerprints
- repetition severity
- stagnation severity

This should stay small and local to the agent layer.

## 2. Two-Dimensional Detection

This is the strongest idea in the docs.

Loop detection should not look only at repeated actions. It should track:

- action repetition
- page/graph stagnation

Why this matters for BrowseGent:

- repeated `click -> type -> click` on the same target is one failure mode
- different actions on an unchanged page is another
- combined detection gives higher confidence that the agent is stuck

## 3. Type-Specific Action Fingerprinting

browser-use normalizes actions before hashing. That maps very well to BrowseGent.

BrowseGent should normalize by action kind:

- `click` / `close`: `kind|target`
- `type`: `kind|target|normalized_input`
- `scroll`: `kind|direction`
- `select`: `kind|target|option`
- `get`: `kind|target`
- `wait`: `kind|pattern|timeout_bucket`

The detector should work on executed actions, not raw model text.

## 4. Soft Nudge Injection

browser-use does something valuable here: it does not mutate the core prompt template for every special case. It injects ephemeral context messages before the next LLM call.

BrowseGent should borrow the idea, but implement it more simply:

- no full MessageManager
- no multi-slot message system
- add a temporary warning block to the user prompt for the next LLM call only

This is enough for BrowseGent's current architecture.

## 5. Lightweight History Compression for Prompting

browser-use distinguishes full execution history from compressed history used in prompts. BrowseGent should adopt that idea selectively.

BrowseGent already has compact `ActionHistoryEntry` records in `/d:/BrowseGent/src/graph/serializer.ts`.

What to add:

- better formatting of recent failures and repeated patterns
- explicit inclusion of no-progress signals when present

What not to add yet:

- full `MessageManagerState`
- compaction LLM
- checkpointable prompt state

## What To Adapt, Not Copy

## 1. AgentState Split

browser-use has a large `AgentState`, `AgentHistoryList`, and `MessageManagerState` separation.

BrowseGent should not copy that whole state model yet.

What BrowseGent does need:

- a minimal runtime `LoopDetectorState`
- a small per-run execution state object if needed

What BrowseGent does not need yet:

- checkpoint serialization
- pause/resume state
- file system state in the agent
- distributed tracing state model

## 2. Page Fingerprint Design

browser-use uses `url + element_count + text_hash` from `BrowserStateSummary`.

BrowseGent does not have that subsystem yet, and you explicitly want to defer it.

So for BrowseGent now, page stagnation should be based on a graph-oriented fingerprint:

- current page URL
- snapshot counts such as data nodes / triggers / inputs
- compact hash of serialized graph content or selected graph slices
- recent non-noise delta summary

This keeps the detector aligned with BrowseGent's actual planning state.

## 3. Thresholds

browser-use uses thresholds like 5 / 8 / 12 repetitions in a 20-action window.

BrowseGent only has a `maxSteps` default of 15 in `/d:/BrowseGent/src/agent/loop.ts`.

So BrowseGent should use smaller and earlier thresholds.

Suggested BrowseGent thresholds:

- first nudge: 3 repeated action fingerprints in recent window
- strong nudge: 5 repeated fingerprints
- critical no-progress: 6 repeated fingerprints or 4 stagnant graph states

These should be tuned by eval, not frozen permanently.

## 4. Soft Nudge vs Hard Guard

browser-use intentionally keeps loop detection non-blocking.

BrowseGent should use a hybrid:

- first response: soft nudge
- second response: stronger nudge
- final response: hard abort with `no_progress_detected`

Reason:

BrowseGent cannot afford to spend 12 of 15 steps "gently warning" itself.

## What To Avoid For Now

- full MessageManager architecture
- message compaction subsystem
- prompt variant matrix like standard/no-thinking/flash
- checkpoint and restore machinery
- follow-up task memory
- browser state summary as a separate subsystem
- configuration explosion before the feature works

These are real systems in browser-use, but they are not the current BrowseGent bottleneck.

## BrowseGent-Specific Design Direction

## Recommended Next Component

**Loop Detection and Behavioral Nudges**

## Minimal BrowseGent Architecture

```text
runAgentLoop()
  -> LoopDetector.recordGraphState()
  -> LoopDetector.maybeGetSignal()
  -> callLLM(goal, graphJson, actionHistory, loopSignal?)
  -> executePlan(...)
  -> LoopDetector.recordExecutedActions(...)
  -> afterAct()
```

## New Small Modules To Add

Suggested additions:

- `/d:/BrowseGent/src/agent/loopDetector.ts`
- optional `/d:/BrowseGent/src/agent/loopState.ts` if the state grows

Core types:

- `ActionFingerprint`
- `GraphFingerprint`
- `LoopSignal`
- `LoopSeverity`

## LoopSignal Shape

Suggested contract:

```ts
interface LoopSignal {
  severity: 'info' | 'warning' | 'critical';
  type: 'action_repetition' | 'page_stagnation' | 'combined' | 'no_progress';
  message: string;
  repeatedAction?: string;
  repetitionCount?: number;
  stagnantSteps?: number;
  shouldAbort: boolean;
}
```

## Graph Fingerprint Strategy

Until a dedicated Browser State Summary exists, compute a graph fingerprint from existing inputs:

- `graph.pageUrl`
- snapshot counts
- compact representation of `serialized.d`, `serialized.tr`, and `serialized.del`

Avoid hashing huge raw DOM strings.

## Prompt Injection Strategy

Do not build a full MessageManager.

Instead:

- extend `callLLM()` input to accept optional context notes
- have `prompt.ts` render a short warning block only when a loop signal exists
- keep the warning ephemeral for that step only

Example shape:

```text
Warning:
- You have repeated the same action pattern 5 times without changing the observed page state.
- Try a different element, a different page area, or conclude that this approach is not working.
```

## Hard Abort Strategy

BrowseGent should not rely only on nudges.

Recommended hard-abort cases:

- same action pattern continues after critical signal
- graph fingerprint remains stagnant across multiple LLM cycles
- repeated success-path actions with no meaningful graph change

Abort reason to introduce:

- `no_progress_detected`

This can live alongside existing plan failure and max-step failure handling.

## Proposed Implementation Order

### Step 1

Add pure fingerprinting utilities with unit tests.

### Step 2

Add `LoopDetector` state and detection logic.

### Step 3

Record executed actions and graph fingerprints in the loop.

### Step 4

Inject soft nudges into the next LLM prompt.

### Step 5

Add critical `no_progress_detected` exit behavior.

### Step 6

Run targeted evals against known loop-prone tasks.

## Tests To Add

- same click target repeated -> repetition signal
- different actions on identical graph -> stagnation signal
- combined repetition + stagnation -> critical signal
- changed graph resets stagnation counter
- different targets do not collide under fingerprinting
- prompt receives nudge text only for the current step
- critical no-progress exits before max steps

## What This Unlocks Next

Once this lands, BrowseGent is in a better place to tackle:

- interactive element detection hardening
- visibility / actionability checks
- smarter recovery decisions
- later browser state summary work

## Immediate Recommendation

Do not move to Browser State Summary yet.

Finish the Agent System phase in this order:

1. loop detection and behavioral nudges
2. minimal agent/runtime state improvements needed for loop detection
3. prompt-side ephemeral warning injection

Then move to DOM understanding hardening.
