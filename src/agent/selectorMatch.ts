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
