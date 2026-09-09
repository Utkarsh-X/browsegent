import { ContinuityInterpreter } from '../brain2/ContinuityInterpreter';
import type { BrowserObservation, TransitionEvidence } from './types';

export class TransitionService {
  private readonly continuity = new ContinuityInterpreter();

  compare(before: BrowserObservation, after: BrowserObservation): TransitionEvidence {
    return this.continuity.interpret(before, after);
  }
}
