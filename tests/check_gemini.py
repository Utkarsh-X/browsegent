"""Quick diagnostic: test Gemini API key + model name from .env"""
import json, urllib.request, urllib.error, os

# ── Read .env manually ──────────────────────────────────────────────────────
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
env = {}
with open(env_path, 'r') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

API_KEY = env.get('GEMINI_API_KEY', '')
MODEL   = env.get('BROWSEGENT_GEMINI_MODEL', '')

print(f"API Key : {'✅ found ...' + API_KEY[-6:] if API_KEY else '❌ MISSING'}")
print(f"Model   : {MODEL!r}")
print()

BASE = "https://generativelanguage.googleapis.com/v1beta"

# ── 1. List models ──────────────────────────────────────────────────────────
print("📋 Fetching available models...")
try:
    req = urllib.request.Request(f"{BASE}/models?key={API_KEY}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    gen_models = [m for m in data.get("models", [])
                  if "generateContent" in m.get("supportedGenerationMethods", [])]
    print(f"   {len(gen_models)} models support generateContent:\n")
    for m in gen_models:
        short = m["name"].replace("models/", "")
        print(f"   - {short}  ({m.get('displayName','')})")
except Exception as e:
    print(f"   ❌ {e}")

print()

# ── 2. Test the exact model from .env ────────────────────────────────────────
print(f"🧪 Testing generateContent with model {MODEL!r}...")
url = f"{BASE}/models/{MODEL}:generateContent?key={API_KEY}"
body = json.dumps({"contents": [{"parts": [{"text": "Say hello in one word"}]}]}).encode()
try:
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    print(f"   ✅ SUCCESS — response: {text!r}")
except urllib.error.HTTPError as e:
    err_body = e.read().decode()
    print(f"   ❌ HTTP {e.code}: {err_body[:300]}")
except Exception as e:
    print(f"   ❌ {e}")

print()

# ── 3. Test a known-good model for comparison ────────────────────────────────
GOOD_MODEL = "google/gemma-4-31b-it"
print(f"🧪 Testing known-good model {GOOD_MODEL!r}...")
url2 = f"{BASE}/models/{GOOD_MODEL}:generateContent?key={API_KEY}"
try:
    req = urllib.request.Request(url2, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    print(f"   ✅ SUCCESS — response: {text!r}")
except urllib.error.HTTPError as e:
    err_body = e.read().decode()
    print(f"   ❌ HTTP {e.code}: {err_body[:300]}")
except Exception as e:
    print(f"   ❌ {e}")
