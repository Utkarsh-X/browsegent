import {
  BASIC_INFO_SIGNALS,
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
  refIds?: string[];
  sourceKind?: 'tool_read' | 'surface_observation';
  observationId?: string;
  text: string;
}

const EXPLICIT_CONFLICT = /\b(?:contradict(?:s|ory)?|conflicting|inconsistent|disagrees? with)\b/i;

export function buildTaskEvidenceCoverage(
  goal: string,
  readEvidence: TaskEvidenceRead[],
  surfaceEvidence?: TaskEvidenceRead[],
): PlannerEvidenceCoverage {
  const allEvidence = surfaceEvidence && surfaceEvidence.length > 0
    ? [...readEvidence, ...surfaceEvidence]
    : readEvidence;
  const contract = inferAnswerContract(goal);
  const requirements: PlannerEvidenceCoverageRequirement[] = contract.requiredDetails.map(key =>
    classifyRequirement(key, allEvidence, readEvidence.length),
  );

  if (contract.requiresRankingEvidence) {
    requirements.push(classifyRequirement('ranking_evidence', allEvidence, readEvidence.length));
  }

  const hasConflict = requirements.some(requirement => requirement.status === 'conflicting');
  const hasMissing = requirements.some(requirement => requirement.status === 'missing');
  const hasUncertainty = requirements.some(requirement => requirement.status === 'uncertain');

  return {
    contractKind: contract.kind,
    status: hasConflict || hasMissing ? 'incomplete' : hasUncertainty ? 'uncertain' : 'ready',
    readCount: allEvidence.length,
    requirements,
  };
}

function findSupportingReadIndexes(key: PlannerEvidenceCoverageKey, allEvidence: TaskEvidenceRead[]): number[] {
  if (key === 'concrete_basic_information') {
    const matchedSignalIndexes = new Set<number>();
    const supportingIndexes: number[] = [];

    allEvidence.forEach((read, readIndex) => {
      let matchedAny = false;
      BASIC_INFO_SIGNALS.forEach((signal, signalIndex) => {
        if (signal.test(read.text)) {
          matchedSignalIndexes.add(signalIndex);
          matchedAny = true;
        }
      });
      if (matchedAny) {
        supportingIndexes.push(readIndex);
      }
    });

    if (matchedSignalIndexes.size >= 2) {
      return supportingIndexes;
    }
    return [];
  }

  return allEvidence
    .map((read, index) => matchesRequirement(key, read.text) ? index : -1)
    .filter(index => index >= 0);
}

function classifyRequirement(
  key: PlannerEvidenceCoverageKey,
  allEvidence: TaskEvidenceRead[],
  toolReadCount: number,
): PlannerEvidenceCoverageRequirement {
  const supportingReadIndexes = findSupportingReadIndexes(key, allEvidence);
  const conflictingReadIndexes = allEvidence
    .map((read, index) => EXPLICIT_CONFLICT.test(read.text) && matchesRequirement(key, read.text) ? index : -1)
    .filter(index => index >= 0);

  if (conflictingReadIndexes.length > 0) {
    return {
      key,
      status: 'conflicting',
      supportingReadIndexes: [...new Set([...supportingReadIndexes, ...conflictingReadIndexes])].slice(0, 4),
    };
  }

  if (supportingReadIndexes.length > 0) {
    return {
      key,
      status: 'proven',
      supportingReadIndexes: supportingReadIndexes.slice(0, 4),
    };
  }

  // If no explicit tool reads have been performed and surface facts didn't prove the detail,
  // keep this uncertain so direct observation / computation flows retain their behavior
  // while still signalling to the planner that verification is advisable.
  if (toolReadCount === 0) {
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
    status: 'missing',
    supportingReadIndexes: [],
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
