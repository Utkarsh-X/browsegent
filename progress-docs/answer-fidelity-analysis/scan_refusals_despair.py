import json, os, re, csv

RUNS = [
    "webvoyager_lite_1787773616455",
    "webvoyager_lite_1788073716959",
    "webvoyager_lite_1788077457042",
    "webvoyager_lite_1788083614237",
    "webvoyager_lite_1788091487187",
    "webvoyager_lite_1788244732279",
]
BASE = "logs/webvoyager-lite"

REFUSAL_PATTERNS = [
    (r"does not (?:contain|list|show|display|include)", "does_not_contain"),
    (r"could not be (?:retrieved|found|accessed|determined)", "could_not_be_retrieved"),
    (r"(?:is|are|was|were) not (?:currently )?(?:available|listed|displayed|shown|accessible)", "not_available_listed"),
    (r"not currently (?:listed|displayed|shown|available)", "not_currently"),
    (r"unable to (?:find|retrieve|locate|access|determine|provide)", "unable_to"),
    (r"(?:404|page does not exist|not found error)", "page_missing"),
    (r"security verification|captcha|cloudflare", "captcha_page"),
    (r"please provide|I have not yet|not yet (?:been )?(?:performed|completed|searched|entered|booked)", "precondition_missing"),
    (r"no (?:specific |exact )?(?:answer|results?|information|price|flights?|hotels?|headlines?) (?:is |are |was |were )?(?:available|shown|found|listed|displayed|present)", "no_info_available"),
    (r"(?:no longer|currently) unavailable", "unavailable"),
]

def refusal_kind(text):
    hits = []
    low = text.lower()
    for pat, name in REFUSAL_PATTERNS:
        if re.search(pat, low):
            hits.append(name)
    return hits

rows = []
for run in RUNS:
    report = json.load(open(os.path.join(BASE, run, "report.json"), encoding="utf-8"))
    evalj = json.load(open(os.path.join(BASE, run, "webvoyager_evaluation.json"), encoding="utf-8"))
    tasks = {("webvoyager_" + t["id"].replace("--", "__").replace(" ", "__")): t for t in evalj.get("tasks", [])}
    verdicts = {v["taskId"]: v for v in evalj.get("verdicts", [])}
    for res in report.get("results", []):
        raw = res["taskId"]
        t = tasks.get(raw, {})
        v = verdicts.get(raw, {})
        val = (res.get("value") or "")
        if not res.get("success"):
            continue
        kinds = refusal_kind(val)
        if kinds:
            rows.append({
                "run": run[-14:], "taskId": t.get("id", raw),
                "kinds": "|".join(kinds),
                "strict": v.get("strictScore"),
                "value": val[:220].replace("\n", " "),
            })

print("refusal-shaped internal passes:", len(rows))
for r in rows:
    print(f"  {r['run']} {r['taskId']:24s} strict={r['strict']} kinds={r['kinds']}")
    print(f"    {r['value'][:200]}")

with open(os.path.join("progress-docs/answer-fidelity-analysis", "refusal_passes.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["run","taskId","kinds","strict","value"])
    w.writeheader(); w.writerows(rows)

# escalation scan (non-captcha)
print("\n==== escalations (non-captcha) ====")
for run in RUNS:
    report = json.load(open(os.path.join(BASE, run, "report.json"), encoding="utf-8"))
    for res in report.get("results", []):
        fr = res.get("failureReason") or ""
        if fr.startswith("planner_escalated") and "captcha" not in fr:
            print(f"  {run[-14:]} {res['taskId']:40s} {fr[:130]}")
