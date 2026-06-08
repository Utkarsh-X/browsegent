import type { BrowserObservation, V2Ref } from './types';

export interface RefResolutionCandidate extends V2Ref {
  score: number;
}

export interface RefResolutionAuditSummary {
  reason:
    | 'target_ref_not_in_observation'
    | 'target_ref_weakened'
    | 'ambiguous_same_role_name'
    | 'target_blocked'
    | 'runtime_resolution_failure'
    | 'resolver_tied_candidates'
    | 'resolver_overflow_weak_selectors'
    | 'resolver_no_verified_candidates'
    | 'execution_timeout';
  candidateCount: number;
  sameRoleNameCandidates: number;
  visibleReadyCandidates: number;
}

export interface RefResolutionAudit {
  version: 'ref_resolution_audit.v1';
  auditId: string;
  observationId: string;
  generationId: number;
  url: string;
  actionKind: string;
  targetRef: string;
  failureCode?: string;
  diagnostics?: Record<string, unknown>;
  summary: RefResolutionAuditSummary;
  target?: V2Ref;
  candidates: RefResolutionCandidate[];
  selfHeal?: {
    attempted: boolean;
    result: 'not_attempted' | 'succeeded' | 'failed';
    reason: string;
  };
}

export interface BuildRefResolutionAuditInput {
  observation: BrowserObservation;
  targetRef: string;
  actionKind: string;
  failureCode?: string;
  diagnostics?: Record<string, unknown>;
  selfHeal?: {
    attempted: boolean;
    result: 'not_attempted' | 'succeeded' | 'failed';
    reason: string;
  };
}

export function buildRefResolutionAudit(input: BuildRefResolutionAuditInput): RefResolutionAudit {
  const { observation, targetRef, actionKind } = input;
  const target = observation.refs.find(ref => ref.refId === targetRef);

  let candidates: RefResolutionCandidate[] = [];

  if (target) {
    // Candidate refs match the target by role, name, text, targetId, or nthRoleName
    const matchedRefs = observation.refs.filter(ref => {
      const matchTargetId = target.targetId !== undefined && ref.targetId === target.targetId;
      const matchRole = target.role !== undefined && ref.role === target.role;
      const matchName = target.name !== undefined && ref.name === target.name;
      const matchText = target.text !== undefined && ref.text === target.text;
      const matchNthRoleName = target.nthRoleName !== undefined && ref.nthRoleName === target.nthRoleName;

      return matchTargetId
        || matchName
        || matchText
        || (matchRole && matchNthRoleName);
    });

    candidates = matchedRefs.map(ref => {
      let score = 0;
      if (target.targetId !== undefined && ref.targetId === target.targetId) score += 40;
      if (target.role !== undefined && ref.role === target.role) score += 20;
      if (target.name !== undefined && ref.name === target.name) score += 20;
      if (target.text !== undefined && ref.text === target.text) score += 10;
      if (target.nthRoleName !== undefined && ref.nthRoleName === target.nthRoleName) score += 10;
      if (ref.visibility === 'visible') score += 5;
      if (ref.actionability === 'ready') score += 5;

      return {
        ...ref,
        score,
      };
    });

    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.refId.localeCompare(b.refId);
    });
  }

  // Reason logic:
  let reason: RefResolutionAuditSummary['reason'];
  if (!target) {
    reason = 'target_ref_not_in_observation';
  } else if (target.state === 'weakened') {
    reason = 'target_ref_weakened';
  } else if (input.diagnostics?.reason === 'tied_candidates') {
    reason = 'resolver_tied_candidates';
  } else if (input.diagnostics?.reason === 'overflow_weak_selectors') {
    reason = 'resolver_overflow_weak_selectors';
  } else if (input.diagnostics?.reason === 'no_verified_candidates') {
    reason = 'resolver_no_verified_candidates';
  } else if (input.failureCode === 'timeout') {
    reason = 'execution_timeout';
  } else {
    const sameRoleNameCount = candidates.filter(c =>
      target.role !== undefined &&
      target.name !== undefined &&
      c.role === target.role &&
      c.name === target.name
    ).length;

    if (sameRoleNameCount >= 2) {
      reason = 'ambiguous_same_role_name';
    } else if (target.actionability === 'blocked') {
      reason = 'target_blocked';
    } else {
      reason = 'runtime_resolution_failure';
    }
  }

  const candidateCount = typeof input.diagnostics?.candidateCount === 'number'
    ? input.diagnostics.candidateCount
    : candidates.length;
  const sameRoleNameCandidatesCount = target
    ? candidates.filter(c =>
        target.role !== undefined &&
        target.name !== undefined &&
        c.role === target.role &&
        c.name === target.name
      ).length
    : 0;
  const visibleReadyCandidatesCount = candidates.filter(c =>
    c.visibility === 'visible' && c.actionability === 'ready'
  ).length;

  const slicedCandidates = candidates.slice(0, 10);

  const auditId = `${observation.observationId}-${targetRef}-${actionKind}-audit`;

  return {
    version: 'ref_resolution_audit.v1',
    auditId,
    observationId: observation.observationId,
    generationId: observation.generationId,
    url: observation.url,
    actionKind,
    targetRef,
    failureCode: input.failureCode,
    diagnostics: input.diagnostics,
    summary: {
      reason,
      candidateCount,
      sameRoleNameCandidates: sameRoleNameCandidatesCount,
      visibleReadyCandidates: visibleReadyCandidatesCount,
    },
    target,
    candidates: slicedCandidates,
    selfHeal: input.selfHeal,
  };
}
