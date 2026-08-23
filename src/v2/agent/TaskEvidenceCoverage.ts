import {
  hasConcreteBasicInformation,
  hasConcretePronunciation,
  hasDefinitionDetail,
  hasRankingEvidence,
  inferAnswerContract,
} from './AnswerContract';
import type {
  PlannerEvidenceCoverage,
  PlannerEvidenceCoverageKey,
  PlannerEvidenceCoverageRequirement,
} from '../planner/types';

export interface TaskEvidenceRead {
  kind: string;
  targetRef?: string;
  text: string;
}

const EXPLICIT_CONFLICT = /\b(?:contradict(?:s|ory)?|conflicting|inconsistent|disagrees? with)\b/i;

export function buildTaskEvidenceCoverage(
  goal: string,
  readEvidence: TaskEvidenceRead[],
): PlannerEvidenceCoverage {
  const contract = inferAnswerContract(goal);
  const requirements: PlannerEvidenceCoverageRequirement[] = contract.requiredDetails.map(key =>
    classifyRequirement(key, readEvidence),
  );

  if (contract.requiresRankingEvidence) {
    requirements.push(classifyRequirement('ranking_evidence', readEvidence));
  }

  const hasConflict = requirements.some(requirement => requirement.status === 'conflicting');
  const hasMissing = requirements.some(requirement => requirement.status === 'missing');
  const hasUncertainty = requirements.some(requirement => requirement.status === 'uncertain');

  return {
    contractKind: contract.kind,
    status: hasConflict || hasMissing ? 'incomplete' : hasUncertainty ? 'uncertain' : 'ready',
    readCount: readEvidence.length,
    requirements,
  };
}

function classifyRequirement(
  key: PlannerEvidenceCoverageKey,
  readEvidence: TaskEvidenceRead[],
): PlannerEvidenceCoverageRequirement {
  const supportingReadIndexes = readEvidence
    .map((read, index) => matchesRequirement(key, read.text) ? index : -1)
    .filter(index => index >= 0);
  const conflictingReadIndexes = readEvidence
    .map((read, index) => EXPLICIT_CONFLICT.test(read.text) && matchesRequirement(key, read.text) ? index : -1)
    .filter(index => index >= 0);

  if (conflictingReadIndexes.length > 0) {
    return {
      key,
      status: 'conflicting',
      supportingReadIndexes: [...new Set([...supportingReadIndexes, ...conflictingReadIndexes])].slice(0, 4),
    };
  }

  // With no explicit reads yet, coverage cannot prove or disprove the fact.
  // Keep this uncertain so computed/direct-answer flows retain their existing
  // behavior while the planner still sees that verification is advisable.
  if (readEvidence.length === 0) {
    return { key, status: 'uncertain', supportingReadIndexes: [] };
  }

  if (key === 'ranking_evidence') {
    return {
      key,
      status: supportingReadIndexes.length > 0 ? 'proven' : 'uncertain',
      supportingReadIndexes: supportingReadIndexes.slice(0, 4),
    };
  }

  return {
    key,
    status: supportingReadIndexes.length > 0 ? 'proven' : 'missing',
    supportingReadIndexes: supportingReadIndexes.slice(0, 4),
  };
}

function matchesRequirement(key: PlannerEvidenceCoverageKey, text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  switch (key) {
    case 'pronunciation':
      return hasConcretePronunciation(normalized);
    case 'definition':
      return hasDefinitionDetail(normalized);
    case 'concrete_basic_information':
      return hasConcreteBasicInformation(normalized);
    case 'ranking_evidence':
      return hasRankingEvidence(normalized);
    default:
      return false;
  }
}
