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
 * deduplicate goal tokens; match on word boundaries only; count the longest
 * non-overlapping phrase match (greedy, longest-first). Returns facts, not a decision.
 *
 * No site, benchmark, URL, selector, or answer-specific tables.
 */
export function scoreGoalRelevance(
  goal: string,
  item: Pick<ProjectionItem, 'name' | 'text' | 'role' | 'kind'>,
): GoalRelevance {
  const goalToks = deduplicateTokens(normalizeTokens(goal));
  if (goalToks.length === 0) return { tokenMatches: 0, phraseMatches: 0, score: 0 };

  const haystackWords = normalizeTokens(buildHaystack(item));
  if (haystackWords.length === 0) return { tokenMatches: 0, phraseMatches: 0, score: 0 };

  const haystackWordSet = new Set(haystackWords);

  // Count distinct token matches using exact word matching (not substring)
  let tokenMatches = 0;
  for (const token of goalToks) {
    if (haystackWordSet.has(token)) tokenMatches++;
  }

  // Count non-overlapping phrase matches: greedy longest-first.
  // A phrase is a contiguous sequence of 2+ goal tokens that appears
  // contiguously in the haystack. Once a phrase matches, all token positions
  // it covers are marked and cannot contribute to another phrase match.
  const phraseMatches = countNonOverlappingPhrases(goalToks, haystackWords);

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

function deduplicateTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function buildHaystack(item: Pick<ProjectionItem, 'name' | 'text' | 'role' | 'kind'>): string {
  return [item.name, item.text, item.role, item.kind]
    .filter(Boolean)
    .join(' ');
}

/**
 * Count non-overlapping contiguous phrase matches between goal tokens and
 * haystack words. Uses greedy longest-first: tries the longest n-gram first,
 * marks matched positions in both goal and haystack, then tries shorter n-grams
 * on unmarked positions.
 */
function countNonOverlappingPhrases(goalToks: string[], haystackWords: string[]): number {
  const usedGoalPositions = new Set<number>();
  const usedHaystackPositions = new Set<number>();
  let phraseCount = 0;

  // Try n-grams from longest to shortest (minimum 2)
  for (let len = Math.min(goalToks.length, haystackWords.length); len >= 2; len--) {
    for (let gStart = 0; gStart + len <= goalToks.length; gStart++) {
      // Skip if any goal position in this window is already used
      let goalConflict = false;
      for (let k = gStart; k < gStart + len; k++) {
        if (usedGoalPositions.has(k)) { goalConflict = true; break; }
      }
      if (goalConflict) continue;

      const goalSlice = goalToks.slice(gStart, gStart + len);

      // Search for this n-gram in the haystack
      for (let hStart = 0; hStart + len <= haystackWords.length; hStart++) {
        // Skip if any haystack position is already used
        let haystackConflict = false;
        for (let k = hStart; k < hStart + len; k++) {
          if (usedHaystackPositions.has(k)) { haystackConflict = true; break; }
        }
        if (haystackConflict) continue;

        // Check exact word-by-word match
        let match = true;
        for (let k = 0; k < len; k++) {
          if (goalSlice[k] !== haystackWords[hStart + k]) { match = false; break; }
        }

        if (match) {
          phraseCount++;
          for (let k = gStart; k < gStart + len; k++) usedGoalPositions.add(k);
          for (let k = hStart; k < hStart + len; k++) usedHaystackPositions.add(k);
          break; // This goal n-gram matched; move to next goal window
        }
      }
    }
  }

  return phraseCount;
}
