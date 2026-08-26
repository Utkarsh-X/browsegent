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


import re

def extract_json_block(text: str) -> str:
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        return text
    # Match markdown code block ```json ... ```
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    # Match outermost JSON object { ... }
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return text[first_brace:last_brace + 1]
    return text


class RateLimitedChat:
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
        
        # Retry loop for upstream rate limits / transient errors
        retries = 5
        for attempt in range(1, retries + 1):
            try:
                result = await self._inner.ainvoke(*args, **kwargs)
                if hasattr(result, "content") and isinstance(result.content, str):
                    result.content = extract_json_block(result.content)
                return result
            except Exception as e:
                err_str = str(e).lower()
                if ("429" in err_str or "rate" in err_str or "temporarily" in err_str or "upstream" in err_str) and attempt < retries:
                    wait = 2 ** attempt
                    await asyncio.sleep(wait)
                    self.rate_limit_wait_ms += wait * 1000
                    continue
                raise


RateLimitedChatGoogle = RateLimitedChat


from browser_use.llm.openai.chat import ChatOpenAI, ChatInvokeCompletion


class OpenRouterChat(ChatOpenAI):
    async def ainvoke(
        self, messages: list[Any], output_format: type[Any] | None = None, **kwargs: Any
    ) -> Any:
        if output_format is not None:
            # Get raw text response
            raw_res = await super().ainvoke(messages, output_format=None, **kwargs)
            raw_text = raw_res.completion if isinstance(raw_res.completion, str) else ""
            json_str = extract_json_block(raw_text)
            try:
                parsed = output_format.model_validate_json(json_str)
                return ChatInvokeCompletion(
                    completion=parsed,
                    usage=raw_res.usage,
                    stop_reason=raw_res.stop_reason,
                )
            except Exception:
                return await super().ainvoke(messages, output_format=output_format, **kwargs)
        return await super().ainvoke(messages, output_format=output_format, **kwargs)


def create_llm(model_raw: Any) -> Any:
    model_str = str(model_raw or "").strip()
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")

    if model_str.startswith("openrouter/") or model_str.startswith("stealth/") or (openrouter_key and not model_str.startswith("gemini/")):
        clean_model = model_str.removeprefix("openrouter/")
        return OpenRouterChat(
            model=clean_model,
            base_url="https://openrouter.ai/api/v1",
            api_key=openrouter_key or os.environ.get("OPENAI_API_KEY"),
            temperature=0.1,
            dont_force_structured_output=True,
            add_schema_to_system_prompt=True,
            default_headers={"HTTP-Referer": "https://browsegent.ai", "X-Title": "BrowseGent Benchmark"},
        )

    if model_str.startswith("openai/") or model_str.startswith("gpt"):
        clean_model = model_str.removeprefix("openai/")
        return ChatOpenAI(model=clean_model)

    from browser_use import ChatGoogle
    return ChatGoogle(model=normalize_gemini_model_name(model_str))


async def run_browser_use(input_path: Path, output_path: Path) -> int:
    payload = load_json(input_path)
    try:
        shared_config_dir = Path.home() / ".browser_use_benchmark_config"
        shared_config_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("BROWSER_USE_CONFIG_DIR", str(shared_config_dir))

        from browser_use import Agent, Browser
        from browser_use.agent.views import AgentSettings

        browser = Browser(
            headless=not bool(payload.get("headed")),
            window_size={"width": 1280, "height": 900},
        )
        try:
            task = f"Open {payload['url']} and complete this task: {payload['goal']}"
            llm = RateLimitedChat(
                create_llm(payload.get("model")),
                payload.get("requestMinIntervalMs"),
            )
            settings = AgentSettings(llm_timeout=150)
            agent = Agent(task=task, llm=llm, browser=browser, settings=settings)
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
        finally:
            await browser.close()
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
