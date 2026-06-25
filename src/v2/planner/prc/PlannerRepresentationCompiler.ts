import type { PlannerInput } from '../types';
import type { PlannerRepresentationIR } from './types';

export class PlannerRepresentationCompiler {
  compile(input: PlannerInput): PlannerRepresentationIR {
    return {
      execution: {
        goal: input.goal,
        failures: [],
        uncertainty: { level: 'none', signals: [] },
      },
      surface: {
        groups: [],
        remainder: [],
        inputRefCount: 0,
        surfaceRefCount: 0,
      },
      stats: {
        inputRefCount: 0,
        surfaceRefCount: 0,
        omittedRegionMembers: 0,
        failureAnnotations: 0,
        anomalyCount: 0,
      },
    };
  }
}
