import { createHash } from 'node:crypto';

import type { FilteredNode } from '../brain1/types';
import type { MutationDelta } from '../brain2/types';
import type { Action } from '../executor/types';
import type { SemanticGraph } from '../graph/types';

export type ActionFingerprint = string;
export type GraphFingerprint = string;
export type LoopSeverity = 'info' | 'warning' | 'critical';
export type LoopSignalType = 'action_repetition' | 'graph_stagnation' | 'combined' | 'no_progress';

export interface LoopSignal {
  severity: LoopSeverity;
  type: LoopSignalType;
  message: string;
  repeatedFingerprint?: string;
  repetitionCount?: number;
  stagnantSteps?: number;
  shouldAbort: boolean;
}

export interface LoopDetectorOptions {
  actionWindowSize?: number;
  graphFingerprintWindowSize?: number;
  infoRepetitionThreshold?: number;
  warningRepetitionThreshold?: number;
  criticalRepetitionThreshold?: number;
  infoStagnationThreshold?: number;
  warningStagnationThreshold?: number;
  criticalStagnationThreshold?: number;
}

const DEFAULTS: Required<LoopDetectorOptions> = {
  actionWindowSize: 12,
  graphFingerprintWindowSize: 5,
  infoRepetitionThreshold: 4,
  warningRepetitionThreshold: 5,
  criticalRepetitionThreshold: 5,
  infoStagnationThreshold: 3,
  warningStagnationThreshold: 4,
  criticalStagnationThreshold: 4,
};

export class LoopDetector {
  private readonly options: Required<LoopDetectorOptions>;
  private readonly recentActionFingerprints: ActionFingerprint[] = [];
  private readonly recentGraphFingerprints: GraphFingerprint[] = [];
  private repeatedFingerprint?: ActionFingerprint;
  private repetitionCount = 0;
  private stagnantSteps = 0;
  private criticalSignalStreak = 0;
  private lastCriticalPatternKey?: string;

  constructor(options: LoopDetectorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  recordAction(action: Action): ActionFingerprint {
    const fingerprint = fingerprintAction(action);
    this.recentActionFingerprints.push(fingerprint);
    if (this.recentActionFingerprints.length > this.options.actionWindowSize) {
      this.recentActionFingerprints.shift();
    }
    this.updateRepetitionStats();
    return fingerprint;
  }

  recordActions(actions: Action[]): ActionFingerprint[] {
    return actions.map(action => this.recordAction(action));
  }

  recordGraphState(graph: SemanticGraph): GraphFingerprint {
    const fingerprint = fingerprintGraph(graph);
    const previous = this.recentGraphFingerprints[this.recentGraphFingerprints.length - 1];
    if (previous === fingerprint) {
      this.stagnantSteps += 1;
    } else {
      this.stagnantSteps = 0;
      this.resetCriticalTracking();
    }
    this.recentGraphFingerprints.push(fingerprint);
    if (this.recentGraphFingerprints.length > this.options.graphFingerprintWindowSize) {
      this.recentGraphFingerprints.shift();
    }
    return fingerprint;
  }

  getSignal(): LoopSignal | null {
    const hasInfoRepetition = this.repetitionCount >= this.options.infoRepetitionThreshold;
    const hasWarningRepetition = this.repetitionCount >= this.options.warningRepetitionThreshold;
    const hasCriticalRepetition = this.repetitionCount >= this.options.criticalRepetitionThreshold;
    const hasInfoStagnation = this.stagnantSteps >= this.options.infoStagnationThreshold;
    const hasWarningStagnation = this.stagnantSteps >= this.options.warningStagnationThreshold;
    const hasCriticalStagnation = this.stagnantSteps >= this.options.criticalStagnationThreshold;

    const hasInfoSignal = hasInfoRepetition || hasInfoStagnation;
    const hasWarningSignal = hasWarningRepetition || hasWarningStagnation;
    const hasCriticalSignal = hasCriticalRepetition && hasCriticalStagnation;

    if (!hasInfoSignal) {
      this.resetCriticalTracking();
      return null;
    }

    if (hasCriticalSignal) {
      return this.createCriticalSignal();
    }

    this.resetCriticalTracking();

    const severity: LoopSeverity = hasWarningSignal ? 'warning' : 'info';
    const hasRepetitionSignal = hasInfoRepetition;
    const hasStagnationSignal = hasInfoStagnation;

    if (hasRepetitionSignal && hasStagnationSignal) {
      return {
        severity,
        type: 'combined',
        message:
          `Repeated action pattern detected ${this.repetitionCount} times and the observed page state has stayed unchanged for ${this.stagnantSteps} consecutive steps. ` +
          'This pattern is not making progress. Try a different element, a different page area, or a different strategy.',
        repeatedFingerprint: this.repeatedFingerprint,
        repetitionCount: this.repetitionCount,
        stagnantSteps: this.stagnantSteps,
        shouldAbort: false,
      };
    }

    if (hasRepetitionSignal) {
      return {
        severity,
        type: 'action_repetition',
        message:
          `You have repeated the same action pattern ${this.repetitionCount} times recently. ` +
          'This pattern is not making progress. Try a different approach instead of repeating the same interaction.',
        repeatedFingerprint: this.repeatedFingerprint,
        repetitionCount: this.repetitionCount,
        stagnantSteps: this.stagnantSteps,
        shouldAbort: false,
      };
    }

    return {
      severity,
      type: 'graph_stagnation',
      message:
        `The observed page state has stayed unchanged for ${this.stagnantSteps} consecutive steps. ` +
        'This pattern is not making progress. Try a different element, navigate elsewhere, or conclude this approach is not working.',
      repeatedFingerprint: this.repeatedFingerprint,
      repetitionCount: this.repetitionCount,
      stagnantSteps: this.stagnantSteps,
      shouldAbort: false,
    };
  }

  getDebugState(): {
    repeatedFingerprint?: ActionFingerprint;
    repetitionCount: number;
    stagnantSteps: number;
    criticalSignalStreak: number;
    recentActionFingerprints: ActionFingerprint[];
    recentGraphFingerprints: GraphFingerprint[];
  } {
    return {
      repeatedFingerprint: this.repeatedFingerprint,
      repetitionCount: this.repetitionCount,
      stagnantSteps: this.stagnantSteps,
      criticalSignalStreak: this.criticalSignalStreak,
      recentActionFingerprints: [...this.recentActionFingerprints],
      recentGraphFingerprints: [...this.recentGraphFingerprints],
    };
  }

  private createCriticalSignal(): LoopSignal {
    const currentPatternKey = `${this.repeatedFingerprint ?? 'none'}|${this.latestGraphFingerprint() ?? 'none'}`;
    if (this.lastCriticalPatternKey === currentPatternKey) {
      this.criticalSignalStreak += 1;
    } else {
      this.lastCriticalPatternKey = currentPatternKey;
      this.criticalSignalStreak = 1;
    }

    const shouldAbort = this.criticalSignalStreak >= 2;

    return {
      severity: 'critical',
      type: shouldAbort ? 'no_progress' : 'combined',
      message: shouldAbort
        ? `High-confidence no-progress detected: the same action pattern has repeated ${this.repetitionCount} times and the page state has stayed unchanged for ${this.stagnantSteps} consecutive steps. Continuing this pattern is unlikely to help.`
        : `High-confidence loop risk: the same action pattern has repeated ${this.repetitionCount} times and the page state has stayed unchanged for ${this.stagnantSteps} consecutive steps. This pattern is not making progress. Try a fundamentally different strategy now.`,
      repeatedFingerprint: this.repeatedFingerprint,
      repetitionCount: this.repetitionCount,
      stagnantSteps: this.stagnantSteps,
      shouldAbort,
    };
  }

  private latestGraphFingerprint(): GraphFingerprint | undefined {
    return this.recentGraphFingerprints[this.recentGraphFingerprints.length - 1];
  }

  private updateRepetitionStats(): void {
    const counts = new Map<ActionFingerprint, number>();
    for (const fingerprint of this.recentActionFingerprints) {
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
    }

    let maxFingerprint: ActionFingerprint | undefined;
    let maxCount = 0;
    for (const fingerprint of this.recentActionFingerprints) {
      const count = counts.get(fingerprint) ?? 0;
      if (count >= maxCount) {
        maxCount = count;
        maxFingerprint = fingerprint;
      }
    }

    this.repetitionCount = maxCount;
    this.repeatedFingerprint = maxFingerprint;
    if (this.repetitionCount < this.options.warningRepetitionThreshold) {
      this.resetCriticalTracking();
    }
  }

  private resetCriticalTracking(): void {
    this.criticalSignalStreak = 0;
    this.lastCriticalPatternKey = undefined;
  }
}

export function fingerprintAction(action: Action): ActionFingerprint {
  switch (action.kind) {
    case 'click':
    case 'close':
    case 'get':
      return `${action.kind}|${normalizeLoopText(action.target)}`;
    case 'type':
      return `${action.kind}|${normalizeLoopText(action.target)}|${normalizeLoopText(action.input)}`;
    case 'scroll':
      return `${action.kind}|${normalizeLoopText(action.direction)}`;
    case 'select':
      return `${action.kind}|${normalizeLoopText(action.target)}|${normalizeLoopText(action.option)}`;
    case 'wait':
      return action.pattern
        ? `${action.kind}|pattern:${normalizeLoopText(action.pattern)}`
        : `${action.kind}|sleep`;
    default:
      return `${action.kind}|unknown`;
  }
}

export function fingerprintGraph(graph: SemanticGraph): GraphFingerprint {
  const payload = {
    pageUrl: graph.pageUrl,
    status: graph.status,
    counts: {
      total: graph.snapshot.length,
      dataLike: graph.snapshot.filter(node => node.type === 'data' || node.type === 'input' || node.type === 'table_cell').length,
      triggers: graph.snapshot.filter(node => node.type === 'trigger').length,
    },
    dataLike: graph.snapshot
      .filter(node => node.type === 'data' || node.type === 'input' || node.type === 'table_cell')
      .slice(0, 20)
      .map(stableNodeSlice),
    triggers: graph.snapshot
      .filter(node => node.type === 'trigger')
      .slice(0, 10)
      .map(stableNodeSlice),
    deltas: graph.deltas
      .filter(delta => !delta.isNoise)
      .slice(-3)
      .map(stableDeltaSlice),
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 16);
}

export function normalizeLoopText(value: string | undefined): string {
  if (value === undefined) return '(missing)';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || '(empty)';
}

function stableNodeSlice(node: FilteredNode): [string, string, string, string] {
  return [
    node.type,
    normalizeNodeValue(node.value),
    node.sel,
    node.tag,
  ];
}

function stableDeltaSlice(delta: MutationDelta): [string, string, string, string] {
  return [
    delta.mutationType,
    delta.nodeSelector,
    normalizeNodeValue(delta.oldValue),
    normalizeNodeValue(delta.newValue),
  ];
}

function normalizeNodeValue(value: string | undefined): string {
  return normalizeLoopText(value).slice(0, 120);
}
