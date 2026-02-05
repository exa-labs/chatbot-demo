import OpenAI from "openai";
import Exa from "exa-js";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPEN_ROUTER_KEY,
});

const exa = new Exa(process.env.EXA_API_KEY);

const DEFAULT_MODEL = "google/gemini-2.5-flash";

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

async function searchExa(query, category, maxAgeOverride, numResults = 5) {
  const searchParams = {
    numResults: Math.min(50, Math.max(3, numResults)),
    text: true,
    type: "auto",
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

  if (!response.results || response.results.length === 0) {
    return [];
  }

  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    text: r.text?.slice(0, 1500),
    publishedDate: r.publishedDate,
    author: r.author,
  }));
}

async function searchMultiple(searches) {
  const searchPromises = searches.map(async ({ query, category, maxAgeOverride, numResults = 5 }) => {
    const startTime = Date.now();
    try {
      const results = await searchExa(query, category, maxAgeOverride, numResults);
      const timeMs = Date.now() - startTime;
      return { query, category, results, timeMs };
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
Use this when writing queries about "upcoming", "recent", "current", or time-relative events.

WHEN TO SEARCH:
- Current events, recent news, specific facts/stats
- "latest/newest/current" anything
- Company/product info, prices, people's current roles
- Anything that changes over time
- Product features, API endpoints, service capabilities, documentation
- Specific tools, platforms, or services (their features evolve)
- Pricing, plans, or offerings from any company/service
- Quotes from specific people (search to find their actual words)
- Comparisons between AI models, tech products, or services (capabilities evolve rapidly)

WHEN NOT TO SEARCH:
- General knowledge, coding help, creative writing
- Opinions, hypotheticals, well-established historical facts
- Static lists (all US presidents, all countries, historical events)
- Definitions of general concepts (NOT product-specific features)
- Generic comparisons of abstract concepts (but DO search for specific product/model comparisons)

PARTIAL SEARCH - CRITICAL:
When a query mixes static knowledge with time-sensitive information, ONLY search for the time-sensitive parts:
- "List all US presidents and their current rankings" -> Answer the president list from knowledge, ONLY search for rankings
- "What are React hooks and what's new in 2026?" -> Explain hooks from knowledge, ONLY search for 2026 updates
- "Name every NBA team and their current standings" -> List teams from knowledge, ONLY search for standings
Your training data contains comprehensive knowledge of history, science, geography, etc. Use it. Only search when you genuinely need current/recent information.

WRITING QUERIES:
Exa is semantic/neural, not keyword-based. Write natural language queries.
Always use the correct year based on today's date:
- "2024 NFL draft picks" (when asking about upcoming 2026 draft) - WRONG
- "2026 NFL draft projections and mock drafts" - CORRECT
- "TSLA stock price" (keyword style) - WRONG
- "Tesla current stock performance and price" - CORRECT

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

CHARTS - When data is numeric and comparative, include a chart block:
Use charts for: stock prices, rankings, comparisons, statistics, polls, market share, trends over time.
Do NOT use charts for: general news, explanations, single facts, non-numeric info.

Format (place AFTER your prose response):
\`\`\`chart
{"type":"bar","title":"Chart Title","labels":["A","B","C"],"data":[10,20,30]}
\`\`\`

Types: "bar", "line", "pie", "doughnut"
- bar/line: for comparisons, rankings, trends
- pie/doughnut: for market share, distributions (parts of whole)

CHART BEST PRACTICES:
- Use descriptive, compelling titles (not just "Data" - say "NFL Coach of the Year Odds" or "Market Share by Company")
- Keep labels SHORT (abbreviate if needed: "Minnesota" -> "MIN", "Microsoft" -> "MSFT")
- Order data meaningfully: rank by value (highest to lowest) or chronologically for trends
- For percentages, ensure they add to 100 for pie/doughnut
- Round numbers for cleaner display (89.7% -> 90%, $1,234,567 -> $1.2M)
- Limit to 5-8 data points max for readability - combine smaller values into "Other" if needed
- For line charts showing trends, use consistent time intervals
- Be thoughtful about scale - the graph needs to show change over time and thus you must pick time range and axis scaling that is appropriate for good visualization
`;
};

const searchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: `Search the web via Exa. Write queries as natural language (not keywords).

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
              query: { type: "string", description: "Natural language query. Use correct year for time-relative questions." },
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { message, history = [], exaEnabled = true, model = DEFAULT_MODEL } = req.body;
    console.log(`[Stream] Request received - model: ${model}, exaEnabled: ${exaEnabled}`);

    const recentHistory = history.slice(-20).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt(exaEnabled) },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const stream = await client.chat.completions.create({
      model,
      messages,
      tools: exaEnabled ? [searchTool] : undefined,
      stream: true,
    });

    let toolCalls = [];
    let contentBuffer = "";
    let assistantMessage = { role: "assistant", content: null, tool_calls: null };

    for await (const chunk of stream) {
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
    }

    if (toolCalls.length === 0) {
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

        if (searches && !Array.isArray(searches)) {
          searches = [searches];
        }

        if (!searches && args.query) {
          searches = [{ query: args.query, numResults: args.numResults }];
        }

        if (Array.isArray(searches)) {
          const validSearches = searches.filter(s => s && typeof s.query === 'string' && s.query.trim());
          allSearches.push(...validSearches);
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
    const searchResults = await searchMultiple(allSearches);
    const searchTimeMs = Date.now() - searchStart;
    const totalSources = searchResults.reduce((acc, s) => acc + s.results.length, 0);
    console.log(`Exa found ${totalSources} sources in ${searchTimeMs}ms`);

    sendEvent("search_complete", {
      searchTimeMs,
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

    const finalStream = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        assistantMessage,
        ...toolMessages,
      ],
      stream: true,
    });

    for await (const chunk of finalStream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        sendEvent("content", { content });
      }
    }

    sendEvent("done", { exaUsed: true, searchTimeMs, totalSources });
    res.end();

  } catch (err) {
    console.error(err);
    sendEvent("error", { error: err.message });
    res.end();
  }
}
