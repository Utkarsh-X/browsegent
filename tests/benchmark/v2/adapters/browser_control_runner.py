from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def extract_json_block(text: str) -> str:
    cleaned = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        return cleaned[first_brace:last_brace + 1].strip()
    return cleaned


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        return s.getsockname()[1]


def find_chrome() -> str:
    candidates = [
        os.environ.get("BROWSER_CONTROL_CHROME", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "google-chrome",
        "chromium",
        "chromium-browser",
    ]
    for c in candidates:
        if c and (os.path.exists(c) or shutil_which(c)):
            return c
    return "chrome"


def shutil_which(cmd: str) -> bool:
    import shutil
    return shutil.which(cmd) is not None


def call_openrouter(
    messages: list[dict[str, str]],
    model: str,
    api_key: str,
) -> tuple[str, int, int, int]:
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://browsegent.ai",
        "X-Title": "BrowseGent Benchmark",
    }
    payload = {
        "model": model.removeprefix("openrouter/"),
        "messages": messages,
        "temperature": 0.1,
    }
    data = json.dumps(payload).encode("utf-8")
    rate_limit_wait_ms = 0
    max_retries = 6
    backoff = [3, 6, 12, 24, 30, 30]

    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=150) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                choice = body["choices"][0]
                content = choice["message"].get("content") or ""
                usage = body.get("usage", {})
                in_tok = int(usage.get("prompt_tokens", 0))
                out_tok = int(usage.get("completion_tokens", 0))
                return content, in_tok, out_tok, rate_limit_wait_ms
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                wait_s = backoff[min(attempt, len(backoff) - 1)]
                print(f"[browser-control] Upstream HTTP {e.code}, backing off {wait_s}s (attempt {attempt + 1}/{max_retries})...", file=sys.stderr)
                time.sleep(wait_s)
                rate_limit_wait_ms += wait_s * 1000
                continue
            err_msg = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"OpenRouter HTTP {e.code}: {err_msg}") from e
        except Exception as e:
            if attempt < max_retries - 1:
                wait_s = backoff[min(attempt, len(backoff) - 1)]
                print(f"[browser-control] Network error ({e}), retrying in {wait_s}s...", file=sys.stderr)
                time.sleep(wait_s)
                rate_limit_wait_ms += wait_s * 1000
                continue
            raise

    raise RuntimeError("Exceeded maximum OpenRouter retries")


def run_bc_cmd(bc_bin: str, args: list[str], env: dict[str, str], timeout: int = 30) -> tuple[int, str, str]:
    cmd = [bc_bin] + args
    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=timeout,
        )
        stdout_str = (res.stdout or "").strip()
        stderr_str = (res.stderr or "").strip()
        return res.returncode, stdout_str, stderr_str
    except subprocess.TimeoutExpired:
        return 124, "", f"Command {' '.join(cmd)} timed out after {timeout}s"
    except Exception as e:
        return 1, "", f"Command {' '.join(cmd)} error: {e}"


def run_browser_control(input_path: Path, output_path: Path) -> int:
    payload = load_json(input_path)
    t0 = time.time()
    bc_bin = os.environ.get("BROWSER_CONTROL_BIN", r"D:\agent-tools\browser-control\target\x86_64-pc-windows-gnu\release\browser-control.exe")
    workspace = os.environ.get("BROWSER_CONTROL_WORKSPACE", str(output_path.parent / ".browser-control"))
    profile_dir = Path(workspace) / "profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    port = find_free_port()
    chrome_bin = find_chrome()

    goal = payload["goal"]
    start_url = payload["url"]
    model = payload.get("model", "stealth/ox-alpha")
    max_steps = int(payload.get("maxSteps") or 8)
    min_interval_ms = int(payload.get("requestMinIntervalMs") or 0)
    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY", "")

    env = os.environ.copy()
    env["BROWSER_CONTROL_CDP_URL"] = f"http://127.0.0.1:{port}"
    env["BROWSER_CONTROL_WORKSPACE"] = workspace

    total_in_tokens = 0
    total_out_tokens = 0
    total_rate_limit_wait_ms = 0
    planner_calls = 0
    tool_executions = 0
    history: list[str] = []
    final_answer = ""
    success = False
    failure_reason = None
    failure_type = None
    chrome_proc = None

    try:
        # Step 0: Launch Chrome directly
        print(f"[browser-control] Launching Chrome on port {port} for {start_url}...", file=sys.stderr)
        chrome_args = [
            chrome_bin,
            "--headless=new" if not payload.get("headed") else "--start-maximized",
            f"--remote-debugging-port={port}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile_dir}",
            start_url,
        ]
        chrome_proc = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        time.sleep(3)

        for step_idx in range(1, max_steps + 1):
            planner_calls += 1
            if min_interval_ms > 0 and step_idx > 1:
                time.sleep(min_interval_ms / 1000.0)

            # Step 1: Capture page snapshot
            code, snapshot, stderr = run_bc_cmd(bc_bin, ["snapshot"], env, timeout=20)
            if not snapshot:
                code, snapshot, stderr = run_bc_cmd(bc_bin, ["inspect"], env, timeout=20)

            # Step 2: Build LLM prompt
            system_prompt = (
                "You are an autonomous web browsing agent using browser-control CLI to accomplish user goals.\n"
                "You receive the current page snapshot with numbered ref handles like @e1, @e2, @e3.\n"
                "Choose exactly one action from the following options:\n"
                '1. Click an element: {"thought": "...", "action": "click", "target": "@e1"}\n'
                '2. Fill text into an input: {"thought": "...", "action": "fill", "target": "@e1", "text": "..."}\n'
                '3. Press a key: {"thought": "...", "action": "press", "key": "Enter"}\n'
                '4. Scroll down/up: {"thought": "...", "action": "scroll", "x": 0, "y": 300}\n'
                '5. Navigate to URL: {"thought": "...", "action": "open", "url": "https://..."}\n'
                '6. Evaluate JavaScript: {"thought": "...", "action": "eval", "expression": "document.title"}\n'
                '7. Task Complete: {"thought": "...", "action": "done", "answer": "<Comprehensive verified answer with exact details, data, numbers, quotes, URLs>"}\n\n'
                "Always output ONLY a valid JSON object matching the chosen action schema."
            )

            history_str = "\n".join(history[-6:]) if history else "None (starting task)"
            user_prompt = (
                f"GOAL: {goal}\n\n"
                f"HISTORY OF PREVIOUS STEPS:\n{history_str}\n\n"
                f"CURRENT PAGE SNAPSHOT (STEP {step_idx}/{max_steps}):\n"
                f"```text\n{snapshot[:12000]}\n```\n\n"
                f"Determine the next action to achieve the goal. Output only JSON."
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            # Step 3: Query model
            content, in_tok, out_tok, rl_wait = call_openrouter(messages, model, api_key)
            total_in_tokens += in_tok
            total_out_tokens += out_tok
            total_rate_limit_wait_ms += rl_wait

            # Step 4: Parse action
            json_text = extract_json_block(content)
            try:
                action_data = json.loads(json_text)
            except Exception as e:
                print(f"[browser-control] Failed to parse JSON at step {step_idx}: {content[:100]}", file=sys.stderr)
                history.append(f"Step {step_idx}: Failed to parse JSON action. Output was: {content[:100]}")
                continue

            action = str(action_data.get("action") or "").lower()
            thought = action_data.get("thought", "")
            print(f"[browser-control] Step {step_idx}: {action} -> {action_data}", file=sys.stderr)

            if action == "done":
                final_answer = str(action_data.get("answer") or action_data.get("value") or "")
                success = bool(final_answer.strip())
                history.append(f"Step {step_idx}: Done. Answer: {final_answer[:100]}")
                break

            tool_executions += 1
            cmd_args: list[str] = []

            if action == "click":
                target = action_data.get("target", "")
                cmd_args = ["click", target]
            elif action == "fill":
                target = action_data.get("target", "")
                text = action_data.get("text", "")
                cmd_args = ["fill", target, text]
            elif action == "press":
                key = action_data.get("key", "Enter")
                cmd_args = ["press", key]
            elif action == "scroll":
                x = str(action_data.get("x", 0))
                y = str(action_data.get("y", 300))
                cmd_args = ["scroll", x, y]
            elif action == "open" or action == "navigate":
                url = action_data.get("url", "")
                cmd_args = ["open", url]
            elif action == "eval":
                expr = action_data.get("expression", "document.title")
                cmd_args = ["eval", expr]
            else:
                print(f"[browser-control] Unknown action: {action}", file=sys.stderr)
                cmd_args = ["snapshot"]

            code, out, err = run_bc_cmd(bc_bin, cmd_args, env, timeout=30)
            outcome_snippet = out[:150] if out else err[:150]
            history.append(f"Step {step_idx}: {action} {cmd_args[1:] if len(cmd_args) > 1 else ''} -> {outcome_snippet}")
            time.sleep(1.5)

        if not success and not final_answer:
            # Step budget exhausted; run one final extraction step
            code, text_out, _ = run_bc_cmd(bc_bin, ["text"], env, timeout=30)
            final_messages = [
                {"role": "system", "content": 'Extract the final answer to the user goal from the current visible webpage text. Output only JSON: {"answer": "..."}'},
                {"role": "user", "content": f"GOAL: {goal}\n\nVISIBLE TEXT:\n{text_out[:8000]}"},
            ]
            content, in_tok, out_tok, rl_wait = call_openrouter(final_messages, model, api_key)
            total_in_tokens += in_tok
            total_out_tokens += out_tok
            total_rate_limit_wait_ms += rl_wait
            try:
                ext_data = json.loads(extract_json_block(content))
                final_answer = ext_data.get("answer", "")
                success = bool(final_answer.strip())
            except Exception:
                final_answer = content
                success = bool(final_answer.strip())

    except Exception as e:
        failure_reason = str(e)
        failure_type = "runtime_crash"
        print(f"[browser-control] Fatal error: {e}", file=sys.stderr)
    finally:
        if chrome_proc:
            try:
                chrome_proc.terminate()
                chrome_proc.wait(timeout=3)
            except Exception:
                try:
                    chrome_proc.kill()
                except Exception:
                    pass

    duration_ms = int((time.time() - t0) * 1000)

    result_payload = {
        "success": success,
        "value": final_answer,
        "failureReason": failure_reason,
        "failureType": failure_type,
        "metrics": {
            "plannerCalls": planner_calls,
            "toolExecutions": tool_executions,
            "rateLimitWaitMs": total_rate_limit_wait_ms,
            "inputTokens": total_in_tokens,
            "outputTokens": total_out_tokens,
            "durationMs": duration_ms,
        },
    }

    write_json(output_path, result_payload)
    return 0 if success else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="browser-control benchmark runner")
    parser.add_argument("--input", required=True, type=Path, help="Path to input.json")
    parser.add_argument("--output", required=True, type=Path, help="Path to result.json")
    args = parser.parse_args()
    return run_browser_control(args.input, args.output)


if __name__ == "__main__":
    sys.exit(main())