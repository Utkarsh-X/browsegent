# Alumnium Benchmark Adapter Walkthrough

We have successfully designed, implemented, and verified the **`AlumniumAdapter`** integration within the v2 benchmark harness. This allows us to run direct side-by-side performance, telemetry, and accuracy comparisons against the WebVoyager state-of-the-art framework.

---

## 1. Architecture: Python Runner (`alumnium_runner.py`)
We created [alumnium_runner.py](file:///d:/BrowseGent/tests/benchmark/v2/adapters/alumnium_runner.py) to manage the browser session and communicate with the Alumnium library:
- **Playwright Sync API**: Used to launch Chromium and navigate to the starting page URL. Sync Playwright prevents event-loop nesting conflicts when running alongside Alumnium's async HTTP backend client.
- **Auto-Managed Server**: By initializing `Alumni(page)`, the Python library automatically starts and teardowns the Alumnium TypeScript HTTP server in the background.
- **Defensive Telemetry**: Token usage is fetched from `al.client.stats`. Both token extraction and step count calculations are wrapped in defensive `try/except` blocks to prevent run crashes if Alumnium's internal properties change.
- **API Key Mapping**: Automatically maps `GEMINI_API_KEY` to `GOOGLE_API_KEY` in the subprocess environment, ensuring seamless developer experience.

---

## 2. Integration: Node Adapter & Factory
- **Node Adapter**: We created [AlumniumAdapter.ts](file:///d:/BrowseGent/tests/benchmark/v2/adapters/AlumniumAdapter.ts). It writes the task inputs to `input.json`, launches `alumnium_runner.py`, captures output logs, sanitizes secret API keys in stdout/stderr using `redactSecrets`, and parses the resulting execution telemetry.
- **Factory Registration**: We modified [adapter_factory.ts](file:///d:/BrowseGent/tests/benchmark/v2/adapter_factory.ts) to support the new `'alumnium-local'` adapter ID.

---

## 3. Verification & Testing

### Automated Unit Tests
We created [alumniumAdapter.test.ts](file:///d:/BrowseGent/tests/unit/v2/alumniumAdapter.test.ts) to verify the adapter's behavior:
1.  **Sanitization and Telemetry Mapping**: Verifies that stdout/stderr secrets are correctly redacted, input/output JSON arguments are mapped, and token counts are retrieved.
2.  **Failure Processing**: Validates that non-zero exit codes from the python process are handled gracefully and mapped to `runtime_crash` failure types.

### Test Run Status
- ✅ **Unit Tests**: `npx tsx --test tests/unit/v2/alumniumAdapter.test.ts` passes.
- ✅ **Full Suite**: All 571 tests pass (`npm run test:unit`).
- ✅ **Build Check**: Codebase compiles cleanly with no emit errors (`npm run build`).
- ✅ **Boundary & Cognition Checks**: Passed validation with zero violations (`npm run check:v2`).
