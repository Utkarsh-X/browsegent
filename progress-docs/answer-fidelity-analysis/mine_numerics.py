import json, os, re, glob

RUNS = {
    "1787773616455": ["Wolfram__10", "Amazon__10", "Flights__10"],
    "1788073716959": ["Wolfram__10", "Amazon__10"],
    "1788091487187": ["Wolfram__10", "Flights__10"],
    "1788244732279": ["Wolfram__10", "Amazon__10"],
}

def find_trace(run, task_sub):
    pat = f"logs/webvoyager-lite/webvoyager_lite_{run}/traces/*{task_sub}*"
    hits = glob.glob(pat)
    return hits[0] if hits else None

def obs_texts(trace, keyword_pat, max_obs=40):
    hits = []
    for p in sorted(glob.glob(os.path.join(trace, "observations", "obs_*.json"))):
        try:
            obs = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        for ref in obs.get("refs", []):
            t = " ".join(str(x) for x in [ref.get("name"), ref.get("text")] if x)
            if t and re.search(keyword_pat, t, re.I):
                hits.append((os.path.basename(p), ref.get("refId"), t[:200]))
    return hits

for run, tasks in RUNS.items():
    for task in tasks:
        trace = find_trace(run, task)
        if not trace:
            continue
        print(f"\n===== {run} {task} -> {os.path.basename(trace)}")
        if "Wolfram" in task:
            pats = r"declin|total intensity|horizontal|vertical intensity|dip"
            hits = obs_texts(trace, pats)
            for h in hits[:14]:
                print("  ", h[0], h[1], "|", h[2])
            if not hits:
                print("   (no declination text in observations)")
        elif "Amazon" in task:
            pats = r"2-year|2 year|protection|30\.99|Asurion"
            hits = obs_texts(trace, pats)
            for h in hits[:10]:
                print("  ", h[0], h[1], "|", h[2])
        elif "Flights" in task:
            pats = r"₹|INR|125,181|109,948|21,165"
            hits = obs_texts(trace, pats)
            for h in hits[:14]:
                print("  ", h[0], h[1], "|", h[2])
