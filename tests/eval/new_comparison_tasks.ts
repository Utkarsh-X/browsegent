// tests/eval/new_comparison_tasks.ts
// IMPORTANT: These queries have NOT been seen by either BrowseGent or Stagehand.
// They were generated after all investigation runs completed.
// Neither system was optimized for these.

export interface ComparisonTask {
  id: string;
  url: string;
  query: string;
  category: string;
  why_fair: string;
}

export const NEW_COMPARISON_TASKS: ComparisonTask[] = [
  {
    id: 'nc1',
    url: 'https://docs.python.org/3/library/json.html',
    query: 'What are the default parameters of json.dumps() function?',
    category: 'developer_docs',
    why_fair: 'Requires reading function signature from docs — no price pattern, no keyword shortcut',
  },
  {
    id: 'nc2',
    url: 'https://en.wikipedia.org/wiki/Moon_landing',
    query: 'How many people have walked on the Moon in total?',
    category: 'wikipedia_history',
    why_fair: 'Requires finding a specific number in a long article — keyword "moon" appears everywhere',
  },
  {
    id: 'nc3',
    url: 'https://github.com/microsoft/vscode',
    query: 'What license does this repository use?',
    category: 'github_repo',
    why_fair: 'License info is in sidebar metadata — not in main content keyword matches',
  },
  {
    id: 'nc4',
    url: 'https://apnews.com/',
    query: 'What is the main headline story on AP News right now?',
    category: 'news',
    why_fair: 'Headline is visually prominent but not keyword-matchable without reading layout',
  },
  {
    id: 'nc5',
    url: 'https://www.newegg.com/p/pl?d=usb+hub',
    query: 'What is the price of the first product listed?',
    category: 'product_listing',
    why_fair: 'Price extraction from a non-Amazon product page — tests price pattern handler',
  },
  {
    id: 'nc6',
    url: 'https://stackoverflow.com/questions/tagged/javascript',
    query: 'How many questions are tagged with javascript on Stack Overflow?',
    category: 'community_forum',
    why_fair: 'Count is in page metadata, not in question list — requires finding the tag count badge',
  },
  {
    id: 'nc7',
    url: 'https://www.indeed.com/jobs?q=python+developer&l=remote',
    query: 'What company posted the first job listing shown?',
    category: 'job_listing',
    why_fair: 'Company name extraction from job listing — not price, not headline pattern',
  },
  {
    id: 'nc8',
    url: 'https://weather.gov/',
    query: 'What is the title of the first weather alert or headline shown on the page?',
    category: 'data_page',
    why_fair: 'Government data page — tests handling of institutional page structures',
  },
  {
    id: 'nc9',
    url: 'https://www.nasa.gov/',
    query: 'What is the featured story or main article title on NASA homepage?',
    category: 'institutional',
    why_fair: 'Hero section extraction — requires understanding visual hierarchy not just keywords',
  },
  {
    id: 'nc10',
    url: 'https://www.espn.com/',
    query: 'What is the top sports headline shown on ESPN right now?',
    category: 'entertainment',
    why_fair: 'Dynamic content headline — changes frequently, cannot be pre-tuned for',
  },
];
