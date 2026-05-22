import type { PlannerOutput } from '../../../src/v2';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface AgentSmokeScenario {
  scenarioId: string;
  fixture: string;
  goal: string;
  plannerOutputs: PlannerOutput[];
  expectedSuccess: boolean;
  maxSteps?: number;
}

export const AGENT_SMOKE_SCENARIOS: AgentSmokeScenario[] = [
  {
    scenarioId: 'static-direct-answer',
    fixture: 'static-controls.html',
    goal: 'Report that the static controls page is visible',
    plannerOutputs: [
      { done: true, val: 'Static controls page is visible' },
    ],
    expectedSuccess: true,
    maxSteps: 2,
  },
  {
    scenarioId: 'static-read-submit',
    fixture: 'static-controls.html',
    goal: 'Read the submit control text',
    plannerOutputs: [
      { plan: [{ tool: 'get', ref: 'v2ref_1' }], confidence: 'high' },
      { done: true, val: 'Submit form' },
    ],
    expectedSuccess: true,
    maxSteps: 3,
  },
  {
    scenarioId: 'modal-click',
    fixture: 'modal-transition.html',
    goal: 'Open the modal and report it opened',
    plannerOutputs: [
      { plan: [{ tool: 'click', ref: 'v2ref_1' }], confidence: 'high' },
      { done: true, val: 'Modal opened' },
    ],
    expectedSuccess: true,
    maxSteps: 3,
  },
  {
    scenarioId: 'fixture-navigate',
    fixture: 'static-controls.html',
    goal: 'Navigate to the SPA fixture and report the transition',
    plannerOutputs: [
      {
        plan: [{
          tool: 'navigate',
          url: pathToFileURL(resolve('tests/fixtures/v2/spa-route-transition.html')).toString(),
        }],
        confidence: 'high',
      },
      { done: true, val: 'Navigated to SPA route transition fixture' },
    ],
    expectedSuccess: true,
    maxSteps: 3,
  },
];
