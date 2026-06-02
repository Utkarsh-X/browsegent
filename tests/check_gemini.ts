import { config } from 'dotenv';
config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY not found');
  process.exit(1);
}
console.log('Gemini key found: [redacted]');

async function listModels() {
  console.log('\nAvailable Gemini models (generateContent):');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
  if (!res.ok) {
    console.error(`${res.status}: ${await res.text()}`);
    return;
  }
  const data = await res.json() as { models?: Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }> };
  const models = (data.models ?? []).filter(m => m.supportedGenerationMethods?.includes('generateContent'));
  for (const m of models) console.log(`  - ${m.name.replace('models/', '')}  (${m.displayName})`);
}

async function testGenerate(model: string) {
  console.log(`\nTesting "${model}"...`);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hello in one word' }] }] }),
  });
  console.log(`  Status: ${res.status}`);
  if (res.ok) {
    const d = await res.json() as any;
    console.log(`  Response: ${d.candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty)'}`);
  } else {
    console.log(`  Error: ${(await res.text()).slice(0, 200)}`);
  }
}

(async () => {
  await listModels();
  await testGenerate('gemini-3.1-flash-lite');
  await testGenerate('gemini-2.0-flash-lite');
})();
