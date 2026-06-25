# Planner Token Attribution Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument and execute a token attribution analysis across all recorded BrowseGent v2 planner input traces to measure the exact token consumption of each prompt component (Lineage, Refs, Working Set, Recovery, Read Evidence, Metadata).

**Architecture:** Create an audit script using `js-tiktoken` to parse existing planner input JSON files, count tokens for each top-level key, compute average absolute token counts and percentages, and merge findings into the research document.

**Tech Stack:** TypeScript, `tsx`, `js-tiktoken`

---

### Task 1: Create the Token Attribution Script

**Files:**
- Create: `scripts/audit_planner_tokens.ts`

- [ ] **Step 1: Write the audit calculation logic with mock validation**

Create a script `scripts/audit_planner_tokens.ts` containing the core logic and a mock run to verify token calculation accuracy.

```typescript
import { getEncoding } from 'js-tiktoken';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const encoding = getEncoding('cl100k_base');

export interface TokenBreakdown {
  total: number;
  goal: number;
  lineage: number;
  refs: number;
  workingSet: number;
  recovery: number;
  readEvidence: number;
  pageMetadata: number;
  other: number;
}

export function analyzePayload(payload: any): TokenBreakdown {
  const count = (obj: any): number => {
    if (obj === undefined || obj === null) return 0;
    return encoding.encode(JSON.stringify(obj)).length;
  };

  const total = count(payload);
  const goal = count(payload.goal);
  const lineage = count(payload.lineage);
  const refs = count(payload.current?.refs);
  const workingSet = count(payload.workingSet);
  
  const recovery = count(payload.recovery) + count(payload.failures) + count(payload.deadState);
  
  // Read evidence includes interactions, readables, navigation, regions, lastResult
  const readEvidence = 
    count(payload.current?.interactions) +
    count(payload.current?.readables) +
    count(payload.current?.navigation) +
    count(payload.current?.regions) +
    count(payload.lastResult);

  const pageMetadata = count(payload.current?.page) + count(payload.current?.stats) + count(payload.current?.warnings);

  // Other represents top-level metadata or fields not captured above
  const accounted = goal + lineage + refs + workingSet + recovery + readEvidence + pageMetadata;
  const other = Math.max(0, total - accounted);

  return {
    total,
    goal,
    lineage,
    refs,
    workingSet,
    recovery,
    readEvidence,
    pageMetadata,
    other,
  };
}

// Self-validation test case
const mockPayload = {
  goal: 'Click Submit',
  lineage: [{ step: 1, action: 'click' }],
  current: {
    page: { url: 'https://example.test', title: 'Example' },
    refs: {
      v2ref_1: { refId: 'v2ref_1', name: 'Submit' }
    },
    interactions: [{ refId: 'v2ref_1' }],
    stats: { interactionCount: 1 }
  },
  workingSet: { mode: 'act' },
  recovery: { state: null }
};

const breakdown = analyzePayload(mockPayload);
console.log('Mock validation breakdown:', breakdown);
if (breakdown.total <= 0 || breakdown.refs <= 0) {
  throw new Error('Self-validation check failed: token counts are invalid');
}
```

- [ ] **Step 2: Run self-validation to verify token calculations**

Run: `npx tsx scripts/audit_planner_tokens.ts`
Expected: Output showing the breakdown and exiting with code 0 (no self-validation errors).

- [ ] **Step 3: Implement recursive file search and aggregation**

Append the runner and aggregator code to `scripts/audit_planner_tokens.ts` to scan directories recursively, load files, and print average statistics.

```typescript
function findJsonFiles(dir: string, fileList: string[] = []): string[] {
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      if (statSync(filePath).isDirectory()) {
        findJsonFiles(filePath, fileList);
      } else if (file.endsWith('-input.json')) {
        fileList.push(filePath);
      }
    }
  } catch (e) {
    // Directory might not exist, ignore
  }
  return fileList;
}

const targetDirs = [
  join(process.cwd(), 'logs', 'v2-unit-traces'),
  join(process.cwd(), 'logs', 'v2-integration-traces'),
  join(process.cwd(), 'logs', 'v2-runs'),
];

console.log('Scanning directories:', targetDirs);
const allFiles: string[] = [];
for (const dir of targetDirs) {
  findJsonFiles(dir, allFiles);
}

console.log(`Found ${allFiles.length} planner input trace files.`);

if (allFiles.length === 0) {
  console.log('No trace files found to analyze.');
  process.exit(0);
}

const totals: TokenBreakdown = {
  total: 0,
  goal: 0,
  lineage: 0,
  refs: 0,
  workingSet: 0,
  recovery: 0,
  readEvidence: 0,
  pageMetadata: 0,
  other: 0,
};

let fileCount = 0;
for (const file of allFiles) {
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    const res = analyzePayload(payload);
    
    totals.total += res.total;
    totals.goal += res.goal;
    totals.lineage += res.lineage;
    totals.refs += res.refs;
    totals.workingSet += res.workingSet;
    totals.recovery += res.recovery;
    totals.readEvidence += res.readEvidence;
    totals.pageMetadata += res.pageMetadata;
    totals.other += res.other;
    fileCount++;
  } catch (e) {
    console.error(`Failed to parse ${file}:`, e);
  }
}

if (fileCount > 0) {
  const avg = (val: number) => (val / fileCount).toFixed(1);
  const pct = (val: number) => ((val / totals.total) * 100).toFixed(1);

  console.log('\n==================================================');
  console.log('          PLANNER TOKEN ATTRIBUTION REPORT');
  console.log('==================================================');
  console.log(`Total Traces Audited: ${fileCount}`);
  console.log(`Average Total Prompt Tokens: ${avg(totals.total)}`);
  console.log('--------------------------------------------------');
  console.log(`Goal:          Avg ${avg(totals.goal)} tokens (${pct(totals.goal)}%)`);
  console.log(`Lineage/Hist:  Avg ${avg(totals.lineage)} tokens (${pct(totals.lineage)}%)`);
  console.log(`Current Refs:  Avg ${avg(totals.refs)} tokens (${pct(totals.refs)}%)`);
  console.log(`Working Set:   Avg ${avg(totals.workingSet)} tokens (${pct(totals.workingSet)}%)`);
  console.log(`Recovery:      Avg ${avg(totals.recovery)} tokens (${pct(totals.recovery)}%)`);
  console.log(`Read Evidence: Avg ${avg(totals.readEvidence)} tokens (${pct(totals.readEvidence)}%)`);
  console.log(`Page Metadata: Avg ${avg(totals.pageMetadata)} tokens (${pct(totals.pageMetadata)}%)`);
  console.log(`Other/Padding: Avg ${avg(totals.other)} tokens (${pct(totals.other)}%)`);
  console.log('==================================================');
}
```

---

### Task 2: Execute Audit and Gather Empirical Results

- [ ] **Step 1: Execute token attribution script**

Run: `npx tsx scripts/audit_planner_tokens.ts`
Expected: Output prints the final report table with token counts and percentages for all audited traces.

---

### Task 3: Merge Findings into Research Document

**Files:**
- Modify: `c:\Users\Utkarsh\.gemini\antigravity\brain\4389cda2-de95-4b19-952d-f5480ca7c310\competitor_efficiency_research.md`

- [ ] **Step 1: Append the findings section**

Append a new section `Section 9: Empirical Validation: Planner Token Attribution Audit` to `competitor_efficiency_research.md`. Record the exact averages, percentages, and an architectural analysis of whether the results support or weaken **Hypothesis A** (that element representation is the dominant source of input tokens).
