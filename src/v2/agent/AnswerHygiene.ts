/**
 * Answer-value hygiene: internal substrate identifiers (working-set refs such
 * as 'v2ref_1216') are plumbing, never user-facing content. When a model
 * quotes an element together with its ref token, the leaked token corrupts the
 * answer for any downstream consumer. Both the agent's accepted-answer paths
 * and the benchmark evaluator share this module so the answer a user sees and
 * the answer a scorer reads are the same cleaned text.
 */

const PARENTHESIZED_INTERNAL_REF = /\(\s*v2ref_\d+\s*\)/gi;
const BARE_INTERNAL_REF = /\bv2ref_\d+\b/gi;
const INTERNAL_REF_TOKEN = /\(\s*v2ref_\d+\s*\)|\bv2ref_\d+\b/i;

/** True when the value leaks internal substrate ref identifiers. */
export function hasInternalRefTokens(value: string): boolean {
  return INTERNAL_REF_TOKEN.test(value);
}

/**
 * Removes internal ref identifiers from an answer. Byte-identical for values
 * without a leak, so leak-free behavior never changes.
 */
export function stripInternalRefTokens(value: string): string {
  if (!INTERNAL_REF_TOKEN.test(value)) return value;
  return value
    .replace(PARENTHESIZED_INTERNAL_REF, '')
    .replace(BARE_INTERNAL_REF, '')
    // Tidy artifacts left behind: runs of spaces/tabs, space-before-punctuation,
    // and dangling trailing separators.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?)])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[,\s;]+$/, '')
    .trim();
}
