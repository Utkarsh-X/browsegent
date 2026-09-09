"""Official WebArena evaluator bridge (benchmark-side).

Invokes the OFFICIAL upstream scoring pipeline — evaluation_harness.evaluator_router
and its evaluators, imported from the cloned web-arena-x/webarena repository — and
prints exactly one machine-readable result line:

    WEBARENA_EVAL_RESULT:{"score": <float>}

Contract with the TS side (OfficialEvaluatorBridge.ts):
    python webarena_official_eval.py --config-file <task_config.json> \
        --artifact <trajectory_artifact.json> --repo-path <path-to-webarena>

Episode inputs are reconstructed to the official evaluator contract:
  - trajectory: [..., StateInfo, Action(stop)] — the string evaluator reads only
    the final Action's `answer`; beartype validates the full Action TypedDict,
    so every field is populated.
  - page: an official PseudoPage wrapping a fresh live page pre-navigated to the
    episode's recorded final URL. WebArena state lives server-side, so URL checks
    (`page.url` is overridden) and program_html checks (goto/content/evaluate on a
    live page) see the same state upstream saw at episode end.
Deviation note: EvaluatorComb.__call__ beartypes `client` as a live CDPSession;
we apply its trivial product loop over router-selected evaluators directly with
client=None (both shipped evaluators type client as `CDPSession | None`).
"""
import argparse
import json
import os
import sys
import traceback

# Official env var names asserted by browser_env.env_config at import time.
SITE_ENV_KEYS = {
    "WEBARENA_SHOPPING": "SHOPPING",
    "WEBARENA_SHOPPING_ADMIN": "SHOPPING_ADMIN",
    "WEBARENA_REDDIT": "REDDIT",
    "WEBARENA_GITLAB": "GITLAB",
    "WEBARENA_MAP": "MAP",
    "WEBARENA_WIKIPEDIA": "WIKIPEDIA",
}


def ensure_site_env() -> None:
    for our_key, official_key in SITE_ENV_KEYS.items():
        value = os.environ.get(our_key, "").strip()
        if not value:
            raise SystemExit(f"missing_site_url:{our_key} (required by upstream browser_env.env_config)")
        os.environ.setdefault(official_key, value)
    os.environ.setdefault("HOMEPAGE", os.environ.get("WEBARENA_HOMEPAGE", "http://homepage"))


def ensure_nltk_punkt() -> None:
    """StringEvaluator.must_include(tokenize=True) needs punkt; download quietly."""
    try:
        import nltk
        for resource in ("punkt", "punkt_tab"):
            try:
                nltk.data.find(f"tokenizers/{resource}")
            except LookupError:
                nltk.download(resource, quiet=True)
    except Exception:
        pass


def build_trajectory(answer: str):
    """Minimal official-contract trajectory tail: one StateInfo + final stop Action.

    Field values mirror browser_env.actions.Action's TypedDict; only `answer`
    carries information the evaluators consume."""
    import numpy as np

    stop_action = {
        "action_type": 4,
        "coords": np.zeros(2, dtype=np.float32),
        "element_role": 0,
        "element_name": "",
        "text": [],
        "page_number": 1,
        "url": "",
        "nth": 0,
        "element_id": "",
        "direction": "",
        "key_comb": "",
        "pw_code": "",
        "answer": answer,
        "raw_prediction": answer,
    }
    return [{"observation": {}, "info": {}}, stop_action]


def main() -> None:
    parser = argparse.ArgumentParser(description="Official WebArena evaluator bridge")
    parser.add_argument("--config-file", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--repo-path", required=True)
    args = parser.parse_args()

    ensure_site_env()

    sys.path.insert(0, args.repo_path)
    from evaluation_harness import evaluator_router  # noqa: E402
    from evaluation_harness.helper_functions import PseudoPage  # noqa: E402

    ensure_nltk_punkt()

    with open(args.artifact, "r", encoding="utf-8") as handle:
        artifact = json.load(handle)
    answer = str(artifact.get("answer") or "")
    final_url = str(artifact.get("finalUrl") or "")

    trajectory = build_trajectory(answer)

    from playwright.sync_api import sync_playwright  # noqa: E402

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        if final_url:
            try:
                # Position the live page at the episode's final URL so `last`
                # program_html targets and __last_url__ funcs see real state.
                page.goto(final_url, wait_until="domcontentloaded", timeout=20000)
            except Exception:
                pass  # unreachable target: string/url checks still evaluate faithfully
        pseudo_page = PseudoPage(page, final_url)

        score = 1.0
        for evaluator in evaluator_router(args.config_file).evaluators:
            score *= float(evaluator(
                trajectory=trajectory,
                config_file=args.config_file,
                page=pseudo_page,
                client=None,
            ))

        browser.close()

    print("WEBARENA_EVAL_RESULT:" + json.dumps({"score": float(score)}))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.stderr.write("official_evaluator_bridge_error\n")
        sys.exit(1)
