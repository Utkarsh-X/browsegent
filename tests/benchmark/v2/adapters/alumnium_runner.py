import argparse
import asyncio
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

async def run_alumnium(input_path: Path, output_path: Path) -> int:
    payload = load_json(input_path)
    try:
        from alumnium import Alumni
        from playwright.async_api import async_playwright

        model_name = normalize_gemini_model_name(payload.get("model"))
        # Force Google Gemini configurations in environment variables
        os.environ["ALUMNIUM_MODEL"] = f"google/{model_name}"

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not bool(payload.get("headed")))
            context = await browser.new_context(viewport={"width": 1280, "height": 900})
            page = await context.new_page()

            # Initialize Alumnium client (Python client starts/resolves backend automatically)
            loop = asyncio.get_running_loop()
            al = Alumni((page, loop))

            # Navigate to the task's starting URL
            await page.goto(payload["url"])

            # 1. Execute task actions autonomously
            do_result = al.do(payload["goal"])

            # 2. Extract final answer from the page state using AI
            answer = al.get(payload["goal"])

            # 3. Extract telemetry from Alumnium stats property
            input_tokens = 0
            output_tokens = 0
            try:
                stats = al.client.stats
                input_tokens = stats.get("total", {}).get("input_tokens", 0)
                output_tokens = stats.get("total", {}).get("output_tokens", 0)
            except Exception:
                pass

            step_count = len(do_result.steps) + 1  # Action steps + extraction step

            write_json(output_path, {
                "success": bool(str(answer).strip()),
                "value": str(answer),
                "metrics": {
                    "plannerCalls": step_count,
                    "toolExecutions": step_count,
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                },
            })
            al.quit()
            await browser.close()
            return 0

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
            },
        })
        return 1

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    return asyncio.run(run_alumnium(Path(args.input), Path(args.output)))

if __name__ == "__main__":
    raise SystemExit(main())
