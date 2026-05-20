# DOM and Event Architecture Analysis

## Purpose

This document captures what BrowseGent should borrow from the browser-use DOM Processing Engine and Event-Driven Architecture docs, what it should explicitly avoid, and how those ideas map onto BrowseGent's real codebase.

Current decision:

- DOM understanding is the next main implementation phase
- event-driven concepts are useful, but only as a lighter later adaptation

## Docs Reviewed

From `/d:/BrowseGent/browser-use-docs(inspiration-only)/DOM Processing Engine/`:

- `DOM-Processing-Engine.md`
- `DOM-Tree-Construction.md`
- `DOM-Serialization-Pipeline.md`
- `Interactive-Element-Detection.md`
- `Visibility-Calculation-and-Coordinate-Transformation.md`
- `Screenshot-Highlighting-System.md`
- `Browser-State-Summary.md`

From `/d:/BrowseGent/browser-use-docs(inspiration-only)/Event-Driven Architecture/`:

- `Event-Driven-Architecture.md`
- `Event-System-Overview.md`
- `Event-Types-Reference.md`
- `Watchdog-Pattern-and-Base-Classes.md`
- `Core-Watchdog-Implementations.md`

## Current BrowseGent Baseline

### What BrowseGent Already Has

- Brain1 scan and filtering in `/d:/BrowseGent/extension/content.ts`
- Brain2 mutation attribution in `/d:/BrowseGent/extension/content.ts`
- graph snapshot and delta model in `/d:/BrowseGent/src/graph/types.ts`
- compact graph serialization in `/d:/BrowseGent/src/graph/serializer.ts`
- DOM-first execution adapter in `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`
- loop detection and nudges in `/d:/BrowseGent/src/agent/loopDetector.ts`

### What BrowseGent Does Not Have

- merged DOM + accessibility + layout data model
- selector map or stable runtime node identity
- viewport-aware visibility / interactability scoring
- occlusion / paint-order filtering
- browser state summary as a first-class subsystem
- popup / download / crash / health monitoring as dedicated runtime components
- event bus, typed runtime event catalog, or watcher abstraction

### Most Important Current Gap

BrowseGent's next bottleneck is not the agent loop anymore. It is DOM understanding quality:

- weak selector specificity
- shallow interactive element detection
- minimal visibility checks
- no actionability scoring

That is consistent with recent eval failures: the agent often executes valid actions against weak or ambiguous targets.

## DOM Processing Engine: What Browser-use Is Solving

browser-use solves a broader DOM problem than BrowseGent currently does:

- collect DOM, accessibility, layout, paint-order, and event-listener signals
- fuse them into a richer node model
- run a multi-stage filtering pipeline
- keep a selector map for downstream actions
- produce both LLM-facing text and execution-facing structure

This is a strong design, but it depends on a CDP-heavy architecture that BrowseGent does not have today.

## What BrowseGent Should Adapt From The DOM Layer

## 1. Multi-Stage DOM Reduction

This is the most important conceptual takeaway.

Right now Brain1 in `/d:/BrowseGent/extension/content.ts` does most of its work in one pass:

- walk DOM
- apply simple keep/drop heuristics
- emit `FilteredNode`

BrowseGent should move toward a staged DOM reduction model:

1. collect candidate nodes
2. classify interactive vs informational intent
3. score visibility / interactability
4. score selector quality
5. serialize only the best signals

This does not require CDP or a full serializer rewrite. It does require making Brain1 less monolithic.

## 2. Stronger Interactive Element Detection

browser-use is much stronger here. BrowseGent currently relies mostly on:

- tag name
- trigger keywords
- `href`
- `placeholder`
- `aria-label`
- simple text length checks

That is good enough to bootstrap, but not good enough for production-grade targeting.

BrowseGent should add more interaction signals:

- role-based detection: `role=button`, `role=link`, `role=menuitem`, `role=tab`, `role=option`
- form affordances: `type=submit`, `type=search`, `contenteditable`
- keyboard reachability: `tabindex`
- direct action hints: `onclick`, `onmousedown`, `data-*` action attributes
- state hints: `disabled`, `aria-disabled`, `aria-expanded`, `aria-selected`
- visual cues: `cursor: pointer`

This should happen in Brain1, not only at click time.

## 3. Selector Quality As A First-Class Concern

browser-use's selector map is valuable because it separates "what the model sees" from "how the action layer finds it."

BrowseGent should not copy their CDP index system, but it should borrow the idea:

- generate better selector candidates per node
- rank them for stability
- prefer `id`, `data-testid`, `name`, stable `aria-label`, and constrained attribute selectors
- avoid weak generic selectors unless there is no better option

Practical BrowseGent adaptation:

- extend `FilteredNode` in `/d:/BrowseGent/src/brain1/types.ts`
- include selector quality metadata, not just a single selector string
- keep one primary selector for phase 1, but also keep enough metadata to regenerate or validate it later

## 4. Stronger Visibility and Interactability Scoring

browser-use goes far beyond our current `display / visibility / opacity` checks.

BrowseGent should improve this in a lightweight way:

- viewport intersection check
- bounding-box size threshold
- `pointer-events: none`
- disabled state
- off-screen vs merely hidden distinction
- scrollable-container awareness

We do not need full paint-order filtering yet. But we do need better "should this element be considered realistically actionable?" logic.

The current DOM adapter in `/d:/BrowseGent/src/executor/adapters/domAdapter.ts` is too shallow to be the only line of defense.

## 5. Lightweight Page Summary Fields

browser-use's `BrowserStateSummary` is too large for BrowseGent right now, but the idea is still useful.

BrowseGent should eventually add a lighter summary layer containing:

- page title
- viewport dimensions
- scroll position / scrollability
- pending-network hint
- likely pagination controls
- page-type hints when detectable

This should be a later DOM-adjacent addition, not the next implementation step.

## 6. Better Shadow DOM Awareness

BrowseGent already counts shadow roots in `/d:/BrowseGent/extension/content.ts`, but it mostly logs them.

We should improve this to:

- traverse open shadow roots when possible
- mark nodes as shadow-derived
- avoid silently degrading target coverage when important inputs/buttons live inside shadow DOM

## What BrowseGent Should Not Copy From The DOM Layer

- full CDP DOM + AX + snapshot fusion
- backend node IDs and heavy selector-map infrastructure
- paint-order / stacking-context pipeline
- screenshot highlighting system
- cross-origin iframe geometry machinery
- browser-use's full `BrowserStateSummary` shape

These are good systems, but they are not the right next BrowseGent step. They would add a lot of complexity before fixing the actual current bottleneck.

## DOM Improvements BrowseGent Should Build Next

## Phase 1: Brain1 Hardening

Primary files:

- `/d:/BrowseGent/extension/content.ts`
- `/d:/BrowseGent/src/brain1/types.ts`
- `/d:/BrowseGent/src/graph/serializer.ts`

Build next:

- richer interactive element heuristics
- better visibility scoring
- better selector generation rules
- selector confidence / quality metadata

## Phase 2: Actionability Integration

Primary files:

- `/d:/BrowseGent/src/executor/adapters/domAdapter.ts`
- `/d:/BrowseGent/src/executor/definitions/click.ts`
- `/d:/BrowseGent/src/executor/definitions/type.ts`

Build after Phase 1:

- reject obviously weak targets earlier
- use Brain1 hints to guide click/type validation
- align DOM execution with Brain1's view of interactability

## Event-Driven Architecture: What Browser-use Is Solving

browser-use uses EventBus + watchdogs to solve a different class of problems:

- browser lifecycle management
- downloads
- popups and dialogs
- DOM state requests
- crash detection
- action execution routing
- cross-component observability

This architecture is strong, but it is sized for a larger browser-session orchestration layer than BrowseGent currently has.

## What BrowseGent Should Adapt From The Event Layer

## 1. Separation Into Small Runtime Monitors

This is the most useful event-driven idea for BrowseGent.

Instead of letting `/d:/BrowseGent/src/BrowseGent.ts` or ad hoc hooks accumulate more responsibilities, we should eventually break runtime concerns into small focused monitors:

- navigation monitor
- popup/dialog monitor
- download monitor
- browser health / provider health monitor
- DOM invalidation monitor

These do not need an event bus to be useful.

## 2. Typed Runtime Signals

browser-use is right that browser runtime signals should be explicit.

BrowseGent should eventually formalize small internal signal/result types for:

- navigation completed
- page invalidated
- popup handled
- download started / completed
- browser unstable / crashed

This would make runtime behavior easier to trace and test without adopting a full pub/sub architecture.

## 3. Watcher Mindset For Non-Agent Concerns

The docs make a strong architectural point: browser lifecycle concerns should not be smeared across the action layer.

That maps well to BrowseGent.

Examples of what should become focused monitors later:

- `page.on('dialog')` handling
- `page.on('download')` tracking
- navigation / SPA route-change awareness
- crash / disconnect handling
- provider preflight and health checks

## 4. Centralized Observability For Runtime Signals

Even without an event bus, browser-use is right that these runtime events should be observable and correlated.

BrowseGent should eventually log these under shared execution IDs and trace them alongside agent steps.

## What BrowseGent Should Not Copy From The Event Layer

- full EventBus
- typed event class hierarchy for every action
- watchdog base classes
- auto-registration framework
- event trees and parent tracking
- circuit-breaker-heavy orchestration
- turning every tool/action into an event

This would be too much architecture for BrowseGent right now.

The current bottleneck is still DOM quality, not runtime orchestration complexity.

## Recommended BrowseGent Event Adaptation

When BrowseGent reaches that phase, it should implement a lighter pattern:

```text
BrowseGent Runtime
  -> attach small monitors to context/page
  -> emit typed local signals
  -> update shared execution state
  -> log with executionId / actionId
```

Suggested future components:

- `NavigationMonitor`
- `DialogMonitor`
- `DownloadMonitor`
- `BrowserHealthMonitor`

This keeps the benefits of the watchdog mindset without copying browser-use's whole session architecture.

## Final Decision

## What Is Worth Adapting Now

- staged DOM reduction mindset
- stronger interactive element detection
- selector-quality thinking
- stronger visibility / interactability scoring

## What Is Worth Adapting Later

- lightweight runtime monitors
- typed runtime signals
- lightweight page summary fields

## What Should Be Deferred

- full event bus
- full watchdog architecture
- full browser state summary subsystem
- screenshot highlighting
- CDP-heavy DOM fusion

## Recommended Next BrowseGent Phase

**DOM Understanding Hardening**

This should be the next implementation phase, specifically:

1. interactive element detection
2. selector quality
3. visibility / interactability scoring

Event-driven architecture is useful inspiration, but it should not outrank DOM understanding in the roadmap.
