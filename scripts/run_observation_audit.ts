import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, Page } from 'playwright';

import { ObservationService } from '../src/v2/substrate/ObservationService';
import { RefService } from '../src/v2/runtime/RefService';
import { PlannerWorkingSetSelector } from '../src/v2/planner/PlannerWorkingSetSelector';

interface KnownControlAudit {
  name: string;
  matcher: (ref: any) => boolean;
}

interface AuditState {
  stateLabel: string;
  action?: (page: Page) => Promise<void>;
  expectedControls: KnownControlAudit[];
}

interface SiteConfig {
  name: string;
  url: string;
  critical: boolean;
  states: AuditState[];
}

interface AuditMetrics {
  totalNodes: number;
  actionableRefs: number;
  lossRate: number;
  duplicateDensity: number;
  actionabilityCoverage: number;
  stabilityVariance: number;
  observationTimeMs: number;
  refGenerationTimeMs: number;
  workingSetTimeMs: number;
  missingControlsList: string[];
}

const SITE_CONFIGS: SiteConfig[] = [
  {
    name: 'Wikipedia',
    url: 'https://www.wikipedia.org/',
    critical: true,
    states: [
      {
        stateLabel: 'State A (Homepage)',
        expectedControls: [
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Language Dropdown', matcher: r => r.tagName === 'select' && (r.name?.toLowerCase().includes('language') || r.text?.toLowerCase().includes('language')) },
          { name: 'Search Button', matcher: r => r.tagName === 'button' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State B (Type Search Query)',
        action: async (page) => {
          const input = page.locator('input[name="search"]');
          await input.fill('software engineering');
        },
        expectedControls: [
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State C (Article page)',
        action: async (page) => {
          await page.click('button[type="submit"]');
          await page.waitForTimeout(2000);
        },
        expectedControls: [
          { name: 'Contents list', matcher: r => r.role === 'link' && r.name === 'Contents' }
        ]
      }
    ]
  },
  {
    name: 'Cambridge Dictionary',
    url: 'https://dictionary.cambridge.org/',
    critical: true,
    states: [
      {
        stateLabel: 'State A (Homepage)',
        expectedControls: [
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Search Button', matcher: r => r.tagName === 'button' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State B (Autocomplete Dropdown)',
        action: async (page) => {
          const input = page.locator('input[name="q"]').first();
          await input.fill('sustainability');
          await page.waitForTimeout(1500); // Let autocomplete paint
        },
        expectedControls: [
          { name: 'Search Input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Autocomplete Popup Item', matcher: r => r.name?.toLowerCase().includes('sustainability') || r.text?.toLowerCase().includes('sustainability') }
        ]
      },
      {
        stateLabel: 'State C (Definition Page)',
        action: async (page) => {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
        },
        expectedControls: [
          { name: 'UK pronunciation speaker', matcher: r => r.name?.toLowerCase().includes('uk') || r.name?.toLowerCase().includes('listen') },
          { name: 'US pronunciation speaker', matcher: r => r.name?.toLowerCase().includes('us') || r.name?.toLowerCase().includes('listen') }
        ]
      }
    ]
  },
  {
    name: 'Amazon',
    url: 'https://www.amazon.com/',
    critical: true,
    states: [
      {
        stateLabel: 'State A (Homepage)',
        expectedControls: [
          { name: 'Search input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) },
          { name: 'Search submit button', matcher: r => r.tagName === 'input' && r.name === 'Go' }
        ]
      },
      {
        stateLabel: 'State B (Type Laptop Query)',
        action: async (page) => {
          const input = page.locator('#twotabsearchtextbox');
          await input.fill('laptop');
        },
        expectedControls: [
          { name: 'Search input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State C (Results Page)',
        action: async (page) => {
          await page.click('#nav-search-submit-button');
          await page.waitForTimeout(3000);
        },
        expectedControls: [
          { name: 'Next page link', matcher: r => r.name === 'Next' && r.role === 'link' }
        ]
      }
    ]
  },
  {
    name: 'GitHub',
    url: 'https://github.com/',
    critical: true,
    states: [
      {
        stateLabel: 'State A (Homepage)',
        expectedControls: [
          { name: 'Sign in link', matcher: r => r.role === 'link' && r.name === 'Sign in' },
          { name: 'Sign up button', matcher: r => r.role === 'link' && r.name === 'Sign up' }
        ]
      },
      {
        stateLabel: 'State B (Navigate Repository)',
        action: async (page) => {
          await page.goto('https://github.com/Utkarsh-X/browsegent');
          await page.waitForTimeout(2000);
        },
        expectedControls: [
          { name: 'Code tab link', matcher: r => r.role === 'link' && r.name === 'Code' },
          { name: 'Issues tab link', matcher: r => r.role === 'link' && r.name === 'Issues' }
        ]
      },
      {
        stateLabel: 'State C (Issues page)',
        action: async (page) => {
          await page.click('a[data-tab-item="issues-tab"]');
          await page.waitForTimeout(2000);
        },
        expectedControls: [
          { name: 'Search issues input', matcher: r => r.tagName === 'input' && r.name === 'Search all issues' },
          { name: 'Filters dropdown button', matcher: r => r.role === 'button' && r.name === 'Filters' }
        ]
      }
    ]
  },
  {
    name: 'Reddit',
    url: 'https://www.reddit.com/',
    critical: false, // Exploratory only
    states: [
      {
        stateLabel: 'State A (Homepage)',
        expectedControls: [
          { name: 'Search input', matcher: r => r.tagName === 'input' && (r.name?.toLowerCase().includes('search') || r.text?.toLowerCase().includes('search')) }
        ]
      },
      {
        stateLabel: 'State B (Subreddit page)',
        action: async (page) => {
          await page.goto('https://www.reddit.com/r/javascript/');
          await page.waitForTimeout(3000);
        },
        expectedControls: [
          { name: 'Join subreddit button', matcher: r => r.role === 'button' && r.name === 'Join' }
        ]
      },
      {
        stateLabel: 'State C (Post page)',
        action: async (page) => {
          // Simply find the first link inside an h3 header and click it
          const firstPost = page.locator('a[href*="/r/javascript/comments/"]').first();
          await firstPost.click().catch(() => page.goto(page.url()));
          await page.waitForTimeout(3000);
        },
        expectedControls: [
          { name: 'Upvote button', matcher: r => r.role === 'button' && (r.name === 'Upvote' || r.text === 'Upvote') }
        ]
      }
    ]
  }
];

export { SITE_CONFIGS };
