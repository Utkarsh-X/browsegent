import json, os, csv

RUNS = [
    "webvoyager_lite_1787773616455",
    "webvoyager_lite_1788073716959",
    "webvoyager_lite_1788077457042",
    "webvoyager_lite_1788083614237",
    "webvoyager_lite_1788091487187",
    "webvoyager_lite_1788244732279",
    "webvoyager_lite_1788360177393",
]
BASE = "logs/webvoyager-lite"
OUT = "progress-docs/answer-fidelity-analysis"

def load_json(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

rows = []
for run in RUNS:
    rdir = os.path.join(BASE, run)
    report = load_json(os.path.join(rdir, "report.json"))
    evalj = load_json(os.path.join(rdir, "webvoyager_evaluation.json"))
    if not report or not evalj:
        print("MISSING", run); continue
    adapter = report.get("adapterId")
    verdicts = {v["taskId"]: v for v in evalj.get("verdicts", [])}
    # report id derivation: 'BBC News--0' -> 'webvoyager_BBC__News__0'
    tasks = {("webvoyager_" + t["id"].replace("--", "__").replace(" ", "__")): t for t in evalj.get("tasks", [])}
    for res in report.get("results", []):
        raw = res["taskId"]
        v = verdicts.get(raw, {})
        t = tasks.get(raw, {})
        ref = t.get("referenceAnswer") or {}
        row = {
            "run": run,
            "adapter": adapter,
            "taskId": t.get("id", raw),
            "internalPass": res.get("success"),
            "answer": (res.get("value") or "")[:400].replace("\n", " "),
            "failureReason": (res.get("failureReason") or "")[:200],
            "strictScore": v.get("strictScore"),
            "manualCorrected": v.get("manualCorrectedScore"),
            "referenceMatchType": v.get("referenceMatchType"),
            "envStatus": v.get("environmentStatus"),
            "verdictReasons": "|".join(v.get("reasons") or []),
            "partialCredit": v.get("partialCredit"),
            "referenceAnswer": str(ref.get("answer", ""))[:250],
            "refType": ref.get("type", ""),
            "question": (t.get("originalQuestion") or "")[:300].replace("\n"," "),
            "plannerCalls": (res.get("metrics") or {}).get("plannerCalls"),
            "traceDir": (res.get("tracePath") or "").replace("trace.json", ""),
        }
        rows.append(row)

with open(os.path.join(OUT, "all_runs_join.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print("wrote", len(rows), "rows; missing strict:", sum(1 for r in rows if r["strictScore"]==""))

out = [r for r in rows if r["internalPass"] in (True,"true","True") and r["strictScore"] not in ("1","1.0")]
by_task = {}
for r in out:
    by_task.setdefault(r["taskId"], []).append(r)
lines = []
for tid in sorted(by_task):
    r0 = by_task[tid][0]
    lines.append(f"\n## {tid}")
    lines.append(f"Q: {r0['question']}")
    lines.append(f"REF[{r0['refType']}]: {r0['referenceAnswer']}")
    for r in sorted(by_task[tid], key=lambda x: x["run"]):
        lines.append(f"- {r['run'][-14:]}: strict={r['strictScore']} partial={r['partialCredit']} match={r['referenceMatchType']}")
        lines.append(f"  ANSWER: {r['answer']}")
with open(os.path.join(OUT, "internal_pass_strict0.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("internal_pass_strict0 rows:", len(out), "unique tasks:", len(by_task))

out2 = [r for r in rows if "answer_contract" in r["failureReason"] or "repeated_answer_rejection" in r["failureReason"]]
lines2 = []
for r in out2:
    lines2.append(f"\n## {r['run'][-14:]} | {r['taskId']} | strict={r['strictScore']}")
    lines2.append(f"Q: {r['question']}")
    lines2.append(f"REF: {r['referenceAnswer']}")
    lines2.append(f"REASON: {r['failureReason']}")
    lines2.append(f"VALUE: {r['answer']}")
with open(os.path.join(OUT, "gate_rejections.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines2))
print("gate rejections:", len(out2))

out3 = [r for r in rows if "max_steps" in r["failureReason"]]
lines3 = []
for r in out3:
    lines3.append(f"\n## {r['run'][-14:]} | {r['taskId']} | strict={r['strictScore']}")
    lines3.append(f"Q: {r['question']}")
    lines3.append(f"REF: {r['referenceAnswer']}")
    lines3.append(f"VALUE: {r['answer']}")
    lines3.append(f"trace: {r['traceDir']}")
with open(os.path.join(OUT, "max_steps.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines3))
print("max_steps:", len(out3))
