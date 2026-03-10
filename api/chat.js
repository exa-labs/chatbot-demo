import OpenAI from "openai";
import Exa from "exa-js";

const client = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "csk-ctnvpnrpxw5t244c83c84pdecwk9tpfdp3jkvece9kve248x",
});

const exa = new Exa(process.env.EXA_API_KEY);

const DEFAULT_MODEL = "gpt-oss-120b";

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
    highlights: {
      maxCharacters: 4000,
    },
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
    text: (r.highlights || []).join("\n").slice(0, 4000),
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
If you think an event "hasn't happened yet" based on your training, CHECK TODAY'S DATE — it may have already occurred. ALWAYS search instead of assuming.

WHEN TO SEARCH:
- ANYTHING where your answer might be outdated or wrong due to your training cutoff
- Current events, recent news, specific facts/stats
- "latest/newest/current" anything
- Company/product info, prices, people's current roles
- Anything that changes over time
- Sports outcomes, scores, winners, standings, draft results
- Election or vote results
- Award ceremonies and winners

WHEN NOT TO SEARCH:
- General knowledge, coding help, creative writing
- Opinions, hypotheticals
- Historical facts that are WELL before your training cutoff (e.g., "who won WWII" or "who was the first US president")

WRITING QUERIES (today is ${currentDate}):
Exa is semantic/neural, not keyword-based. Write natural language queries.
Always use the correct year based on today's date (${currentDate}). For time-sensitive queries, include the year or month when it helps — but don't force the full date into every query.

CATEGORIES - Use sparingly:
- company: ONLY for "what does X company do" or company research
- people: ONLY for biographical profiles of NON-PUBLIC figures
- research_paper: ONLY for academic papers or arxiv

RESPONSE STYLE:
- Start directly with the answer
- Use clear formatting with bullet points or numbered lists when helpful

USING SEARCH RESULTS:
When you receive search results, you MUST use them to answer:
- Extract the answer from the sources provided
- Be direct and confident
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

/**
 * Strips reasoning artifacts from gpt-oss-120b responses.
 * The model embeds JSON search/cursor objects and internal monologue
 * in the content field when processing tool results. The actual answer
 * always follows after the last artifact.
 */
function cleanReasoningArtifacts(content) {
  if (!content) return content;

  // Step 1: Remove citation markers
  let cleaned = content.replace(/[{【]\d+†[^}】]*[}】]/g, '');  // {14†L0-L3} / 【1†L1-L4】
  cleaned = cleaned.replace(/\{\d+\}\[\d+\]/g, '');              // {6}[7]
  cleaned = cleaned.replace(/\[\d+\]/g, '');                      // [1]

  // Step 2: Remove JSON reasoning artifacts (search_query, cursor, etc.)
  const reasoningPattern = /\{[^{}]*"(?:search_query|search|cursor|topn|source|num_lines|loc|query)"[^{}]*\}/g;
  let lastEnd = -1;
  let m;
  while ((m = reasoningPattern.exec(cleaned)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd >= 0 && lastEnd < cleaned.length) {
    cleaned = cleaned.slice(lastEnd);
  }

  // Step 3: Remove text reasoning markers
  cleaned = cleaned.replace(/\[Results\][^\n]*/g, '');
  cleaned = cleaned.replace(/Search results?:\s*\n?/gi, '');

  // Step 4: Ensure **Bold at start of line (model sometimes concatenates reasoning + answer)
  cleaned = cleaned.replace(/([^*\n])\*\*([A-Z])/g, '$1\n**$2');

  // Step 5: Find where the actual formatted answer starts.
  // gpt-oss-120b reasoning = plain text; answer = markdown (bold, tables, headings).
  const boldMatch = cleaned.match(/(?:^|\n)(\*\*[A-Z\u00C0-\u024F][\s\S]*)/);
  if (boldMatch) {
    cleaned = boldMatch[1];
  } else {
    const headingMatch = cleaned.match(/(?:^|\n)(#{1,6}\s[\s\S]*)/);
    if (headingMatch) {
      cleaned = headingMatch[1];
    } else {
      const tableMatch = cleaned.match(/(?:^|\n)(\|[^|]+\|[^|]+\|[\s\S]*)/);
      if (tableMatch) {
        cleaned = tableMatch[1];
      } else {
        const numListMatch = cleaned.match(/(?:^|\n)(\d+\.\s+\*\*[\s\S]*)/);
        if (numListMatch) {
          cleaned = numListMatch[1];
        }
      }
    }
  }

  // Step 6: Clean up whitespace
  cleaned = cleaned.replace(/  +/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned || content;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history = [], exaEnabled = true, model = DEFAULT_MODEL } = req.body;

    const recentHistory = history.slice(-20).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt(exaEnabled) },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: exaEnabled ? [getSearchTool()] : undefined,
      reasoning_format: "hidden",
    });

    const choice = response.choices[0];

    if (!choice.message.tool_calls) {
      return res.json({ content: choice.message.content, searches: null, exaUsed: false });
    }

    const allSearches = [];
    const toolCallIds = [];
    for (const toolCall of choice.message.tool_calls) {
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
      return res.json({ content: "I tried to search but couldn't form a valid query. Please try rephrasing.", searches: null, exaUsed: false });
    }

    console.log(`Searching: ${allSearches.map(s => `${s.query}${s.category ? ` [${s.category}]` : ""} (${s.numResults || 5} results)`).join(", ")}`);
    const searchStart = Date.now();
    const searchResults = await searchMultiple(allSearches);
    const searchTimeMs = Date.now() - searchStart;
    const totalSources = searchResults.reduce((acc, s) => acc + s.results.length, 0);
    console.log(`Exa found ${totalSources} sources in ${searchTimeMs}ms`);

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

    const finalResponse = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        choice.message,
        ...toolMessages,
      ],
      reasoning_format: "hidden",
    });

    const rawContent = finalResponse.choices[0].message.content;
    const cleanedContent = cleanReasoningArtifacts(rawContent);

    res.json({
      content: cleanedContent,
      searches: searchResults.map(({ query, category, results, timeMs }) => ({
        query,
        category,
        timeMs,
        sources: results.map((r) => ({
          title: r.title,
          url: r.url,
          date: r.publishedDate,
          author: r.author,
        })),
      })),
      exaUsed: true,
      searchTimeMs,
      totalSources,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
