/**
 * crm_demo.mjs
 *
 * Reads REAL BrowseGent planner input traces and demonstrates
 * exactly how much token reduction CRM serialization achieves.
 *
 * Usage:  node scripts/crm_demo.mjs
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { getEncoding } = require("js-tiktoken");

// ─── Token Counter ───────────────────────────────────────────────────────────
const enc = getEncoding("cl100k_base"); // GPT-4 / Gemini-compatible approximation
function countTokens(text) {
  return enc.encode(typeof text === "string" ? text : JSON.stringify(text, null, 2)).length;
}

// ─── CRM Serializer ──────────────────────────────────────────────────────────
// Converts the current JSON planner input into CRM compact text format.
// Rules:
//   - One line per element: [refId] <kind name="..." lane="..."> + only non-default attributes
//   - Defaults omitted: visibility=visible, actionability=ready/actionable, state=live, confidence=1, score=any
//   - Non-defaults flagged inline: [weakened], [disabled], [hidden], etc.
//   - lane= encodes which list it came from (interaction/readable/navigation)
//   - workingSet: only refId + reason codes, not full metadata
function buildCRMFromInput(input) {
  const { current, workingSet, goal, continuity } = input;

  // Build lane map from list membership
  const laneMap = {};
  (current.interactions || []).forEach((el) => { laneMap[el.refId] = "interaction"; });
  (current.readables || []).forEach((el) => { laneMap[el.refId] = "readable"; });
  (current.navigation || []).forEach((el) => { laneMap[el.refId] = "navigation"; });

  // Collect all refs from all lists (deduplicated)
  const allRefs = new Map();
  const allLists = [
    ...(current.interactions || []),
    ...(current.readables || []),
    ...(current.navigation || []),
  ];
  for (const el of allLists) {
    if (!allRefs.has(el.refId)) allRefs.set(el.refId, el);
  }

  // Build CRM lines
  const lines = [];

  // Header: goal + page context (same as JSON — this doesn't change)
  lines.push(`# GOAL: ${goal}`);
  lines.push(`# URL: ${continuity?.url ?? "unknown"} | refs: ${continuity?.presentRefCount ?? "?"}`);
  lines.push("");

  // Focus element (if present)
  if (current.focus?.refId) {
    lines.push(`# focus: ${current.focus.refId} (${current.focus.reason})`);
  }

  // Elements in CRM format
  lines.push("## elements");
  for (const [refId, el] of allRefs) {
    const lane = laneMap[refId] ?? "unknown";
    const modifiers = [];

    // Only flag deviations from happy-path defaults
    if (el.visibility && el.visibility !== "visible") modifiers.push(`[${el.visibility}]`);
    if (el.actionability && el.actionability !== "ready" && el.actionability !== "actionable") {
      modifiers.push(`[${el.actionability}]`);
    }
    if (el.state && el.state !== "live") modifiers.push(`[${el.state}]`);
    if (el.confidence !== undefined && el.confidence < 1) {
      modifiers.push(`[confidence=${el.confidence.toFixed(2)}]`);
    }

    const modStr = modifiers.length > 0 ? " " + modifiers.join(" ") : "";
    const nameAttr = el.name ? ` name="${el.name.replace(/"/g, "'")}"` : "";
    const textAttr =
      el.text && el.text !== el.name ? ` text="${el.text.slice(0, 60).replace(/"/g, "'")}"` : "";

    lines.push(`[${refId}] <${el.kind ?? el.role}${nameAttr}${textAttr} lane="${lane}">${modStr}`);
  }

  // WorkingSet: refId + reasons only (no duplicated metadata)
  if (workingSet) {
    lines.push("");
    lines.push("## workingSet");

    const wsEntries = [
      ...(workingSet.primaryRefs ?? []),
      ...(workingSet.secondaryRefs ?? []),
      ...(workingSet.tertiaryRefs ?? []),
    ];

    for (const entry of wsEntries) {
      const reasons = entry.includeReasons?.join(",") ?? "";
      lines.push(`  ${entry.refId}: [${reasons}]`);
    }

    if (workingSet.omittedRefs?.length) {
      lines.push(`  # omitted: ${workingSet.omittedRefs.length} refs`);
    }
  }

  return lines.join("\n");
}

// ─── Field-Level JSON Breakdown ───────────────────────────────────────────────
function breakdownJSON(input) {
  const fields = {
    goal: input.goal ?? "",
    "continuity/metadata": { continuity: input.continuity, metadata: input.metadata },
    "current.refs (if present)": input.current?.refs ?? {},
    "current.interactions": input.current?.interactions ?? [],
    "current.readables": input.current?.readables ?? [],
    "current.navigation": input.current?.navigation ?? [],
    "current.focus": input.current?.focus ?? {},
    workingSet: input.workingSet ?? {},
    lineage: input.lineage ?? [],
    systemPrompt: input.systemPrompt ?? input.system ?? "",
  };

  const breakdown = {};
  for (const [key, val] of Object.entries(fields)) {
    breakdown[key] = countTokens(val);
  }
  return breakdown;
}

// ─── Main Demo ────────────────────────────────────────────────────────────────
const TRACE_DIRS = [
  // ArXiv - known to be heavy (~197K tokens per task in mvr5)
  "D:/BrowseGent/logs/webvoyager-lite/webvoyager_lite_1779716028748/traces/webvoyager_lite_1779716028748_webvoyager_ArXiv__0_a1/planner",
  // GitHub - another heavy task
  "D:/BrowseGent/logs/webvoyager-lite/webvoyager_lite_1779716028748/traces/webvoyager_lite_1779716028748_webvoyager_GitHub__0_a1/planner",
  // Cambridge Dictionary - lighter task
  "D:/BrowseGent/logs/webvoyager-lite/webvoyager_lite_1779716028748/traces/webvoyager_lite_1779716028748_webvoyager_Cambridge__Dictionary__0_a1/planner",
];

const TASK_NAMES = ["ArXiv__0", "GitHub__0", "Cambridge__Dictionary__0"];

const HR = "═".repeat(90);
const hr = "─".repeat(90);

console.log(`\n${HR}`);
console.log("  BrowseGent: JSON → CRM Token Reduction Demo");
console.log("  Using REAL planner input traces from webvoyager-lite benchmark");
console.log(`${HR}\n`);

const taskSummaries = [];

for (let t = 0; t < TRACE_DIRS.length; t++) {
  const dirPath = TRACE_DIRS[t];
  const taskName = TASK_NAMES[t];

  let files;
  try {
    files = readdirSync(dirPath)
      .filter((f) => f.endsWith("-input.json"))
      .sort();
  } catch {
    console.log(`⚠  Skipping ${taskName} (directory not found)\n`);
    continue;
  }

  console.log(`\n${"▓".repeat(90)}`);
  console.log(`  TASK: ${taskName}  (${files.length} planner calls)`);
  console.log(`${"▓".repeat(90)}\n`);

  let totalJsonTokens = 0;
  let totalCrmTokens = 0;
  const episodeRows = [];

  for (const file of files.slice(0, 5)) { // demo first 5 episodes
    const fullPath = join(dirPath, file);
    const raw = readFileSync(fullPath, "utf-8");
    const input = JSON.parse(raw);

    const jsonTokens = countTokens(raw); // actual file as sent to LLM
    const crmText = buildCRMFromInput(input);
    const crmTokens = countTokens(crmText);
    const reduction = (((jsonTokens - crmTokens) / jsonTokens) * 100).toFixed(1);

    totalJsonTokens += jsonTokens;
    totalCrmTokens += crmTokens;
    episodeRows.push({ file, jsonTokens, crmTokens, reduction });
  }

  // Print episode table
  const ep1Input = JSON.parse(readFileSync(join(dirPath, files[0]), "utf-8"));
  const ep1CRM = buildCRMFromInput(ep1Input);
  const ep1JSON = JSON.stringify(ep1Input, null, 2);
  const breakdown = breakdownJSON(ep1Input);
  const elementTokensJSON =
    (breakdown["current.interactions"] ?? 0) +
    (breakdown["current.readables"] ?? 0) +
    (breakdown["current.navigation"] ?? 0) +
    (breakdown["current.refs (if present)"] ?? 0) +
    (breakdown["workingSet"] ?? 0);

  console.log("  Per-episode comparison (first 5 calls):");
  console.log(`  ${"─".repeat(80)}`);
  console.log(`  ${"Episode".padEnd(36)} ${"JSON Tokens".padStart(12)} ${"CRM Tokens".padStart(12)} ${"Reduction".padStart(10)}`);
  console.log(`  ${"─".repeat(80)}`);
  for (const row of episodeRows) {
    const ep = row.file.replace("-input.json", "");
    console.log(
      `  ${ep.padEnd(36)} ${String(row.jsonTokens).padStart(12)} ${String(row.crmTokens).padStart(12)} ${(row.reduction + "%").padStart(10)}`
    );
  }
  console.log(`  ${"─".repeat(80)}`);

  const overallReduction = (((totalJsonTokens - totalCrmTokens) / totalJsonTokens) * 100).toFixed(1);
  console.log(`  ${"TOTAL (5 episodes)".padEnd(36)} ${String(totalJsonTokens).padStart(12)} ${String(totalCrmTokens).padStart(12)} ${(overallReduction + "%").padStart(10)}`);
  console.log();

  // Field breakdown for episode 1
  console.log(`  JSON field breakdown for episode_1 (showing where tokens go):`);
  console.log(`  ${"─".repeat(60)}`);
  for (const [field, tokens] of Object.entries(breakdown)) {
    const bar = "█".repeat(Math.round((tokens / countTokens(ep1JSON)) * 40));
    console.log(`  ${field.padEnd(32)} ${String(tokens).padStart(7)} tokens  ${bar}`);
  }
  const elementPct = ((elementTokensJSON / countTokens(ep1JSON)) * 100).toFixed(1);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  Element representation total:    ${elementTokensJSON} tokens (${elementPct}% of prompt)`);
  console.log();

  // Print the ACTUAL text comparison for 3 elements
  const ep1Interactions = ep1Input?.current?.interactions ?? [];
  const sampleRefs = ep1Interactions.slice(0, 3);
  if (sampleRefs.length > 0) {
    console.log(`  ┌─ SAMPLE: How 3 elements look in JSON vs CRM ──────────────────────────────┐`);
    console.log();
    console.log("  JSON (current.interactions slice, 3 elements):");
    console.log("  " + JSON.stringify(sampleRefs, null, 2).replace(/\n/g, "\n  "));
    const sampleJsonTokens = countTokens(sampleRefs);
    console.log(`\n  → ${sampleJsonTokens} tokens for 3 elements in JSON`);
    console.log();

    // CRM for the same 3 elements
    const crmLines = sampleRefs.map((el) => {
      const modifiers = [];
      if (el.visibility && el.visibility !== "visible") modifiers.push(`[${el.visibility}]`);
      if (el.actionability && el.actionability !== "ready" && el.actionability !== "actionable") {
        modifiers.push(`[${el.actionability}]`);
      }
      if (el.state && el.state !== "live") modifiers.push(`[${el.state}]`);
      if (el.confidence !== undefined && el.confidence < 1) {
        modifiers.push(`[confidence=${el.confidence.toFixed(2)}]`);
      }
      const modStr = modifiers.length > 0 ? " " + modifiers.join(" ") : "";
      const nameAttr = el.name ? ` name="${el.name.replace(/"/g, "'")}"` : "";
      const textAttr =
        el.text && el.text !== el.name ? ` text="${el.text.slice(0, 60).replace(/"/g, "'")}"` : "";
      return `[${el.refId}] <${el.kind ?? el.role}${nameAttr}${textAttr} lane="interaction">${modStr}`;
    });
    console.log("  CRM (same 3 elements):");
    crmLines.forEach((l) => console.log("  " + l));
    const sampleCrmTokens = countTokens(crmLines.join("\n"));
    console.log(`\n  → ${sampleCrmTokens} tokens for 3 elements in CRM`);
    console.log(`  → ${(((sampleJsonTokens - sampleCrmTokens) / sampleJsonTokens) * 100).toFixed(1)}% reduction for just this slice`);
    console.log(`  └${"─".repeat(77)}┘`);
  }

  taskSummaries.push({ taskName, totalJsonTokens, totalCrmTokens, overallReduction, episodeCount: files.length });
}

// ─── Grand Summary ────────────────────────────────────────────────────────────
console.log(`\n${HR}`);
console.log("  GRAND SUMMARY: Real BrowseGent Trace Data");
console.log(`${HR}\n`);

console.log(`  ${"Task".padEnd(36)} ${"JSON Total".padStart(12)} ${"CRM Total".padStart(12)} ${"Reduction".padStart(10)} ${"Calls".padStart(7)}`);
console.log(`  ${"─".repeat(82)}`);

let grandJson = 0;
let grandCrm = 0;
for (const s of taskSummaries) {
  grandJson += s.totalJsonTokens;
  grandCrm += s.totalCrmTokens;
  console.log(
    `  ${s.taskName.padEnd(36)} ${String(s.totalJsonTokens).padStart(12)} ${String(s.totalCrmTokens).padStart(12)} ${(s.overallReduction + "%").padStart(10)} ${String(s.episodeCount).padStart(7)}`
  );
}
const grandReduction = (((grandJson - grandCrm) / grandJson) * 100).toFixed(1);
console.log(`  ${"─".repeat(82)}`);
console.log(
  `  ${"TOTAL (5 eps × 3 tasks)".padEnd(36)} ${String(grandJson).padStart(12)} ${String(grandCrm).padStart(12)} ${(grandReduction + "%").padStart(10)}`
);

console.log(`
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  PROJECTED IMPACT ON balanced30 benchmark                               │
  │                                                                         │
  │  Current avg input tokens/task:    129,856                              │
  │  Apply measured CRM reduction:     ~${grandReduction}%                               │
  │  Projected post-CRM tokens/task:   ~${Math.round(129856 * (1 - parseFloat(grandReduction) / 100)).toLocaleString()} (browser-use baseline: 59,489)     │
  │                                                                         │
  │  This is derived from ACTUAL trace data, not toy examples.             │
  └─────────────────────────────────────────────────────────────────────────┘
`);

// done
