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
        numResults,
        includeDomains: domains,
        maxAgeHours: MAX_AGE_HOURS,
        livecrawlTimeout: DISCOVERY_LIVECRAWL_TIMEOUT,
        text: true,
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
      title: r.title,
      url: r.url,
      text: r.text?.slice(0, 4000) || (r.highlights || []).join("\n").slice(0, 4000),
      publishedDate: r.publishedDate,
      author: r.author,
      crawlDate: r.crawlDate,
    })),
    timeMs: Date.now() - startTime,
  };
}

async function fetchFreshContents(urls) {
  const startTime = Date.now();
  try {
    const response = await exa.getContents(urls, {
      livecrawl: "always",
      livecrawlTimeout: REFRESH_LIVECRAWL_TIMEOUT,
      text: true,
    });
    return {
      results: (response.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        text: r.text?.slice(0, 4000),
        crawlDate: r.crawlDate,
      })),
      timeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error(`Fresh contents fetch failed: ${err.message}`);
    return { results: [], timeMs: Date.now() - startTime };
  }
}

const getSystemPrompt = () => {
  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `You are a tax law research assistant powered by Exa search.

TODAY'S DATE: ${currentDate}

ALWAYS SEARCH: For any tax law question, always use tax_law_search.

HOW YOUR SEARCH WORKS (Progressive Results Availability):
When you call tax_law_search, the system runs 3 parallel Exa /search calls across domain batches.
Each returns up to 10 results with cached content (maxAgeHours: 336 = 2 weeks).
Each result includes a crawlDate.

THE CONTENTS DECISION:
Call fetch_fresh_content ONLY when ALL true:
1. The result is RELEVANT to the user's question
2. The crawlDate is stale (>2 weeks old)
3. The content is likely to have CHANGED (rate tables, pending legislation)

Do NOT re-fetch static documents, results you won't use, or fresh results.

RESPONSE STYLE:
- Start directly with the answer
- Cite specific sources with dates

FOLLOW-UP SUGGESTIONS:
\`\`\`followups
["Question 1?", "Question 2?", "Question 3?"]
\`\`\``;
};

const getSearchTool = () => ({
  type: "function",
  function: {
    name: "tax_law_search",
    description: "Search tax law sources via Exa. Runs 3 parallel searches across ~2000 domains with cached content. Results include crawlDate metadata.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language tax law query.",
        },
      },
      required: ["query"],
    },
  },
});

const getFetchTool = () => ({
  type: "function",
  function: {
    name: "fetch_fresh_content",
    description: "Fetch fresh content for specific stale URLs. Only use for URLs with old crawlDates and time-sensitive content.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "URLs to re-fetch with fresh content.",
          maxItems: 5,
        },
      },
      required: ["urls"],
    },
  },
});

function formatDiscoveryResults(results) {
  if (results.length === 0) return "No results found.";
  return results
    .map((r) => {
      const date = r.publishedDate ? ` | Published: ${r.publishedDate.slice(0, 10)}` : "";
      const crawl = r.crawlDate ? ` | crawlDate: ${r.crawlDate.slice(0, 10)}` : " | crawlDate: unknown";
      return `- ${r.title}${date}${crawl}\n  ${r.url}\n  ${r.text?.slice(0, 600) || ""}`;
    })
    .join("\n");
}

function formatFreshResults(results) {
  if (results.length === 0) return "Failed to fetch fresh content.";
  return results
    .map((r) => {
      const crawl = r.crawlDate ? ` | crawlDate: ${r.crawlDate.slice(0, 10)}` : "";
      return `- ${r.title}${crawl}\n  ${r.url}\n  ${r.text?.slice(0, 600) || ""}`;
    })
    .join("\n");
}

function friendlyError(msg) {
  if (/JSON error injected into SSE stream/i.test(msg))
    return "The AI model returned an invalid response. Please try again.";
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(msg))
    return "The request timed out. Please try again.";
  if (/rate limit|429/i.test(msg))
    return "Rate limited \u2014 please wait a moment and try again.";
  if (/5\d{2}|server error|internal error/i.test(msg))
    return "The AI service encountered an error. Please try again.";
  return msg;
}

async function consumeStreamWithRetry(createStream, onChunk, { maxRetries = 1, onRetry } = {}) {
  let attempts = 0;
  while (true) {
    try {
      const stream = await createStream();
      for await (const chunk of stream) {
        onChunk(chunk);
      }
      return;
    } catch (err) {
      attempts++;
      const isRetryable = /JSON error injected into SSE stream|ECONNRESET|ETIMEDOUT|socket hang up/i.test(err.message);
      if (isRetryable && attempts <= maxRetries) {
        console.warn(`[Stream] Retryable error (attempt ${attempts}/${maxRetries + 1}): ${err.message}`);
        if (onRetry) onRetry();
        continue;
      }
      throw err;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { message, history = [], model = DEFAULT_MODEL } = req.body;
    console.log(`[Stream] Request: "${message.slice(0, 80)}..." model: ${model}`);

    const recentHistory = history.slice(-20).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt() },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const tools = [getSearchTool(), getFetchTool()];
    let discoverySources = [];
    let narrowedSources = [];
    let livecrawledSources = [];
    let totalSearchTimeMs = 0;
    let round = 0;
    const MAX_ROUNDS = 3;

    while (round < MAX_ROUNDS) {
      round++;
      let toolCalls = [];
      let contentBuffer = "";

      await consumeStreamWithRetry(
        () =>
          client.chat.completions.create({
            model,
            messages,
            tools,
            stream: true,
          }),
        (chunk) => {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            contentBuffer += delta.content;
            sendEvent("content", { content: delta.content });
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        },
        {
          onRetry: () => {
            toolCalls = [];
            contentBuffer = "";
          },
        }
      );

      if (toolCalls.length === 0) break;

      messages.push({
        role: "assistant",
        content: contentBuffer || null,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        let args;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error("Failed to parse tool args:", e.message);
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: invalid arguments" });
          continue;
        }

        if (toolCall.function.name === "tax_law_search") {
          const query = args.query;
          if (!query) {
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: missing query" });
            continue;
          }

          sendEvent("search_start", { queries: [query], step: "discovery" });
          console.log(`[Step 1] Discovery search: "${query}"`);

          const { results, timeMs } = await discoverySearch(query);
          totalSearchTimeMs += timeMs;

          const sources = results.map((r) => ({
            title: r.title,
            url: r.url,
            date: r.publishedDate,
            author: r.author,
            crawlDate: r.crawlDate,
          }));
          discoverySources.push(...sources);

          sendEvent("search_complete", {
            searchTimeMs: timeMs,
            totalSources: results.length,
            step: "discovery",
            searches: [{ query, sources }],
            discoverySources: [...discoverySources],
          });

          console.log(`[Step 1] Found ${results.length} results in ${timeMs}ms`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Discovery search results (${results.length} results, ${timeMs}ms):\n${formatDiscoveryResults(results)}`,
          });
        } else if (toolCall.function.name === "fetch_fresh_content") {
          const urls = args.urls;
          if (!urls || !Array.isArray(urls) || urls.length === 0) {
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: missing urls" });
            continue;
          }

          sendEvent("search_start", {
            queries: urls.map((u) => {
              try { return `Refreshing: ${new URL(u).hostname}`; } catch { return u; }
            }),
            step: "refresh",
          });
          console.log(`[Step 3] Fetching fresh content for ${urls.length} URLs`);

          const { results, timeMs } = await fetchFreshContents(urls);
          totalSearchTimeMs += timeMs;

          const refreshedSources = results.map((r) => ({ title: r.title, url: r.url, crawlDate: r.crawlDate }));
          livecrawledSources.push(...refreshedSources);

          // The URLs the agent chose to re-fetch are the "narrowed" sources
          const narrowedFromRefresh = urls.map((u) => {
            const discovered = discoverySources.find((d) => d.url === u);
            return discovered || { url: u, title: u };
          });
          narrowedSources.push(...narrowedFromRefresh);

          sendEvent("search_complete", {
            searchTimeMs: timeMs,
            totalSources: results.length,
            step: "refresh",
            searches: [{
              query: `Fresh content (${results.length} URLs)`,
              sources: refreshedSources,
            }],
            livecrawledSources: [...livecrawledSources],
            narrowedSources: [...narrowedSources],
          });

          console.log(`[Step 3] Fetched ${results.length} fresh results in ${timeMs}ms`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Fresh content results (${results.length} URLs, ${timeMs}ms):\n${formatFreshResults(results)}`,
          });
        } else {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Unknown tool: ${toolCall.function.name}`,
          });
        }
      }
    }

    sendEvent("done", {
      exaUsed: discoverySources.length > 0,
      searchTimeMs: totalSearchTimeMs,
      totalSources: discoverySources.length,
      discoverySources,
      narrowedSources,
      livecrawledSources,
    });
    res.end();
  } catch (err) {
    console.error("[Stream] Error:", err.message);
    sendEvent("error", { error: friendlyError(err.message) });
    res.end();
  }
}
