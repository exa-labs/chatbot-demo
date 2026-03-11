import OpenAI from "openai";
import Exa from "exa-js";

const client = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "csk-ctnvpnrpxw5t244c83c84pdecwk9tpfdp3jkvece9kve248x",
});

const exa = new Exa(process.env.EXA_API_KEY);

// Retry wrapper for Cerebras API calls (handles 429 rate limits)
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429 || err?.statusCode === 429 || (err?.message && err.message.includes('429'));
      if (is429 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.log(`[Stream] 429 rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

const DEFAULT_MODEL = "gpt-oss-120b";

/**
 * Attempt to parse a tool call from content text that the model output
 * instead of using the structured tool_calls field.
 * Handles multiple malformed JSON formats from llama3.1-8b.
 * Returns { name, arguments } or null.
 */
function tryExtractToolCallFromContent(content) {
  const trimmed = content.trim();

  // Find the first '{' - model may prefix with "assistant", role text, etc.
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart === -1) return null;
  const jsonCandidate = trimmed.slice(jsonStart);

  // Try 1: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonCandidate);
    let name = parsed.name;
    let args = parsed.arguments || parsed.parameters;
    // Handle {"type": "function", "function": {"name": ..., "arguments": ...}} format
    if (!name && parsed.function) {
      name = parsed.function.name;
      args = parsed.function.arguments || parsed.function.parameters;
    }
    if (name && args) {
      return {
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args),
      };
    }
  } catch (_) {}

  // Try 2: Regex extraction for malformed JSON (unescaped inner quotes, single quotes, etc.)
  const nameMatch = jsonCandidate.match(/["']?name["']?\s*:\s*["']([^"']+)["']/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (name !== "web_search") return null;

  const queries = [];
  // Match query values with both double and single quotes
  const queryRegex = /["']?query["']?\s*:\s*["']((?:[^"'\\]|\\.)*)["']/g;
  let match;
  while ((match = queryRegex.exec(jsonCandidate)) !== null) {
    const q = match[1].replace(/\\["']/g, m => m[1]).replace(/\\\\/g, '\\');
    if (q.trim()) queries.push(q.trim());
  }

  if (queries.length > 0) {
    const searches = queries.map(q => ({ query: q, numResults: 5 }));
    return {
      name,
      arguments: JSON.stringify({ searches }),
    };
  }

  return null;
}

const freshnessDefaults = {
  tweet: 48,
  research_paper: 4320,
  default: 336
};

const noDateFilterCategories = new Set(["company", "people"]);

function getStartDate(maxAgeHours) {
  const date = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  return date.toISOString();
}

async function searchExa(query, category, maxAgeOverride, numResults = 5, searchType = "instant") {
  const searchParams = {
    numResults: Math.min(50, Math.max(3, numResults)),
    highlights: {
      maxCharacters: 4000,
    },
    type: searchType,
  };

  if (category) {
    searchParams.category = category;
  }

  if (!category || !noDateFilterCategories.has(category)) {
    const defaultMaxAge = category ? (freshnessDefaults[category] || freshnessDefaults.default) : freshnessDefaults.default;
    const maxAgeHours = maxAgeOverride && maxAgeOverride < defaultMaxAge ? maxAgeOverride : defaultMaxAge;
    searchParams.startPublishedDate = getStartDate(maxAgeHours);
  }

  const response = await exa.searchAndContents(query, searchParams);

  // Exa API returns requestTime (seconds) — convert to ms for latency display
  const exaServerTimeMs = response.requestTime ? Math.round(response.requestTime * 1000) : null;

  if (!response.results || response.results.length === 0) {
    return { results: [], exaServerTimeMs };
  }

  return {
    results: response.results.map((r) => ({
      title: r.title,
      url: r.url,
      text: (r.highlights || []).join("\n").slice(0, 4000),
      publishedDate: r.publishedDate,
      author: r.author,
    })),
    exaServerTimeMs,
  };
}

async function searchMultiple(searches, searchType = "instant") {
  const searchPromises = searches.map(async ({ query, category, maxAgeOverride, numResults = 5 }) => {
    const startTime = Date.now();
    try {
      const { results, exaServerTimeMs } = await searchExa(query, category, maxAgeOverride, numResults, searchType);
      const timeMs = Date.now() - startTime;
      return { query, category, results, timeMs, exaServerTimeMs };
    } catch (err) {
      const timeMs = Date.now() - startTime;
      return { query, category, results: [], error: err.message, timeMs };
    }
  });

  return Promise.all(searchPromises);
}

const getSystemPrompt = (exaEnabled = true) => {
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  if (!exaEnabled) {
    return `You are a helpful assistant. Web search is currently DISABLED.

TODAY'S DATE: ${currentDate}

IMPORTANT: You do NOT have access to web search right now. If the user asks about:
- Current events, recent news, live data
- Stock prices, sports scores, weather
- Anything requiring real-time information

You MUST say something like: "I don't have access to web search right now, so I can't look up current information about [topic]. Based on my training data, I can tell you that... [provide what you know, with the caveat it may be outdated]."

For questions you CAN answer from your training (general knowledge, coding, explanations, historical facts, etc.), answer normally and helpfully.

FOLLOW-UP SUGGESTIONS - Always include at the very end of your response:
\`\`\`followups
["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]
\`\`\``;
  }

  return `You are a helpful assistant with access to web search via Exa.

TODAY'S DATE: ${currentDate}

CRITICAL - TRAINING DATA IS STALE:
Your training data has a knowledge cutoff. You do NOT know what happened after that cutoff.
If the user asks about ANY event, result, outcome, or fact that could have occurred between your training cutoff and today (${currentDate}), you MUST search. Do NOT answer from training data alone.
Examples of things you MUST search for:
- Sports results (Super Bowl, World Series, championships, games)
- Election results, political developments
- Deaths, births, major announcements
- Award winners (Oscars, Grammys, Nobel prizes)
- Product launches, company news
- Any event the user references with a year close to today's date
If you think an event "hasn't happened yet" based on your training, CHECK TODAY'S DATE \u2014 it may have already occurred. ALWAYS search instead of assuming.

WHEN TO SEARCH:
- ANYTHING where your answer might be outdated or wrong due to your training cutoff
- Current events, recent news, specific facts/stats
- "latest/newest/current" anything
- Company/product info, prices, people's current roles
- Anything that changes over time
- Product features, API endpoints, service capabilities, documentation
- Specific tools, platforms, or services (their features evolve)
- Pricing, plans, or offerings from any company/service
- Quotes from specific people (search to find their actual words)
- Comparisons between AI models, tech products, or services (capabilities evolve rapidly)
- Sports outcomes, scores, winners, standings, draft results
- Election or vote results
- Award ceremonies and winners

WHEN NOT TO SEARCH:
- General knowledge, coding help, creative writing
- Opinions, hypotheticals
- Historical facts that are WELL before your training cutoff (e.g., "who won WWII" or "who was the first US president")
- Static lists (all US presidents, all countries)
- Definitions of general concepts (NOT product-specific features)
- Generic comparisons of abstract concepts (but DO search for specific product/model comparisons)

PARTIAL SEARCH - CRITICAL:
When a query mixes static knowledge with time-sensitive information, ONLY search for the time-sensitive parts:
- "List all US presidents and their current rankings" -> Answer the president list from knowledge, ONLY search for "${new Date().getFullYear()} US president rankings"
- "What are React hooks and what's new in ${new Date().getFullYear()}?" -> Explain hooks from knowledge, ONLY search for "${new Date().getFullYear()} React updates"
- "Name every NBA team and their current standings" -> List teams from knowledge, ONLY search for "NBA standings ${currentDate}"
Your training data contains knowledge of history, science, geography, etc. Use it. Only search when you genuinely need current/recent information.

WRITING QUERIES (today is ${currentDate}):
Exa is semantic/neural, not keyword-based. Write natural language queries.
Always use the correct year based on today's date (${currentDate}):
- "2024 NFL draft picks" (wrong year \u2014 check today's date!) - WRONG
- "${new Date().getFullYear()} NFL draft projections and mock drafts" - CORRECT
- "TSLA stock price" (keyword style) - WRONG
- "Tesla current stock price ${new Date().getFullYear()}" - CORRECT
For time-sensitive queries, include the year or month when it helps — but don't force the full date into every query.

FOLLOW-UP QUERIES - USE CONVERSATION CONTEXT:
Before writing any search query, scan the recent conversation for the specific topic.

When the user uses referential language, expand it:
- "competitors" -> include the specific product/company being discussed
- "how do I set it up" -> include what "it" refers to
- "similar offerings" -> include the domain/category from context
- "more about this" -> include the specific subject

CATEGORIES - Use sparingly. Most queries should NOT use a category:
- company: ONLY for "what does X company do" or company research
- people: ONLY for biographical profiles of NON-PUBLIC figures (e.g., finding a specific professional's LinkedIn).
  NEVER use "people" for public figures you already know (Elon Musk, Sam Altman, Ilya Sutskever, etc.)
  NEVER use "people" for quotes, interviews, statements, news, or podcasts about/by someone
- research_paper: ONLY for academic papers or arxiv

For everything else (news, sports, general questions, quotes from people, what someone said), DO NOT use a category. Exa's general search works best for most queries.

RESPONSE STYLE - MATCH THE USER'S REQUEST:
- "Tell me everything about X" -> Give a COMPREHENSIVE deep-dive with all available information
- "What is X?" -> Give a thorough explanation
- "Quick question: X?" -> Be concise
- "Summarize X" -> Be brief
- Start directly with the answer, not "Great question!" or restating the question
- Use clear formatting with bullet points or numbered lists when helpful

FOLLOW USER REQUESTS EXACTLY:
- If user asks for "everything" or comprehensive info -> provide thorough, detailed coverage
- If user asks for quotes -> give ACTUAL quotes with attribution, never paraphrase
- If user asks for "the top 5" -> give exactly 5 items
- If user asks about a specific person/topic -> focus on that topic fully

DO NOT:
- Give sparse responses when the user asked for comprehensive information
- Add unsolicited advice or caveats
- Say "I couldn't find X" if you found related information - share what you found

USING SEARCH RESULTS:
When you receive search results, you MUST use them to answer:
- Extract the answer from the sources provided
- Be direct and confident - don't hedge or apologize
- Only say "couldn't find" if you received literally 0 results
- If sources are imperfect, give the best answer you can with what's available
- Blend information naturally into flowing prose - avoid numbered lists unless the user specifically asks for them

WHEN SOURCES DON'T MATCH THE QUERY:
If the search results don't contain what the user asked for, be SPECIFIC about the mismatch:
- "Rankings aren't always readily available in public articles" - WRONG
- "I searched for presidential rankings but found Trump approval polls instead. The C-SPAN Historians Survey typically ranks presidents - let me know if you'd like me to search for that specifically." - CORRECT

Never vaguely hedge. Either answer from sources OR specifically explain what the sources contained vs what was requested.

"What Would've Been Wrong" - When search reveals something different from your training:
WITHOUT SEARCH: [What you would have said]
WITH SEARCH: [What the current data shows]

Only include this callout when there's a meaningful difference.

CHARTS - Only include charts when the user EXPLICITLY asks for visual data, graphs, or charts.
Do NOT proactively generate charts. Focus on clear, well-written prose responses.
If the user asks for a chart, use this format (place AFTER your prose response):
\`\`\`chart
{"type":"bar","title":"Chart Title","labels":["A","B","C"],"data":[10,20,30]}
\`\`\`
Types: "bar", "line", "pie", "doughnut"
`;
};

const getSearchTool = () => {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return {
    type: "function",
    function: {
      name: "web_search",
      description: `Search the web via Exa. Today is ${today}. Write queries as natural language (not keywords).

RESULT COUNT - Choose based on query complexity:
- Simple factual query (price, score, single fact): numResults = 5
- Normal query (news, what someone said, general info): numResults = 5
- Complex query needing depth (research, comparisons, comprehensive analysis): use multiple searches with numResults = 5 each

CATEGORIES - Use sparingly:
- company: ONLY for "what does X company do" or company research
- people: ONLY for non-public figures (finding someone's LinkedIn). NEVER use for public figures, quotes, interviews, or news about someone
- research_paper: ONLY for academic papers or arxiv

For news, sports, general facts, current events, quotes, interviews, podcasts - DO NOT use a category.`,
      parameters: {
        type: "object",
        properties: {
          searches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                query: { type: "string", description: "Natural language query." },
                numResults: { type: "number", description: "Number of results: 5 for simple, 5 for normal/complex. Default 5.", default: 5 },
                category: {
                  type: "string",
                  enum: ["company", "people", "research_paper"],
                  description: "ONLY use for company info, person bios, or academic papers. Omit for everything else."
                }
              },
              required: ["query"]
            },
            description: "1-3 searches to run in parallel. Use multiple searches with 10 results each for complex queries needing comprehensive coverage.",
            maxItems: 3,
          },
        },
        required: ["searches"],
      },
    },
  };
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send initial SSE comment to establish data flow and prevent connection stall
  res.write(":ok\n\n");

  // Heartbeat to keep SSE connection alive during silent buffering phases
  const heartbeatInterval = setInterval(() => {
    res.write(":heartbeat\n\n");
  }, 3000);

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { message, history = [], exaEnabled = true, model = DEFAULT_MODEL, exaMode = "instant" } = req.body;
    const searchType = exaMode === "fast" ? "keyword" : exaMode || "instant";
    console.log(`[Stream] Request received - model: ${model}, exaEnabled: ${exaEnabled}, exaMode: ${exaMode}`);

    // Truncate assistant messages to avoid overwhelming the 8B model with long context
    const recentHistory = history.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.role === 'assistant' && msg.content && msg.content.length > 500
        ? msg.content.slice(0, 500) + '...'
        : msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt(exaEnabled) },
      ...recentHistory,
      { role: "user", content: message },
    ];

    // Strip leaked model artifacts (followups arrays, tool call JSON, "assistant" prefix)
    function stripLeakedArtifacts(text) {
      return text
        .replace(/\n?followups\s*\[.*$/s, "")          // followups [...] at end
        .replace(/\n?```followups[\s\S]*?```/g, "")    // ```followups ... ```
        .replace(/\{\s*"name"\s*:\s*"web_search"[\s\S]*$/s, "")  // raw tool call JSON
        .replace(/^\s*assistant\s*/i, "")              // stray "assistant" prefix
        .trimEnd();
    }

    // Fast path: direct streaming for non-Exa requests
    if (!exaEnabled) {
      const t0 = Date.now();
      const stream = await withRetry(() => client.chat.completions.create({ model, messages, stream: true }));
      let fullContent = "";
      for await (const chunk of stream) {
        const c = chunk.choices[0]?.delta?.content;
        if (c) fullContent += c;
      }
      const cleaned = stripLeakedArtifacts(fullContent.trimStart());
      if (cleaned) sendEvent("content", { content: cleaned });
      sendEvent("done", { exaUsed: false, totalMs: Date.now() - t0 });
      return res.end();
    }

    // Helper: stream a completion and extract tool calls + content
    async function streamAndParse() {
      const s = await withRetry(() => client.chat.completions.create({
        model,
        messages,
        tools: exaEnabled ? [getSearchTool()] : undefined,
        stream: true,
      }));

      let tc = [];
      let buf = "";

      for await (const chunk of s) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) buf += delta.content;
        if (delta?.tool_calls) {
          for (const call of delta.tool_calls) {
            const idx = call.index;
            if (!tc[idx]) tc[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            if (call.id) tc[idx].id = call.id;
            if (call.function?.name) tc[idx].function.name = call.function.name;
            if (call.function?.arguments) tc[idx].function.arguments += call.function.arguments;
          }
        }
      }

      // Detect tool calls output as content text
      if (tc.length === 0 && buf) {
        const extracted = tryExtractToolCallFromContent(buf);
        if (extracted) {
          tc = [{ id: "manual_tool_call_0", type: "function", function: extracted }];
          buf = "";
        }
      }

      return { toolCalls: tc, contentBuffer: buf };
    }

    // Retry once if model returns empty (llama3.1-8b intermittently returns nothing)
    const initialCallStart = Date.now();
    let { toolCalls, contentBuffer } = await streamAndParse();
    if (toolCalls.length === 0 && !contentBuffer.trim()) {
      console.log("[Stream] Empty response from model, retrying once...");
      ({ toolCalls, contentBuffer } = await streamAndParse());
    }
    const initialCallMs = Date.now() - initialCallStart;

    let assistantMessage = { role: "assistant", content: null, tool_calls: null };

    // If content looks like an undetected tool call, retry once
    if (toolCalls.length === 0 && contentBuffer && contentBuffer.includes("web_search")) {
      console.log("[Stream] Content looks like undetected tool call, retrying...");
      ({ toolCalls, contentBuffer } = await streamAndParse());
    }

    if (toolCalls.length === 0) {
      // Safety net: suppress raw tool-call-shaped JSON from reaching the client
      if (contentBuffer && contentBuffer.trim().startsWith("{") && contentBuffer.includes("web_search")) {
        console.log("[Stream] Suppressing leaked tool call JSON");
        sendEvent("content", { content: "I encountered an issue processing your request. Please try again." });
      } else if (contentBuffer) {
        sendEvent("content", { content: contentBuffer });
      }
      sendEvent("done", { exaUsed: false });
      return res.end();
    }

    assistantMessage.content = contentBuffer || null;
    assistantMessage.tool_calls = toolCalls;

    const allSearches = [];
    const toolCallIds = [];
    for (const toolCall of toolCalls) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        let searches = args.searches;

        if (typeof searches === 'string') {
          try { searches = JSON.parse(searches); } catch (_) {
            // Fallback: Python-style dict with single quotes
            try { searches = JSON.parse(searches.replace(/'/g, '"')); } catch (_2) {
              // Last resort: regex extract queries from the string
              const qr = /["']query["']\s*:\s*["']([^"']+)["']/g;
              let qm; const qMatches = [];
              while ((qm = qr.exec(searches)) !== null) {
                qMatches.push({ query: qm[1].trim(), numResults: 5 });
              }
              if (qMatches.length > 0) searches = qMatches;
            }
          }
        }

        if (searches && !Array.isArray(searches)) {
          searches = [searches];
        }

        if (!searches && args.query) {
          searches = [{ query: args.query, numResults: args.numResults }];
        }

        if (Array.isArray(searches)) {
          const normalized = searches.map(s => {
            if (typeof s === 'string' && s.trim()) return { query: s.trim() };
            if (s && typeof s.query === 'string' && s.query.trim()) return s;
            return null;
          }).filter(Boolean);
          allSearches.push(...normalized);
        }
        toolCallIds.push(toolCall.id);
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e.message);
        toolCallIds.push(toolCall.id);
      }
    }

    if (allSearches.length === 0) {
      console.log("No valid searches extracted from tool calls");
      sendEvent("done", { exaUsed: false });
      return res.end();
    }

    sendEvent("search_start", { queries: allSearches.map(s => s.query) });

    console.log(`Searching: ${allSearches.map(s => `${s.query}${s.category ? ` [${s.category}]` : ""} (${s.numResults || 5} results)`).join(", ")}`);
    const searchStart = Date.now();
    const searchResults = await searchMultiple(allSearches, searchType);
    const searchTimeMs = Date.now() - searchStart;
    const totalSources = searchResults.reduce((acc, s) => acc + s.results.length, 0);
    // Use Exa's server-side processing time (like the instant extension does) for more accurate latency
    const exaServerTimeMs = searchResults.reduce((best, s) => Math.max(best, s.exaServerTimeMs || 0), 0) || null;
    console.log(`Exa found ${totalSources} sources in ${searchTimeMs}ms (server: ${exaServerTimeMs}ms)`);

    sendEvent("search_complete", {
      searchTimeMs,
      exaServerTimeMs,
      totalSources,
      searches: searchResults.map(({ query, category, results, timeMs }) => ({
        query,
        category,
        timeMs,
        sources: results.map(r => ({
          title: r.title,
          url: r.url,
          date: r.publishedDate,
          author: r.author,
        })),
      })),
    });

    const resultsText = searchResults
      .map(({ query, category, results }) => {
        if (results.length === 0) {
          return `[${query}${category ? ` (${category})` : ""}]\nNo results found.`;
        }
        const items = results.map((r) => {
          const date = r.publishedDate ? ` | ${r.publishedDate.slice(0, 10)}` : "";
          return `- ${r.title}${date}\n  ${r.url}\n  ${r.text?.slice(0, 600) || ""}`;
        }).join("\n");
        return `[${query}${category ? ` (${category})` : ""}]\n${items}`;
      })
      .join("\n\n");

    const toolMessages = toolCallIds.map(id => ({
      role: "tool",
      tool_call_id: id,
      content: resultsText,
    }));

    const finalCallStart = Date.now();
    const finalStream = await withRetry(() => client.chat.completions.create({
      model,
      messages: [
        ...messages,
        assistantMessage,
        ...toolMessages,
      ],
      stream: true,
    }));

    // Collect the full final response, then clean and send
    let fullFinal = "";
    for await (const chunk of finalStream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) fullFinal += content;
    }
    // Strip leading JSON blobs (tool call echo), "assistant" prefix, and trailing artifacts
    let trimmed = fullFinal.trimStart();
    if (trimmed.startsWith("{")) {
      // Skip over leading JSON blob
      const lastBrace = trimmed.lastIndexOf("}");
      if (lastBrace >= 0 && lastBrace < trimmed.length - 1) {
        trimmed = trimmed.slice(lastBrace + 1);
      } else {
        trimmed = ""; // entire response is JSON — suppress it
      }
    }
    const cleanedFinal = stripLeakedArtifacts(trimmed.trimStart());
    if (cleanedFinal) {
      sendEvent("content", { content: cleanedFinal });
    }

    const finalCallMs = Date.now() - finalCallStart;
    sendEvent("done", { exaUsed: true, searchTimeMs, exaServerTimeMs, totalSources, initialCallMs, finalCallMs });
    res.end();

  } catch (err) {
    console.error(err);
    sendEvent("error", { error: err.message });
    res.end();
  } finally {
    clearInterval(heartbeatInterval);
  }
}
