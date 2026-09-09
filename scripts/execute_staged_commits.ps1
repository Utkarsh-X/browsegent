# Automated Git Commit Stager
# Executes the 20-stage atomic commit plan cleanly.

Write-Host "Starting 20-stage professional commit sequence..." -ForegroundColor Cyan

# 1. Substrate Truthful Typing
git add src/v2/substrate/InputService.ts src/v2/runtime/errors.ts tests/unit/v2/inputServiceErrorMapping.test.ts
git commit -m "fix(substrate): enforce truthful typing confirmation in InputService"

# 2. Failure Classifier
git add src/v2/runtime/FailureClassifier.ts tests/unit/v2/failureClassifier.test.ts
git commit -m "feat(runtime): integrate input_not_applied operational failure classification"

# 3. Recovery State
git add src/v2/runtime/RecoveryState.ts tests/unit/v2/recoveryState.test.ts
git commit -m "feat(runtime): add launcher recovery mechanisms for unapplied input errors"

# 4. Observation Service Delayed Hydration
git add src/v2/substrate/ObservationService.ts src/v2/substrate/types.ts src/v2/runtime/types.ts src/v2/harness/BrowseGentV2Harness.ts tests/fixtures/v2/delayed-hydration.html tests/fixtures/v2/suggestion-gated-combobox.html tests/unit/v2/observationShape.test.ts tests/integration/v2/observationRuntime.test.ts
git commit -m "feat(substrate): add bounded delayed-hydration retry and value extraction in ObservationService"

# 5. Brain1 Projection Form & Protocol Attributes
git add src/v2/brain1/projectionTypes.ts src/v2/brain1/rankOperationalItems.ts src/v2/brain1/serializeProjection.ts tests/unit/v2/brain1Projection.test.ts
git commit -m "feat(brain1): preserve form field values and combobox protocol metadata in projection serialization"

# 6. AnswerContract Temporal Decoupling
git add src/v2/agent/AnswerContract.ts tests/unit/v2/answerContract.test.ts
git commit -m "fix(agent): decouple temporal retrieval terms from ranking evidence requirements in AnswerContract"

# 7. Evidence Ledger
git add src/v2/agent/EvidenceLedger.ts tests/unit/v2/evidenceLedger.test.ts
git commit -m "feat(agent): introduce EvidenceLedger for cross-observation fact accumulation"

# 8. Finalization Evidence Integration
git add src/v2/agent/FinalizationEvidence.ts tests/unit/v2/taskEvidenceCoverage.test.ts
git commit -m "refactor(agent): integrate EvidenceLedger into finalization evidence compilation"

# 9. Agent Loop Progress Memory & Rejection Recovery
git add src/v2/agent/V2AgentLoop.ts tests/unit/v2/v2AgentLoop.test.ts
git commit -m "feat(agent): enhance ActionProgressMemory and prevent duplicate rejected answer loops"

# 10. Working Set Selector Goal Phrase Heuristics
git add src/v2/planner/PlannerWorkingSetSelector.ts tests/unit/v2/plannerWorkingSetSelector.test.ts
git commit -m "feat(planner): extend working set selector with goal-phrase matching heuristics"

# 11. Planner Input Composer Snapshot Wiring
git add src/v2/planner/PlannerInputComposer.ts src/v2/planner/types.ts tests/unit/v2/plannerInputComposer.test.ts
git commit -m "feat(planner): pass multi-observation evidence snapshots through PlannerInputComposer"

# 12. Planner Prompt PRC Guidelines
git add src/v2/planner/PlannerPrompt.ts tests/unit/v2/plannerPrompt.test.ts
git commit -m "refactor(planner): refine PRC system prompt layout and compact notation guidelines"

# 13. PRC Layout Engine & Score-Tier Omission
git add src/v2/planner/prc/PromptLayoutEngine.ts src/v2/planner/prc/PlannerRepresentationCompiler.ts src/v2/planner/prc/types.ts tests/unit/v2/prc/promptLayoutEngine.test.ts
git commit -m "feat(prc): add score-tier omission and compact data-plane rendering in PromptLayoutEngine"

# 14. Planner Empty Observation Wait Recovery
git add src/v2/planner/V2PlannerClient.ts tests/unit/v2/v2PlannerClient.test.ts
git commit -m "feat(planner): add empty observation wait rescue in V2PlannerClient"

# 15. Runtime Contracts Regression
git add tests/unit/v2/runtimeContracts.test.ts
git commit -m "test(v2): add regression tests for runtime contracts and agent loop finalization"

# 16. Audit Documentation
git add progress-docs/2026-08-30-correctness-bottleneck-audit.md
git commit -m "docs(audit): document correctness bottleneck audit and failure taxonomy"

# 17. Booking-10 Forensic Report
git add progress-docs/2026-08-31-booking10-forensic-report.md
git commit -m "docs(audit): add Booking-10 forensic report on combobox protocols and hydration timing"

# 18. Flash-Lite Telemetry Report
git add progress-docs/flash-lite-runs-comparison.md
git commit -m "docs(benchmark): add comprehensive Gemini Flash-Lite telemetry comparison report"

# 19. Monitor Script Tooling
git add scripts/monitor_download.ps1
git commit -m "chore(scripts): add background task monitor script for asynchronous benchmark tracking"

# 20. Commit Strategy Documentation
git add progress-docs/commit-strategy-plan.md scripts/execute_staged_commits.ps1
git commit -m "docs(strategy): add 20-stage atomic commit strategy plan and execution script"

Write-Host "All 20 commits successfully created!" -ForegroundColor Green
