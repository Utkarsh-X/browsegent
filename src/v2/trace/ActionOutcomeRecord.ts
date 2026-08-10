export type ActionSource = 'dispatch' | 'pre_execution_guard' | 'hard_block';

export interface ActionOutcome {
  stepIndex: number;
  tool: string;
  targetRef?: string;
  source: ActionSource;
  success: boolean;
  errorCode?: string;
  stateChanged: boolean;         // transition evidence: urlChanged || generationChanged
  readEvidenceProduced: boolean;  // ONLY for successful get | inspect_region | nonempty search_page
  inputApplied?: boolean;         // successful type/select action accepted by the browser
}

export interface ActionOutcomeSummary {
  total: number;
  dispatched: number;
  preExecutionRejected: number;
  hardBlocked: number;
  stateChanging: number;
  evidenceProducing: number;
  inputApplied: number;
  failed: number;
  noEffect: number;
}

export class ActionOutcomeRecorder {
  private outcomes: ActionOutcome[] = [];

  record(outcome: ActionOutcome): void {
    this.outcomes.push(outcome);
  }

  getOutcomes(): readonly ActionOutcome[] { return this.outcomes; }

  summary(): ActionOutcomeSummary {
    const dispatched = this.outcomes.filter(o => o.source === 'dispatch');
    return {
      total: this.outcomes.length,
      dispatched: dispatched.length,
      preExecutionRejected: this.outcomes.filter(o => o.source === 'pre_execution_guard').length,
      hardBlocked: this.outcomes.filter(o => o.source === 'hard_block').length,
      stateChanging: this.outcomes.filter(o => o.stateChanged).length,
      evidenceProducing: this.outcomes.filter(o => o.readEvidenceProduced).length,
      inputApplied: dispatched.filter(o => isSuccessfulInputAction(o)).length,
      failed: this.outcomes.filter(o => !o.success).length,
      noEffect: dispatched.filter(o => o.success && !o.stateChanged && !o.readEvidenceProduced && !isSuccessfulInputAction(o)).length,
    };
  }

  toJSON(): unknown { return { outcomes: this.outcomes, summary: this.summary() }; }
}

function isSuccessfulInputAction(outcome: ActionOutcome): boolean {
  return outcome.success
    && (outcome.inputApplied === true || outcome.tool === 'type' || outcome.tool === 'select');
}
