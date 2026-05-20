import { V2AgentLoop } from './V2AgentLoop';

export interface V2AgentLoopFactoryInput {
  headed: boolean;
  traceDir: string;
  runId?: string;
}

export type V2AgentLoopFactory = (input: V2AgentLoopFactoryInput) => Pick<V2AgentLoop, 'run'>;

export const v2AgentLoopFactory: { create: V2AgentLoopFactory } = {
  create: input => new V2AgentLoop({
    headed: input.headed,
    traceDir: input.traceDir,
    runId: input.runId,
  }),
};

export function createV2AgentLoop(input: V2AgentLoopFactoryInput): Pick<V2AgentLoop, 'run'> {
  return v2AgentLoopFactory.create(input);
}
