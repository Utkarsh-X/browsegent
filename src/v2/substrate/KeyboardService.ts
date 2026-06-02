import type { Page } from 'playwright';

import type { PlannerPressKey } from '../planner/types';

export interface KeyboardExecutionResult {
  kind: 'press';
  value: { key: PlannerPressKey };
}

export class KeyboardService {
  async press(key: PlannerPressKey, page: Page): Promise<KeyboardExecutionResult> {
    // Press uses the currently focused element; no-progress outcomes are handled via transition evidence.
    await page.keyboard.press(key, { delay: 10 });
    return { kind: 'press', value: { key } };
  }
}
