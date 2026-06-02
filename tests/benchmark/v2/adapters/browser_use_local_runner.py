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
    if "captcha" in lowered or "verification required" in lowered or "access denied" in lowered:
        return "environment_block"
    if "planner" in lowered or "schema" in lowered or "invalid" in lowered:
        return "planning_error"
    return "runtime_crash"


def extract_final_result(history: Any) -> str:
    final_result = getattr(history, "final_result", None)
    if callable(final_result):
        value = final_result()
        return "" if value is None else str(value)
    return "" if history is None else str(history)


def count_history_steps(history: Any) -> int:
    candidates = [
        getattr(history, "history", None),
        getattr(history, "all_results", None),
        getattr(history, "model_actions", None),
    ]
    for candidate in candidates:
        if callable(candidate):
            try:
                value = candidate()
            except Exception:
                continue
            if hasattr(value, "__len__"):
                return len(value)
        if hasattr(candidate, "__len__"):
            return len(candidate)
    if hasattr(history, "__len__"):
        try:
            return len(history)
        except Exception:
            return 0
    return 0


def normalize_gemini_model_name(model: Any) -> str:
    value = str(model or os.environ.get("BROWSEGENT_GEMINI_MODEL") or os.environ.get("GEMINI_MODEL") or "gemini-3.1-flash-lite")
    return value.removeprefix("gemini/")


class RateLimitedChatGoogle:
    def __init__(self, inner: Any, min_interval_ms: int | None) -> None:
        self._inner = inner
        self._min_interval_seconds = max(0, int(min_interval_ms or 0)) / 1000
        self._lock = asyncio.Lock()
        self.rate_limit_wait_ms = 0
        self._last_request_started_at: float | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
        async with self._lock:
            now = time.monotonic()
            if self._last_request_started_at is not None:
                elapsed = now - self._last_request_started_at
                wait_seconds = max(0, self._min_interval_seconds - elapsed)
                if wait_seconds > 0:
                    await asyncio.sleep(wait_seconds)
                    self.rate_limit_wait_ms += int(wait_seconds * 1000)
            self._last_request_started_at = time.monotonic()
        return await self._inner.ainvoke(*args, **kwargs)


async def run_browser_use(input_path: Path, output_path: Path) -> int:
    payload = load_json(input_path)
    try:
        os.environ.setdefault("BROWSER_USE_CONFIG_DIR", str(output_path.parent / "browser-use-config"))

        from browser_use import Agent, Browser, ChatGoogle

        browser = Browser(
            headless=not bool(payload.get("headed")),
            window_size={"width": 1280, "height": 900},
        )
        task = f"Open {payload['url']} and complete this task: {payload['goal']}"
        llm = RateLimitedChatGoogle(
            ChatGoogle(model=normalize_gemini_model_name(payload.get("model"))),
            payload.get("requestMinIntervalMs"),
        )
        agent = Agent(task=task, llm=llm, browser=browser)
        history = await agent.run(max_steps=int(payload.get("maxSteps") or 8))
        value = extract_final_result(history)
        step_count = count_history_steps(history)

        # Extract token usage from browser-use's UsageSummary
        input_tokens = 0
        output_tokens = 0
        usage = getattr(history, "usage", None)
        if usage is not None:
            input_tokens = getattr(usage, "total_prompt_tokens", 0) or 0
            output_tokens = getattr(usage, "total_completion_tokens", 0) or 0

        write_json(output_path, {
            "success": bool(value.strip()),
            "value": value,
            "metrics": {
                "plannerCalls": step_count,
                "toolExecutions": step_count,
                "rateLimitWaitMs": llm.rate_limit_wait_ms,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
            },
        })
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
    return asyncio.run(run_browser_use(Path(args.input), Path(args.output)))


if __name__ == "__main__":
    raise SystemExit(main())
