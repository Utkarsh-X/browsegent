export interface ProjectionSizeDiagnostics {
  currentBytes: number;
  workingSetBytes: number;
  totalPlannerInputBytes: number;
}

export function measureProjectionSize(input: {
  current: unknown;
  workingSet: unknown;
  plannerInput?: unknown;
}): ProjectionSizeDiagnostics {
  const currentBytes = byteLength(input.current);
  const workingSetBytes = byteLength(input.workingSet);
  return {
    currentBytes,
    workingSetBytes,
    totalPlannerInputBytes: input.plannerInput ? byteLength(input.plannerInput) : currentBytes + workingSetBytes,
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}
