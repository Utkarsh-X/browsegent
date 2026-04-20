export function selectorsEquivalent(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return normalizeSelectorForComparison(left) === normalizeSelectorForComparison(right);
}

export function normalizeSelectorForComparison(selector: string): string {
  return selector
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*/g, '[')
    .replace(/\s*\]\s*/g, ']')
    .replace(/\s*=\s*/g, '=')
    .replace(/\[([^\]=]+)='([^']*)'\]/g, '[$1="$2"]')
    .replace(/\\([#.:()[\]="'])/g, '$1');
}

export function selectorFamilyFingerprint(selector: string): string {
  let normalized = normalizeSelectorForComparison(selector).toLowerCase();

  normalized = normalized
    .replace(/:nth-(?:child|of-type)\(\s*\d+\s*\)/g, ':nth(*)')
    .replace(/:eq\(\s*\d+\s*\)/g, ':eq(*)')
    .replace(/:(?:first|last)-(?:child|of-type)\b/g, ':position')
    .replace(/([?&](?:page|pg|start|offset)=)\d+/g, '$1#');

  const positionalShape = normalized.includes('>') || /:nth\(\*\)|:eq\(\*\)|:position/.test(normalized);
  if (positionalShape) {
    normalized = normalized.replace(/\d+/g, '#');
  }

  return normalized;
}
