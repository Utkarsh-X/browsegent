import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ObservationService } from '../../../src/v2/substrate/ObservationService';
import { RefService } from '../../../src/v2/runtime/RefService';

test('Local Invariant: Coverage, Hidden Filtering, and Shadow roots', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const observer = new ObservationService();
  const refService = new RefService();

  try {
    // 1. Coverage Invariant
    await page.setContent(`
      <html>
        <body>
          <form>
            <input id="txt" type="text" placeholder="Username" />
            <textarea id="ta" aria-label="Comment"></textarea>
            <button id="btn">Submit</button>
            <a id="lnk" href="/docs">Link</a>
            <input id="cb" type="checkbox" />
            <input id="rb" type="radio" />
            <select id="sel"><option>Opt</option></select>
            <input id="cbx" role="combobox" aria-autocomplete="list" />
          </form>
        </body>
      </html>
    `);
    const raw1 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const obs1 = refService.assign(raw1);
    
    const expectedNames = ['Username', 'Comment', 'Submit', 'Link', 'Opt'];
    for (const name of expectedNames) {
      const found = obs1.refs.some(ref => ref.name === name || ref.text === name);
      assert.ok(found, `Expected control "${name}" should be observed`);
    }

    // 2. Hidden Element Invariant
    await page.setContent(`
      <html>
        <body>
          <button id="h1" style="display: none;">Hidden 1</button>
          <button id="h2" style="visibility: hidden;">Hidden 2</button>
          <button id="h3" style="opacity: 0;">Hidden 3</button>
          <button id="h4" aria-hidden="true">Hidden 4</button>
        </body>
      </html>
    `);
    const raw2 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const obs2 = refService.assign(raw2);
    obs2.refs.forEach(ref => {
      if (ref.name && ref.name.startsWith('Hidden')) {
        assert.equal(ref.visibility, 'hidden', 'Hidden controls should have hidden visibility state');
      }
    });

    // 3. Dynamic Paint Invariant
    await page.setContent(`
      <html>
        <body>
          <div id="target"></div>
          <script>
            setTimeout(() => {
              document.getElementById('target').innerHTML = '<button id="late">Late Button</button>';
            }, 100);
          </script>
        </body>
      </html>
    `);
    // Wait for paint to settle
    await page.waitForTimeout(200);
    const raw3 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const obs3 = refService.assign(raw3);
    assert.ok(obs3.refs.some(r => r.name === 'Late Button'), 'Dynamic late-bound elements must be captured');

    // 4. Open Shadow DOM Invariant
    await page.setContent(`
      <html>
        <body>
          <div id="host"></div>
          <script>
            const host = document.getElementById('host');
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = '<button id="sh-btn">Shadow Button</button>';
          </script>
        </body>
      </html>
    `);
    const raw4 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const obs4 = refService.assign(raw4);
    assert.ok(obs4.refs.some(r => r.name === 'Shadow Button'), 'Open Shadow DOM button must be observed');

    // 5. Nested Open Shadow DOM Invariant
    await page.setContent(`
      <html>
        <body>
          <div id="outer-host"></div>
          <script>
            const outer = document.getElementById('outer-host');
            const outerRoot = outer.attachShadow({ mode: 'open' });
            outerRoot.innerHTML = '<div id="inner-host"></div>';
            const inner = outerRoot.getElementById('inner-host');
            const innerRoot = inner.attachShadow({ mode: 'open' });
            innerRoot.innerHTML = '<button id="nested-btn">Nested Button</button>';
          </script>
        </body>
      </html>
    `);
    const raw5 = await observer.capture({ page, sessionId: 's1', generationId: 1 });
    const obs5 = refService.assign(raw5);
    assert.ok(obs5.refs.some(r => r.name === 'Nested Button'), 'Nested Open Shadow DOM button must be observed');

  } finally {
    await browser.close();
  }
});
