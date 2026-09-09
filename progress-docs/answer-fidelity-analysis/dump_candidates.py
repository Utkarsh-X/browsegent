import json, os, csv

with open("progress-docs/answer-fidelity-analysis/all_runs_join.csv", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))

def is_pass(v): return v.strip().lower() == "true"
def strict1(v):
    try: return float(v) == 1.0
    except: return False

out = [r for r in rows if is_pass(r["internalPass"]) and not strict1(r["strictScore"])]
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
with open("progress-docs/answer-fidelity-analysis/internal_pass_strict0.md", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("internal_pass_strict0 rows:", len(out), "unique tasks:", len(by_task))
