import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Check, Clock, Zap, Database, RefreshCw, Search, FileText, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { PageHeader } from "./components/PageHeader";
import Button from "./components/Button";

const PAGE_CONTENT_FOR_LLM = `# Progressive Results Availability (PRA) with Exa

A strategy for reducing livecrawl latency from ~15s to <3s by decoupling search ranking from content freshness using Exa's /search and /contents APIs.

## The Problem

When using livecrawl: "always" on /search, every query is bounded by the slowest crawl across all results. With 2,000+ domains and 10 results, this means ~15 second latency.

## The Solution: 3-Step PRA Flow

### Step 1: Discovery (3x parallel /search calls)
- Split domains across 3 batches (up to 1,200 per call via includeDomains)
- Use maxAgeHours: 336 (2 weeks) + livecrawlTimeout: 1500ms
- Returns ~30 results with cached content in 1.7-2.9s

### Step 2: Agent Filtering (no API call)
- LLM filters results using cached content
- Checks crawlDate on each result to identify stale content
- Picks ~10 most relevant results

### Step 3: Targeted Re-fetch (parallel /contents calls)
- Only for URLs that are both relevant AND stale
- Uses livecrawl: "always" + livecrawlTimeout: 10000ms
- Most cached results are fresh enough — only ~3/10 need re-fetching

## Key Insight
Before: 10/10 results livecrawled (bounded by slowest)
After: ~3/10 results livecrawled (only stale + relevant ones)
`;

const codeStyle = {
  'code[class*="language-"]': {
    color: '#000911',
    background: 'none',
  },
  'pre[class*="language-"]': {
    color: '#000911',
    background: 'white',
    padding: '1rem',
  },
  comment: { color: '#6b7280' },
  string: { color: '#059669' },
  number: { color: '#0040f0' },
  keyword: { color: '#7c3aed' },
  function: { color: '#0040f0' },
  punctuation: { color: '#000911' },
  operator: { color: '#000911' },
  property: { color: '#0040f0' },
  'class-name': { color: '#0040f0' },
};

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-4">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded-md bg-[#e5e5e5] p-1.5 text-[#60646c] opacity-0 transition-all hover:bg-[#d4d4d4] hover:text-[#000911] group-hover:opacity-100"
        title="Copy code"
      >
        {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
      </button>
      <SyntaxHighlighter
        style={codeStyle}
        language={language || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: '8px', fontSize: '13px', paddingRight: '3rem', background: 'white', border: '1px solid #e5e5e5' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function Note({ children }) {
  return (
    <div className="my-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <p className="text-[14px] text-blue-800">{children}</p>
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="my-4 rounded-lg border border-[#e5e5e5]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left font-medium text-[#000911]"
      >
        {title}
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && <div className="border-t border-[#e5e5e5] p-4 overflow-x-auto">{children}</div>}
    </div>
  );
}

function Step({ number, title, icon: Icon, children }) {
  return (
    <div className="relative pl-10 pb-8 border-l-2 border-[#e5e5e5] last:border-l-0 last:pb-0">
      <div className="absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#0040f0] text-white text-sm font-medium">
        {Icon ? <Icon size={16} /> : number}
      </div>
      <h3 className="text-lg font-semibold text-[#000911] mb-3">{title}</h3>
      <div className="text-[#60646c]">{children}</div>
    </div>
  );
}

function MetricCard({ label, value, sublabel, color = "blue" }) {
  const colors = {
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    green: "border-green-200 bg-green-50 text-green-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <div className="text-[12px] font-medium uppercase tracking-wider opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sublabel && <div className="text-[12px] mt-1 opacity-75">{sublabel}</div>}
    </div>
  );
}

function FlowDiagram() {
  return (
    <div className="my-8 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-6 overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Step 1 */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-[#0040f0] text-white font-bold">1</div>
          <div className="flex-1">
            <div className="font-semibold text-[#000911] mb-2">Discovery: 3x parallel /search calls</div>
            <div className="grid grid-cols-3 gap-2">
              {["Batch A: gov domains", "Batch B: state + legal", "Batch C: firms + orgs"].map((label, i) => (
                <div key={i} className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
                  <div className="text-[11px] font-medium text-blue-600 mb-1">/search + contents</div>
                  <div className="text-[12px] text-blue-800">{label}</div>
                  <div className="text-[10px] text-blue-600 mt-1">maxAgeHours: 336</div>
                  <div className="text-[10px] text-blue-600">livecrawlTimeout: 1500ms</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Clock size={14} className="text-green-600" />
              <span className="text-[13px] text-green-700 font-medium">~1.7-2.9s for 30 results with content</span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center pl-5 mb-6">
          <div className="w-0.5 h-8 bg-[#e5e5e5] ml-4" />
        </div>

        {/* Step 2 */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-[#7c3aed] text-white font-bold">2</div>
          <div className="flex-1">
            <div className="font-semibold text-[#000911] mb-2">Agent Filtering (no API call)</div>
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
              <div className="text-[13px] text-purple-800 space-y-1">
                <div>LLM evaluates 30 results using cached content</div>
                <div className="font-medium">Checks each result's <code className="bg-purple-100 px-1 rounded">crawlDate</code> metadata</div>
                <div>Decides: <em>"Is this relevant AND stale enough to re-fetch?"</em></div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Zap size={14} className="text-purple-600" />
              <span className="text-[13px] text-purple-700 font-medium">No API call needed — uses cached content for decisions</span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center pl-5 mb-6">
          <div className="w-0.5 h-8 bg-[#e5e5e5] ml-4" />
        </div>

        {/* Step 3 */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-[#059669] text-white font-bold">3</div>
          <div className="flex-1">
            <div className="font-semibold text-[#000911] mb-2">Targeted Re-fetch: /contents for stale URLs only</div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-medium text-green-600 mb-1">Fresh results (skip)</div>
                  <div className="text-[12px] text-green-800">~7/10 results already have fresh content</div>
                  <div className="text-[10px] text-green-600">crawlDate within 2 weeks — use as-is</div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-amber-600 mb-1">Stale results (re-fetch)</div>
                  <div className="text-[12px] text-amber-800">~3/10 results need fresh content</div>
                  <div className="text-[10px] text-amber-600">livecrawl: "always", timeout: 10000ms</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <RefreshCw size={14} className="text-green-600" />
              <span className="text-[13px] text-green-700 font-medium">Only re-fetches what's relevant AND stale</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Tutorial() {
  const [copied, setCopied] = useState(false);

  const handleCopyForLLM = async () => {
    await navigator.clipboard.writeText(PAGE_CONTENT_FOR_LLM);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        title="Progressive Results Availability"
        subtitle="Reduce livecrawl latency from ~15s to <3s with Exa's search + contents APIs"
        rightContent={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? Check : Copy}
              iconPosition="start"
              onClick={handleCopyForLLM}
            >
              {copied ? "Copied!" : "Copy for LLM"}
            </Button>
            <Link to="/">
              <Button
                variant="default"
                size="sm"
                icon={ArrowLeft}
                iconPosition="start"
              >
                Back to Chat
              </Button>
            </Link>
          </>
        }
      />

      <main className="mx-auto max-w-4xl px-6 py-12">

        {/* The Problem */}
        <h2 className="text-2xl font-bold text-[#000911] mb-4">The Problem</h2>
        <p className="text-[16px] text-[#000911] mb-4">
          When an agent uses <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">livecrawl: "always"</code> on Exa's <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">/search</code> endpoint, every query waits for the slowest livecrawl across all results. With 2,000+ target domains and 10 results per call, this creates <strong>~15 second latency</strong> — unacceptable for a real-time chatbot.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <MetricCard label="Before (livecrawl: always)" value="~15s" sublabel="Bounded by slowest crawl across 10 results" color="red" />
          <MetricCard label="After (PRA strategy)" value="<3s" sublabel="Most results served from cache instantly" color="green" />
        </div>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* The Solution */}
        <h2 className="text-2xl font-bold text-[#000911] mb-4">The Solution: Progressive Results Availability</h2>
        <p className="text-[16px] text-[#000911] mb-6">
          Decouple <strong>search ranking</strong> from <strong>content freshness</strong>. Use cached content for discovery and filtering, then selectively re-fetch only the URLs that are both relevant and stale.
        </p>

        <FlowDiagram />

        <div className="grid grid-cols-3 gap-4 mb-8">
          <MetricCard label="Livecrawls before" value="10/10" sublabel="Every result livecrawled" color="red" />
          <MetricCard label="Livecrawls after" value="~3/10" sublabel="Only stale + relevant" color="green" />
          <MetricCard label="Discovery latency" value="1.7-2.9s" sublabel="30 results with content" color="blue" />
        </div>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* Step-by-step with code */}
        <h2 className="text-2xl font-bold text-[#000911] mb-6">How Each Step Works</h2>

        <div className="space-y-0">
          <Step number={1} title="Discovery: 3x Parallel /search Calls">
            <p className="mb-4">
              Split your target domains across 3 batches (Exa supports up to 1,200 domains per <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">includeDomains</code> call) and fire them in parallel:
            </p>

            <CodeBlock language="javascript" code={`const DOMAIN_BATCHES = [
  // Batch A: Federal government sources
  ["irs.gov", "treasury.gov", "congress.gov", "supremecourt.gov",
   "uscourts.gov", "govinfo.gov", "federalregister.gov", ...],

  // Batch B: State agencies + legal databases
  ["ftb.ca.gov", "tax.ny.gov", "revenue.pa.gov",
   "law.cornell.edu", "justia.com", "findlaw.com", ...],

  // Batch C: Professional firms + organizations
  ["taxfoundation.org", "americanbar.org", "pwc.com",
   "deloitte.com", "ey.com", "bloomberglaw.com", ...],
];

// Fire all 3 in parallel
const batchPromises = DOMAIN_BATCHES.map(domains =>
  exa.searchAndContents(query, {
    numResults: 10,
    includeDomains: domains,
    maxAgeHours: 336,          // Accept cache up to 2 weeks old
    livecrawlTimeout: 1500,    // 1.5s opportunistic livecrawl
    text: true,
    highlights: { maxCharacters: 4000 },
  })
);

const results = (await Promise.all(batchPromises)).flat();`} />

            <Note>
              <strong>includeDomains</strong> supports up to 1,200 domains per call.
              With 3 parallel calls, you can cover 3,600 domains — more than enough for most enterprise use cases.
              For a customer with ~2,000 domains, split them across the 3 batches.
            </Note>

            <Accordion title="Why maxAgeHours: 336 + livecrawlTimeout: 1500?">
              <p className="text-[14px] text-[#60646c] mb-3">
                <strong>maxAgeHours: 336 (2 weeks)</strong> means Exa will return cached content up to 2 weeks old.
                For most legal and government sources, content doesn't change that frequently — tax codes, court rulings,
                and regulatory guidance are typically stable for weeks or months.
              </p>
              <p className="text-[14px] text-[#60646c]">
                <strong>livecrawlTimeout: 1500ms</strong> adds an opportunistic livecrawl window. If Exa can fetch
                a fresh version within 1.5 seconds, great — you get fresh content for free. If not, you still get
                the cached version. This is a "best effort" freshness boost that doesn't slow down the overall query.
              </p>
            </Accordion>
          </Step>

          <Step number={2} title="Agent Filtering with crawlDate">
            <p className="mb-4">
              Each result from Step 1 includes a <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">crawlDate</code> field — the timestamp of when Exa last crawled that page. The agent uses this metadata to make the key decision: <em>"Should I fetch fresh content for this URL?"</em>
            </p>

            <CodeBlock language="javascript" code={`// Each result includes crawlDate metadata
{
  title: "2025 Tax Rate Schedules",
  url: "https://www.irs.gov/newsroom/irs-provides-tax-rate-schedules",
  text: "For tax year 2025, the top tax rate remains 37%...",
  crawlDate: "2025-03-20T14:30:00.000Z",  // <-- When Exa last crawled this
  publishedDate: "2025-01-15"
}

// The agent's decision logic:
// 1. Is this result RELEVANT to the user's question?
// 2. Is the crawlDate stale (>2 weeks old)?
// 3. Is the content likely to have CHANGED?
//
// Only if ALL THREE are true → call fetch_fresh_content`} />

            <div className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-[14px] text-amber-800">
                <strong>The key insight:</strong> The agent doesn't blindly re-fetch every stale result. It uses the cached content to evaluate relevance <em>first</em>, then only re-fetches URLs where freshness actually matters. A stale PDF of a 2020 tax ruling doesn't need re-fetching — the content hasn't changed.
              </p>
            </div>
          </Step>

          <Step number={3} title="Targeted Re-fetch with /contents">
            <p className="mb-4">
              For the small subset of URLs that are both relevant and stale, fire targeted <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">/contents</code> calls with a longer timeout:
            </p>

            <CodeBlock language="javascript" code={`// Only called for URLs the agent identified as stale + relevant
const freshContent = await exa.getContents(staleUrls, {
  livecrawl: "always",          // Force a fresh crawl
  livecrawlTimeout: 10000,      // 10s — we're willing to wait for these
  text: true,
});`} />

            <p className="mb-4">
              Because the agent already filtered in Step 2, this typically hits only <strong>~3 out of 10</strong> URLs.
              Each resolves independently — no "slowest result" bottleneck across the full result set.
            </p>

            <Accordion title="When does the agent NOT re-fetch?">
              <div className="space-y-3 text-[14px] text-[#60646c]">
                <div className="flex items-start gap-2">
                  <Check size={16} className="text-green-600 mt-0.5 shrink-0" />
                  <span><strong>Fresh results</strong> — crawlDate is within 2 weeks. The cached content is current enough.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check size={16} className="text-green-600 mt-0.5 shrink-0" />
                  <span><strong>Irrelevant results</strong> — even if stale, the agent won't waste a /contents call on a result it's not going to use.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check size={16} className="text-green-600 mt-0.5 shrink-0" />
                  <span><strong>Static documents</strong> — PDFs, court rulings, archived regulations. These don't change; re-fetching returns identical content.</span>
                </div>
              </div>
            </Accordion>
          </Step>
        </div>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* The Contents Tool Decision */}
        <h2 className="text-2xl font-bold text-[#000911] mb-4">The Contents Tool: "Should I Re-fetch This?"</h2>
        <p className="text-[16px] text-[#000911] mb-6">
          The core of the PRA strategy is giving the agent a <strong>second tool</strong> — not just search, but a targeted contents fetch. The agent decides when to use it based on the crawlDate signal.
        </p>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <h3 className="text-lg font-semibold text-[#000911] mb-3">Tool 1: tax_law_search</h3>
            <CodeBlock language="javascript" code={`{
  name: "tax_law_search",
  description: "Search tax law sources via Exa.
    Runs 3 parallel searches across ~2000
    domains with cached content. Results
    include crawlDate metadata.",
  parameters: {
    query: { type: "string" }
  }
}`} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#000911] mb-3">Tool 2: fetch_fresh_content</h3>
            <CodeBlock language="javascript" code={`{
  name: "fetch_fresh_content",
  description: "Fetch fresh content for specific
    stale URLs. Only use for URLs with old
    crawlDates and time-sensitive content.",
  parameters: {
    urls: {
      type: "array",
      items: { type: "string" },
      maxItems: 5
    }
  }
}`} />
          </div>
        </div>

        <p className="text-[16px] text-[#000911] mb-4">
          This is a <strong>multi-round tool calling</strong> pattern. The model calls <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">tax_law_search</code> first, receives results with crawlDate metadata, then decides whether to call <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">fetch_fresh_content</code> in a subsequent round.
        </p>

        <CodeBlock language="javascript" code={`// Multi-round tool calling flow
const tools = [searchTool, contentsTool];
const MAX_ROUNDS = 3;

for (let round = 0; round < MAX_ROUNDS; round++) {
  const response = await llm.chat({ messages, tools });

  // If model returns text (no tool call), we're done
  if (!response.tool_calls) break;

  // Execute each tool call
  for (const call of response.tool_calls) {
    if (call.name === "tax_law_search") {
      // Step 1: Discovery search — returns results with crawlDate
      const results = await discoverySearch(call.args.query);
      messages.push({ role: "tool", content: formatResults(results) });
    }
    if (call.name === "fetch_fresh_content") {
      // Step 3: Targeted re-fetch — only for stale + relevant URLs
      const fresh = await exa.getContents(call.args.urls, {
        livecrawl: "always",
        livecrawlTimeout: 10000,
      });
      messages.push({ role: "tool", content: formatResults(fresh) });
    }
  }
  // Loop back — model sees tool results and decides next action
}`} />

        <Note>
          The model can call both tools in the same round, or spread them across rounds.
          The key is that <code className="bg-blue-100 px-1 rounded">fetch_fresh_content</code> is available but the model only uses it when crawlDate signals staleness on a relevant result.
        </Note>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* The crawlDate Signal */}
        <h2 className="text-2xl font-bold text-[#000911] mb-4">The crawlDate Signal</h2>
        <p className="text-[16px] text-[#000911] mb-4">
          Every Exa search result with contents includes a <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">crawlDate</code> field. This is the metadata that powers the agent's re-fetch decisions:
        </p>

        <div className="my-6 rounded-xl border border-[#e5e5e5] overflow-hidden">
          <div className="grid grid-cols-4 bg-[#f4f4f5] px-4 py-2 text-[12px] font-medium text-[#60646c] uppercase tracking-wider">
            <div>Scenario</div>
            <div>What's returned</div>
            <div>crawlDate</div>
            <div>Agent action</div>
          </div>
          {[
            ["Cache < 2 weeks", "Cached content instantly", "Recent", "Use as-is"],
            ["Cache > 2 weeks, livecrawl succeeds in 1.5s", "Fresh content", "Just now", "Use as-is"],
            ["Cache > 2 weeks, livecrawl times out", "Stale cached content", "Old", "Evaluate, maybe re-fetch"],
            ["No cache, livecrawl times out", "Dropped from results", "N/A", "Invisible to agent"],
          ].map(([scenario, returned, crawlDate, action], i) => (
            <div key={i} className={`grid grid-cols-4 px-4 py-3 text-[13px] ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} ${i === 3 ? 'text-[#9ca3af]' : 'text-[#000911]'}`}>
              <div className="font-medium">{scenario}</div>
              <div>{returned}</div>
              <div>{crawlDate}</div>
              <div className="font-medium">{action}</div>
            </div>
          ))}
        </div>

        <p className="text-[14px] text-[#60646c] mb-4">
          Row 4 (no cache + timeout) is a rare edge case for well-indexed domain lists. For enterprise customers with established domains (government sites, law firms, major publishers), nearly all URLs are already in Exa's index.
        </p>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* includeDomains */}
        <h2 className="text-2xl font-bold text-[#000911] mb-4">Scaling with includeDomains</h2>
        <p className="text-[16px] text-[#000911] mb-4">
          Exa's <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">includeDomains</code> parameter accepts up to <strong>1,200 domains per call</strong>.
          With 3 parallel calls, this covers <strong>3,600 domains</strong> — well beyond most enterprise needs.
        </p>

        <CodeBlock language="javascript" code={`// For a customer with 2,000+ target domains:
// Split into 3 batches of ~667 domains each

const batch1 = domains.slice(0, 667);    // Federal + major sources
const batch2 = domains.slice(667, 1334); // State agencies
const batch3 = domains.slice(1334);       // Firms + orgs

// All 3 run in parallel — total latency = max(batch1, batch2, batch3)
const results = await Promise.all([
  exa.searchAndContents(query, { includeDomains: batch1, ... }),
  exa.searchAndContents(query, { includeDomains: batch2, ... }),
  exa.searchAndContents(query, { includeDomains: batch3, ... }),
]);`} />

        <hr className="my-8 border-[#e5e5e5]" />

        {/* Summary */}
        <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-6 mb-8">
          <h2 className="text-xl font-bold text-[#000911] mb-4">Summary</h2>
          <div className="space-y-3 text-[14px] text-[#000911]">
            <div className="flex items-start gap-3">
              <Search size={18} className="text-[#0040f0] mt-0.5 shrink-0" />
              <span><strong>Step 1</strong> — 3x parallel <code className="bg-white px-1 rounded border border-[#e5e5e5]">/search</code> with <code className="bg-white px-1 rounded border border-[#e5e5e5]">maxAgeHours: 336</code> + <code className="bg-white px-1 rounded border border-[#e5e5e5]">livecrawlTimeout: 1500</code> — returns 30 results with content in &lt;3s</span>
            </div>
            <div className="flex items-start gap-3">
              <Zap size={18} className="text-[#7c3aed] mt-0.5 shrink-0" />
              <span><strong>Step 2</strong> — Agent filters using cached content + <code className="bg-white px-1 rounded border border-[#e5e5e5]">crawlDate</code> metadata — no API call needed</span>
            </div>
            <div className="flex items-start gap-3">
              <FileText size={18} className="text-[#059669] mt-0.5 shrink-0" />
              <span><strong>Step 3</strong> — Targeted <code className="bg-white px-1 rounded border border-[#e5e5e5]">/contents</code> with <code className="bg-white px-1 rounded border border-[#e5e5e5]">livecrawl: "always"</code> — only ~3/10 results need this</span>
            </div>
          </div>
        </div>

        <p className="text-[16px] text-[#000911]">
          Get started with{" "}
          <a href="https://dashboard.exa.ai/overview" target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">
            Exa for free
          </a>
          {" "}and check out the{" "}
          <a href="https://docs.exa.ai" target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">
            API documentation
          </a>
          {" "}for full parameter reference.
        </p>
      </main>
    </div>
  );
}
