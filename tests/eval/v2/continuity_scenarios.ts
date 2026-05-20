export type ContinuityScenarioAction =
  | { kind: 'observe' }
  | { kind: 'clickByName'; name: string }
  | { kind: 'typeByName'; name: string; text: string };

export interface ContinuityScenario {
  id: string;
  fixture: string;
  action: ContinuityScenarioAction;
  notes?: string;
}

export const CONTINUITY_SCENARIOS: ContinuityScenario[] = [
  {
    id: 'virtualized_list',
    fixture: 'virtualized-list.html',
    action: { kind: 'clickByName', name: 'Shift window' },
    notes: 'List window changes while stable controls should retain continuity.',
  },
  {
    id: 'random_rerender',
    fixture: 'random-rerender.html',
    action: { kind: 'clickByName', name: 'Rerender panel' },
    notes: 'Local replacement changes targets without requiring broad state reset.',
  },
  {
    id: 'delayed_load',
    fixture: 'delayed-load.html',
    action: { kind: 'clickByName', name: 'Load delayed content' },
    notes: 'Bounded settle should capture late actionable content.',
  },
  {
    id: 'layout_shift',
    fixture: 'layout-shift.html',
    action: { kind: 'clickByName', name: 'Shift layout' },
    notes: 'Geometry movement should remain observable without target aliasing.',
  },
];
