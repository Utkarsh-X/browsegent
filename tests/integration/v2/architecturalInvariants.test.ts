import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { ObservationService } from '../../../src/v2/substrate/ObservationService';
import { RefService } from '../../../src/v2/runtime/RefService';
import { RefResolver } from '../../../src/v2/substrate/RefResolver';
import { ContinuityInterpreter } from '../../../src/v2/brain2/ContinuityInterpreter';
import { ContinuityGraph } from '../../../src/v2/graph/ContinuityGraph';
import { PlannerWorkingSetSelector } from '../../../src/v2/planner/PlannerWorkingSetSelector';

function fixtureUrl(name: string): string {
  return pathToFileURL(resolve('tests/fixtures/v2', name)).toString();
}

test('Harness Setup: Browser launches and opens fixture', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(fixtureUrl('static-controls.html'));
    const title = await page.title();
    assert.equal(title, 'Static Controls Fixture');
  } finally {
    await browser.close();
  }
});
