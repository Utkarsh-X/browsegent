import type { ProjectionItem } from '../brain1/projectionTypes';

export interface GoalRelevance {
  tokenMatches: number;
  phraseMatches: number;
  score: number;
}

/**
 * Score an item's lexical relevance to a goal string.
 *
 * Normalize case and whitespace; discard tokens shorter than 3 characters;
 * score each distinct goal token once and add a larger fixed bonus for a
 * contiguous multi-token phrase. The function returns facts, not a decision.
 *
 * No site, benchmark, URL, selector, or answer-specific tables.
 */
export function scoreGoalRelevance(
  goal: string,
  item: Pick<ProjectionItem, 'name' | 'text' | 'role' | 'kind'>,
): GoalRelevance {
  const goalToks = normalizeTokens(goal);
  if (goalToks.length === 0) return { tokenMatches: 0, phraseMatches: 0, score: 0 };

  const haystack = buildHaystack(item);
  if (haystack.length === 0) return { tokenMatches: 0, phraseMatches: 0, score: 0 };

  // Count distinct token matches (each goal token counts once)
  let tokenMatches = 0;
  for (const token of goalToks) {
    if (haystack.includes(token)) tokenMatches++;
  }

  // Count contiguous multi-token phrase matches (sliding window of 2+ tokens)
  let phraseMatches = 0;
  for (let len = goalToks.length; len >= 2; len--) {
    for (let start = 0; start + len <= goalToks.length; start++) {
      const phrase = goalToks.slice(start, start + len).join(' ');
      if (haystack.includes(phrase)) {
        phraseMatches++;
      }
    }
  }

  // Score: 1 point per token match + 5 bonus per phrase match
  const TOKEN_WEIGHT = 1;
  const PHRASE_BONUS = 5;
  const score = tokenMatches * TOKEN_WEIGHT + phraseMatches * PHRASE_BONUS;

  return { tokenMatches, phraseMatches, score };
}

/**
 * Compare two items' relevance to a goal.
 * Returns 'left' if left is more relevant, 'right' if right is, 'tie' if equal.
 */
export function compareGoalRelevance(
  goal: string,
  left: Pick<ProjectionItem, 'name' | 'text' | 'role' | 'kind'>,
  right: Pick<ProjectionItem, 'name' | 'text' | 'role' | 'kind'>,
): 'left' | 'right' | 'tie' {
  const leftScore = scoreGoalRelevance(goal, left);
  const rightScore = scoreGoalRelevance(goal, right);
  if (leftScore.score > rightScore.score) return 'left';
  if (rightScore.score > leftScore.score) return 'right';
  return 'tie';
}

const MIN_TOKEN_LENGTH = 3;

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= MIN_TOKEN_LENGTH);
}

function buildHaystack(item: Pick<ProjectionItem, 'name' | 'text' | 'role' | 'kind'>): string {
  return [item.name, item.text, item.role, item.kind]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
