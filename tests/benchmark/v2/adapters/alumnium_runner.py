import argparse
import json
import os
import time
import traceback
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def classify_failure(message: str) -> str:
    lowered = message.lower()
    if "rate" in lowered or "quota" in lowered or "429" in lowered or "resource_exhausted" in lowered:
        return "rate_limited"
    if "captcha" in lowered or "verification required" in lowered or "access denied" in lowered or "challenge" in lowered:
        return "environment_block"
    if "planner" in lowered or "schema" in lowered or "invalid" in lowered:
        return "planning_error"
    return "runtime_crash"


def normalize_gemini_model_name(model: Any) -> str:
    value = str(model or os.environ.get("BROWSEGENT_GEMINI_MODEL") or os.environ.get("GEMINI_MODEL") or "gemini-3.1-flash-lite")
    return value.removeprefix("gemini/")


def resolve_google_api_key() -> str:
    """Map GEMINI_API_KEY → GOOGLE_API_KEY if needed."""
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
    if not key:
        raise RuntimeError("Neither GOOGLE_API_KEY nor GEMINI_API_KEY is set in environment")
    return key


def run_alumnium(input_path: Path, output_path: Path) -> int:
    payload = load_json(input_path)
    t0 = time.time()
    try:
        from alumnium import Alumni
        import alumnium.clients.http_client as hc
        from playwright.sync_api import sync_playwright

        # Increase default 120s timeout for heavy reasoning models
        import requests
        _orig_req_post = requests.post
        _orig_req_get = requests.get

        def _patched_post(*args, **kwargs):
            if "timeout" in kwargs and (kwargs["timeout"] is None or kwargs["timeout"] < 300):
                kwargs["timeout"] = 300
            elif "timeout" not in kwargs:
                kwargs["timeout"] = 300
            return _orig_req_post(*args, **kwargs)

        def _patched_get(*args, **kwargs):
            if "timeout" in kwargs and (kwargs["timeout"] is None or kwargs["timeout"] < 300):
                kwargs["timeout"] = 300
            elif "timeout" not in kwargs:
                kwargs["timeout"] = 300
            return _orig_req_get(*args, **kwargs)

        requests.post = _patched_post
        requests.get = _patched_get
        hc.post = _patched_post
        hc.get = _patched_get

        model_raw = str(payload.get("model") or "").strip()
        openrouter_key = os.environ.get("OPENROUTER_API_KEY")

        if model_raw.startswith("openrouter/") or model_raw.startswith("stealth/") or (openrouter_key and not model_raw.startswith("gemini/")):
            clean_model = model_raw.removeprefix("openrouter/")
            os.environ["ALUMNIUM_MODEL"] = f"openai/{clean_model}"
            os.environ["OPENAI_API_KEY"] = openrouter_key or os.environ.get("OPENAI_API_KEY", "")
            os.environ["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1"
            os.environ["OPENAI_API_BASE"] = "https://openrouter.ai/api/v1"
        else:
            model_name = normalize_gemini_model_name(model_raw)
            os.environ["ALUMNIUM_MODEL"] = f"google/{model_name}"
            os.environ["GOOGLE_API_KEY"] = resolve_google_api_key()

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not bool(payload.get("headed")))
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            page = context.new_page()

            # Navigate to the task's starting URL with robust domcontentloaded wait
            page.goto(payload["url"], wait_until="domcontentloaded", timeout=60000)

            # Initialize Alumnium — single arg, the Playwright page
            al = Alumni(page)

            try:
                # Step 1: Execute task actions autonomously
                do_result = al.do(payload["goal"])

                # Step 2: Extract final answer from the page state using AI
                answer = al.get(payload["goal"])

                # Step 3: Defensive telemetry extraction
                input_tokens = 0
                output_tokens = 0
                step_count = 1  # At minimum: 1 do + 1 get
                try:
                    stats = al.client.stats
                    input_tokens = stats.get("total", {}).get("input_tokens", 0)
                    output_tokens = stats.get("total", {}).get("output_tokens", 0)
                except Exception:
                    pass

                try:
                    step_count = len(do_result.steps) + 1  # Action steps + extraction step
                except Exception:
                    step_count = 2  # Fallback: 1 do + 1 get

                write_json(output_path, {
                    "success": bool(str(answer).strip()),
                    "value": str(answer),
                    "metrics": {
                        "plannerCalls": step_count,
                        "toolExecutions": step_count,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "durationMs": int((time.time() - t0) * 1000),
                    },
                })
                return 0

            finally:
                al.quit()
                browser.close()

    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        write_json(output_path, {
            "success": False,
            "value": "",
            "failureReason": message,
            "failureType": classify_failure(message),
            "traceback": traceback.format_exc(),
            "metrics": {
                "plannerCalls": 0,
                "toolExecutions": 0,
                "durationMs": int((time.time() - t0) * 1000),
            },
        })
        return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    return run_alumnium(Path(args.input), Path(args.output))


if __name__ == "__main__":
    raise SystemExit(main())
