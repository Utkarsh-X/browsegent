import type { OperationalProjection, ProjectionItem } from '../brain1/projectionTypes';
import type { V2ToolResult } from '../runtime/types';
import type { TraceManifest, TraceJsonValue, TraceStep } from '../trace/types';
import type {
  PlannerTaskProgress,
  PlannerTaskProgressItem,
  PlannerTaskProgressItemStatus,
} from '../planner/types';

const MAX_ITEMS = 8;
const MAX_TEXT_LENGTH = 120;
const MONTHS = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const DATE_RANGE_PATTERN = new RegExp(
  `\\b${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*[-–]\\s*(?:${MONTHS}\\s+)?\\d{1,2}(?:st|nd|rd|th)?[,]?\\s+\\d{4}\\b`,
  'i',
);
const ISO_DATE_RANGE_PATTERN = /\b\d{4}-\d{2}-\d{2}\s*(?:to|[-–])\s*\d{4}-\d{2}-\d{2}\b/i;
const DESTINATION_PATTERN = /\b(?:in|near|to)\s+([A-Z][\w.'&-]*(?:\s+(?:[A-Z][\w.'&-]*|of|the|de|la)){0,5})/u;
const TRAVELER_PATTERN = /\b\d+\s+(?:adults?|children?|rooms?|guests?)\b/gi;

const FILTER_PATTERNS: Array<{ key: string; pattern: RegExp; requested: string }> = [
  { key: 'filter:free_cancellation', pattern: /\bfree\s+cancellation\b/i, requested: 'free cancellation' },
  { key: 'filter:free_wifi', pattern: /\bfree\s+wi(?:-|\s)?fi\b/i, requested: 'free Wi-Fi' },
  { key: 'filter:breakfast', pattern: /\bbreakfast\s+included\b/i, requested: 'breakfast included' },
  { key: 'filter:parking', pattern: /\b(?:free\s+)?parking\b/i, requested: 'parking' },
  { key: 'filter:fitness_center', pattern: /\bfitness\s+center\b/i, requested: 'fitness center' },
  { key: 'filter:swimming_pool', pattern: /\bswimming\s+pool\b/i, requested: 'swimming pool' },
  { key: 'filter:airport_shuttle', pattern: /\bairport\s+shuttle\b/i, requested: 'airport shuttle' },
  { key: 'filter:pet_friendly', pattern: /\bpet[- ]friendly\b/i, requested: 'pet-friendly' },
];

interface TaskProgressInput {
  goal: string;
  projection: OperationalProjection;
  lastResult?: V2ToolResult;
  trace?: TraceManifest | TraceStep[];
}

interface RequestedConstraint {
  key: string;
  requested: string;
  kind: 'destination' | 'date_range' | 'traveler_count' | 'filter';
}

interface SuccessfulIntent {
  text: string;
  evidence: string;
}

export function buildTaskProgress(input: TaskProgressInput): PlannerTaskProgress {
  const constraints = extractConstraints(input.goal).slice(0, MAX_ITEMS);
  if (constraints.length === 0) {
    return { status: 'unknown', items: [] };
  }

  const interactions = input.projection.interactions ?? [];
  const traceSteps = Array.isArray(input.trace) ? input.trace : input.trace?.steps ?? [];
  const successfulIntents = collectSuccessfulIntents(traceSteps, input.lastResult);
  const items = constraints.map(constraint => evaluateConstraint(constraint, interactions, successfulIntents));
  const hasConflict = items.some(item => item.status === 'conflicting');
  const allApplied = items.every(item => item.status === 'applied');

  return {
    status: hasConflict ? 'conflicting' : allApplied ? 'ready' : 'incomplete',
    items,
  };
}

function extractConstraints(goal: string): RequestedConstraint[] {
  const constraints: RequestedConstraint[] = [];
  const destination = goal.match(DESTINATION_PATTERN)?.[1];
  if (destination) {
    constraints.push({ key: 'destination', requested: clip(destination), kind: 'destination' });
  }

  const dateRange = goal.match(DATE_RANGE_PATTERN)?.[0] ?? goal.match(ISO_DATE_RANGE_PATTERN)?.[0];
  if (dateRange) {
    constraints.push({ key: 'date_range', requested: clip(dateRange), kind: 'date_range' });
  }

  for (const traveler of goal.matchAll(TRAVELER_PATTERN)) {
    constraints.push({ key: 'traveler_count', requested: clip(traveler[0]), kind: 'traveler_count' });
  }

  for (const filter of FILTER_PATTERNS) {
    if (filter.pattern.test(goal)) {
      constraints.push({ key: filter.key, requested: filter.requested, kind: 'filter' });
    }
  }

  return deduplicateConstraints(constraints);
}

function evaluateConstraint(
  constraint: RequestedConstraint,
  interactions: ProjectionItem[],
  successfulIntents: SuccessfulIntent[],
): PlannerTaskProgressItem {
  const evidence: string[] = [];
  let bestStatus: PlannerTaskProgressItemStatus = 'pending';
  let conflict = false;

  for (const interaction of interactions) {
    if (!isCandidateForConstraint(constraint, interaction)) continue;
    const visibleText = searchableText(interaction);
    const valueText = normalize(interaction.value ?? '');
    const requestedText = normalize(constraint.requested);

    if (matchesConstraint(constraint, valueText || visibleText, requestedText)) {
      evidence.push(interaction.refId);
      bestStatus = valueText && matchesConstraint(constraint, valueText, requestedText) ? 'applied' : 'observed';
      continue;
    }

    if (valueText && isFieldControl(constraint, interaction)) {
      conflict = true;
      evidence.push(interaction.refId);
    }
  }

  if (conflict) {
    bestStatus = 'conflicting';
  } else {
    const matchingIntent = successfulIntents.find(intent =>
      matchesConstraint(constraint, intent.text, normalize(constraint.requested)),
    );
    if (matchingIntent) {
      bestStatus = 'applied';
      evidence.push(matchingIntent.evidence);
    }
  }

  return {
    key: constraint.key,
    requested: constraint.requested,
    status: bestStatus,
    ...(evidence.length > 0 ? { evidence: [...new Set(evidence)].slice(0, 2) } : {}),
  };
}

function isCandidateForConstraint(constraint: RequestedConstraint, interaction: ProjectionItem): boolean {
  const label = normalize([interaction.name, interaction.text, interaction.placeholder].filter(Boolean).join(' '));
  if (constraint.kind === 'destination') {
    const hasDestinationLabel = /\b(?:destination|location|where|city|place)\b/i.test(label);
    const hasNonDestinationLabel = /\b(?:date|checkin|checkout|check in|check out|stay|adult|child|guest|room|traveler|traveller)\b/i.test(label);
    return hasDestinationLabel
      || (['combobox', 'searchbox'].includes(normalize(interaction.role)) && !hasNonDestinationLabel)
      || (['input', 'editable'].includes(interaction.kind)
        && !hasNonDestinationLabel);
  }
  if (constraint.kind === 'date_range') {
    return /\b(?:date|checkin|checkout|check in|check out|stay)\b/i.test(label)
      || DATE_RANGE_PATTERN.test(label)
      || ISO_DATE_RANGE_PATTERN.test(label);
  }
  if (constraint.kind === 'traveler_count') {
    return /\b(?:adult|child|guest|room|traveler|traveller)s?\b/i.test(label);
  }
  return constraint.kind === 'filter'
    && (interaction.capabilities?.clickable === true || interaction.kind === 'button' || interaction.kind === 'select')
    && normalize(label).replace(/-/g, ' ').includes(normalize(constraint.requested).replace(/-/g, ' '));
}

function isFieldControl(constraint: RequestedConstraint, interaction: ProjectionItem): boolean {
  if (constraint.kind === 'filter') return false;
  const label = normalize([interaction.name, interaction.text, interaction.placeholder].filter(Boolean).join(' '));
  if (constraint.kind === 'destination') {
    const hasDestinationLabel = /\b(?:destination|location|where|city|place)\b/i.test(label);
    const hasNonDestinationLabel = /\b(?:date|checkin|checkout|check in|check out|stay|adult|child|guest|room|traveler|traveller)\b/i.test(label);
    return hasDestinationLabel
      || (['combobox', 'searchbox'].includes(normalize(interaction.role)) && !hasNonDestinationLabel);
  }
  return interaction.kind === 'input' || interaction.kind === 'editable' || interaction.role === 'combobox';
}

function matchesConstraint(constraint: RequestedConstraint, candidate: string, requested: string): boolean {
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return false;
  if (constraint.kind === 'date_range') {
    const requestedNumbers = requested.match(/\d+/g) ?? [];
    return requestedNumbers.length > 0 && requestedNumbers.every(number => normalizedCandidate.includes(number));
  }
  if (constraint.kind === 'traveler_count') {
    const requestedNumber = requested.match(/\d+/)?.[0];
    const requestedUnit = requested.match(/[a-z]+$/)?.[0];
    return Boolean(requestedNumber && requestedUnit
      && normalizedCandidate.includes(`${requestedNumber} ${requestedUnit}`));
  }
  return normalizedCandidate.includes(requested) || requested.includes(normalizedCandidate);
}

function collectSuccessfulIntents(trace: TraceStep[], lastResult?: V2ToolResult): SuccessfulIntent[] {
  const intents = trace
    .filter(step => isSuccessfulTraceStep(step) && (step.kind === 'type' || step.kind === 'select'))
    .map(step => {
      const text = traceInputText(step.input);
      return text ? { text, evidence: step.stepId } : undefined;
    })
    .filter((value): value is SuccessfulIntent => Boolean(value));
  if (lastResult?.success && (lastResult.kind === 'type' || lastResult.kind === 'select')) {
    const resultText = resultInputText(lastResult.value);
    if (resultText) intents.push({ text: resultText, evidence: lastResult.traceStepId });
  }
  return intents.map(intent => ({ ...intent, text: clip(intent.text) }));
}

function isSuccessfulTraceStep(step: TraceStep): boolean {
  const result = asRecord(step.result);
  return step.status === 'completed' && result?.success === true;
}

function traceInputText(input: TraceJsonValue | undefined): string | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  return [record.text, record.value, record.option]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function resultInputText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return [record.inputValue, record.value, record.text]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ');
}

function searchableText(item: ProjectionItem): string {
  return [item.name, item.text, item.placeholder].filter(Boolean).join(' ');
}

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function clip(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function deduplicateConstraints(constraints: RequestedConstraint[]): RequestedConstraint[] {
  const seen = new Set<string>();
  return constraints.filter(constraint => {
    if (seen.has(constraint.key)) return false;
    seen.add(constraint.key);
    return true;
  });
}

function asRecord(value: TraceJsonValue | undefined): Record<string, TraceJsonValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value;
}
