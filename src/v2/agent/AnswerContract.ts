export type AnswerKind = 'number' | 'url' | 'entity' | 'ranked_entity' | 'description' | 'unknown';

export interface AnswerContract {
  kind: AnswerKind;
  requiresNonUrlText: boolean;
  requiresRankingEvidence: boolean;
  reason: string;
}

export interface AnswerValidation {
  ok: boolean;
  reasons: string[];
}

export function inferAnswerContract(goal: string): AnswerContract {
  const normalized = goal.toLowerCase();
  if (/\b(url|link|website)\b/.test(normalized)) {
    return { kind: 'url', requiresNonUrlText: false, requiresRankingEvidence: false, reason: 'goal_requests_url' };
  }
  if (/\b(count|number|how many|calculate|compute|value|answer)\b/.test(normalized)) {
    return { kind: 'number', requiresNonUrlText: false, requiresRankingEvidence: false, reason: 'goal_requests_numeric_or_direct_answer' };
  }
  if (/\b(most|highest|lowest|largest|smallest|top|latest|newest|oldest|best)\b/.test(normalized)) {
    return { kind: 'ranked_entity', requiresNonUrlText: true, requiresRankingEvidence: true, reason: 'goal_requests_ranked_entity' };
  }
  if (/\b(repo|repository|paper|article|title|name|place|location|company|person|product)\b/.test(normalized)) {
    return { kind: 'entity', requiresNonUrlText: true, requiresRankingEvidence: false, reason: 'goal_requests_named_entity' };
  }
  if (/\b(describe|summary|explain|tell me about)\b/.test(normalized)) {
    return { kind: 'description', requiresNonUrlText: true, requiresRankingEvidence: false, reason: 'goal_requests_description' };
  }
  return { kind: 'unknown', requiresNonUrlText: false, requiresRankingEvidence: false, reason: 'goal_shape_unknown' };
}

export function validateAnswerAgainstContract(answer: string, contract: AnswerContract): AnswerValidation {
  const compact = answer.replace(/\s+/g, ' ').trim();
  const reasons: string[] = [];
  if (compact.length === 0) reasons.push('empty_answer');
  if (contract.requiresNonUrlText && isUrlOnly(compact)) reasons.push('url_only_answer_for_named_entity_goal');
  if (contract.kind === 'number' && !/[0-9]/.test(compact)) reasons.push('numeric_goal_without_number');
  // TODO: Validate requiresRankingEvidence when ranking evidence is available in finalization context.
  return { ok: reasons.length === 0, reasons };
}

function isUrlOnly(value: string): boolean {
  const withoutUrls = value.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '').trim();
  return withoutUrls.length === 0 || /^[/:?=&._#%a-z0-9-]+$/i.test(withoutUrls);
}
