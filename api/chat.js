import OpenAI from "openai";
import Exa from "exa-js";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPEN_ROUTER_KEY,
});

const exa = new Exa(process.env.EXA_API_KEY);

const DEFAULT_MODEL = "google/gemini-2.5-flash";

const DOMAIN_BATCHES = [
  ["irs.gov", "treasury.gov", "congress.gov", "supremecourt.gov", "uscourts.gov", "govinfo.gov", "federalregister.gov", "taxnotes.com", "tax.gov", "ttb.gov"],
  ["ftb.ca.gov", "cdtfa.ca.gov", "tax.ny.gov", "revenue.pa.gov", "tax.illinois.gov", "comptroller.texas.gov", "dor.wa.gov", "law.cornell.edu", "justia.com", "findlaw.com"],
  ["taxfoundation.org", "aicpa-cima.com", "americanbar.org", "bdo.com", "pwc.com", "deloitte.com", "ey.com", "kpmg.com", "bloomberglaw.com", "thomsonreuters.com"],
];

const MAX_AGE_HOURS = 336;
const DISCOVERY_LIVECRAWL_TIMEOUT = 1500;
const REFRESH_LIVECRAWL_TIMEOUT = 10000;

async function discoverySearch(query, numResults = 10) {
  const startTime = Date.now();
  const batchPromises = DOMAIN_BATCHES.map(async (domains) => {
    try {
      const response = await exa.searchAndContents(query, {
        numResults, includeDomains: domains, maxAgeHours: MAX_AGE_HOURS,
        livecrawlTimeout: DISCOVERY_LIVECRAWL_TIMEOUT, text: true,
        highlights: { maxCharacters: 4000 },
      });
      return response.results || [];
    } catch (err) {
      console.error(`Discovery batch failed: ${err.message}`);
      return [];
    }
  });
  const allResults = (await Promise.all(batchPromises)).flat();
  return {
    results: allResults.map((r) => ({
      title: r.title, url: r.url,
      text: r.text?.slice(0, 4000) || (r.highlights || []).join("\n").slice(0, 4000),
      publishedDate: r.publishedDate, author: r.author, crawlDate: r.crawlDate,
    })),
    timeMs: Date.now() - startTime,
  };
}

async function fetchFreshContents(urls) {
  const startTime = Date.now();
  try {
    const response = await exa.getContents(urls, {
      livecrawl: "always", livecrawlTimeout: REFRESH_LIVECRAWL_TIMEOUT, text: true,
    });
    return {
      results: (response.results || []).map((r) => ({
        title: r.title, url: r.url, text: r.text?.slice(0, 4000), crawlDate: r.crawlDate,
      })),
      timeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error(`Fresh contents fetch failed: ${err.message}`);
    return { results: [], timeMs: Date.now() - startTime };
  }
}

const getSystemPrompt = () => {
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `You are a tax law research assistant powered by Exa search. You help users find current tax law information across government, legal, and professional sources.

TODAY'S DATE: ${currentDate}

ALWAYS SEARCH: For any tax law question, always use tax_law_search. Tax law changes frequently.

HOW YOUR SEARCH WORKS (Progressive Results Availability):
When you call tax_law_search, the system runs 3 parallel Exa /search calls across domain batches. Each returns up to 10 results with cached content (maxAgeHours: 336 = 2 weeks). Each result includes a crawlDate indicating when the page was last crawled.

EVALUATING RESULTS:
After receiving results, check crawlDate:
- Within last 2 weeks: content is fresh, use directly
- Older than 2 weeks: content may be stale

THE CONTENTS DECISION:
Call fetch_fresh_content ONLY when ALL true:
1. The result is RELEVANT to the user's question
2. The crawlDate is stale (>2 weeks old)
3. The content is likely to have CHANGED (rate tables, pending legislation, regulatory updates)

Do NOT re-fetch static documents, results you won't use, or results with recent crawlDates.

RESPONSE STYLE:
- Start directly with the answer
- Cite specific sources with dates when possible
- Note effective dates for tax rates and thresholds

FOLLOW-UP SUGGESTIONS - Always include at the very end:
\`\`\`followups
["Question 1?", "Question 2?", "Question 3?"]
\`\`\``;
};

const getSearchTool = () => ({
  type: "function",
  function: {
    name: "tax_law_search",
    description: "Search tax law sources via Exa. Runs 3 parallel searches across ~2000 government, legal, and professional domains with cached content. Results include crawlDate metadata.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language tax law query." },
      },
      required: ["query"],
    },
  },
});

const getFetchTool = () => ({
  type: "function",
  function: {
    name: "fetch_fresh_content",
    description: "Fetch fresh content for specific URLs where the cached version is stale AND the content is likely to have changed. Only use for URLs from tax_law_search results that have old crawlDates and contain time-sensitive content.",
    parameters: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to re-fetch.", maxItems: 5 },
      },
      required: ["urls"],
    },
  },
});

function formatDiscoveryResults(results) {
  if (results.length === 0) return "No results found.";
  return results.map((r) => {
    const date = r.publishedDate ? ` | Published: ${r.publishedDate.slice(0, 10)}` : "";
    const crawl = r.crawlDate ? ` | crawlDate: ${r.crawlDate.slice(0, 10)}` : " | crawlDate: unknown";
    return `- ${r.title}${date}${crawl}\n  ${r.url}\n  ${r.text?.slice(0, 600) || ""}`;
  }).join("\n");
}

function formatFreshResults(results) {
  if (results.length === 0) return "Failed to fetch fresh content.";
  return results.map((r) => {
    const crawl = r.crawlDate ? ` | crawlDate: ${r.crawlDate.slice(0, 10)}` : "";
    return `- ${r.title}${crawl}\n  ${r.url}\n  ${r.text?.slice(0, 600) || ""}`;
  }).join("\n");
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history = [], model = DEFAULT_MODEL } = req.body;

    const recentHistory = history.slice(-20).map(msg => ({ role: msg.role, content: msg.content }));
    const messages = [
      { role: "system", content: getSystemPrompt() },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const tools = [getSearchTool(), getFetchTool()];
    let allSearchSources = [];
    let totalSearchTimeMs = 0;
    let round = 0;

    while (round < 3) {
      round++;
      const response = await client.chat.completions.create({ model, messages, tools });
      const choice = response.choices[0];

      if (!choice.message.tool_calls) {
        return res.json({
          content: choice.message.content,
          searches: allSearchSources.length > 0 ? [{ query: "Tax law search", sources: allSearchSources }] : null,
          exaUsed: allSearchSources.length > 0,
          searchTimeMs: totalSearchTimeMs,
          totalSources: allSearchSources.length,
        });
      }

      messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        let args;
        try { args = JSON.parse(toolCall.function.arguments); } catch (e) {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: invalid arguments" });
          continue;
        }

        if (toolCall.function.name === "tax_law_search") {
          const { results, timeMs } = await discoverySearch(args.query || "tax law");
          totalSearchTimeMs += timeMs;
          allSearchSources.push(...results.map(r => ({ title: r.title, url: r.url, date: r.publishedDate, author: r.author, crawlDate: r.crawlDate })));
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Discovery results (${results.length}, ${timeMs}ms):\n${formatDiscoveryResults(results)}` });
        } else if (toolCall.function.name === "fetch_fresh_content") {
          const { results, timeMs } = await fetchFreshContents(args.urls || []);
          totalSearchTimeMs += timeMs;
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Fresh content (${results.length}, ${timeMs}ms):\n${formatFreshResults(results)}` });
        } else {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Unknown tool` });
        }
      }
    }

    res.json({ content: "Please try again.", searches: null, exaUsed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
