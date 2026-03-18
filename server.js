import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { searchMultiple } from "./exa.js";
import { getSystemPrompt } from "./prompt.js";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPEN_ROUTER_KEY,
});

// Default model
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const getSearchTool = () => {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return {
    type: "function",
    function: {
      name: "web_search",
      description: `Search the web via Exa. Today is ${today}. Write queries as natural language (not keywords).

RESULT COUNT:
- Default: numResults = 5 (use this for most queries)
- Complex queries needing depth: use multiple focused searches with numResults = 5 each

CATEGORIES - Use sparingly:
- company: ONLY for "what does X company do" or company research
- people: RARELY use this. Only for finding biographical info on non-public figures (e.g. someone's LinkedIn). NEVER for public figures, quotes, interviews, or news. When you DO use people category, you MUST also include a second search with the same query but WITHOUT the people category, so you get both profile and general web results.
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
            description: "1-3 searches to run in parallel. Use multiple searches with 5 results each for complex queries needing comprehensive coverage.",
            maxItems: 3,
          },
        },
        required: ["searches"],
      },
    },
  };
};

/** Map raw SDK/provider errors to user-friendly messages. */
function friendlyError(msg) {
  if (/JSON error injected into SSE stream/i.test(msg)) {
    return "The AI model returned an invalid response. Please try again.";
  }
  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(msg)) {
    return "The request timed out. Please try again.";
  }
  if (/rate limit|429/i.test(msg)) {
    return "Rate limited \u2014 please wait a moment and try again.";
  }
  if (/5\d{2}|server error|internal error/i.test(msg)) {
    return "The AI service encountered an error. Please try again.";
  }
  return msg;
}

/**
 * Iterate an OpenAI streaming response, invoking `onChunk` for each chunk.
 * On transient SSE errors, retries once by calling `createStream` again.
 */
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

// Streaming endpoint
app.post("/api/chat/stream", async (req, res) => {
  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { message, history = [], exaEnabled = true, model = DEFAULT_MODEL, searchType = "auto" } = req.body;
    console.log(`[Stream] Request received - model: ${model}, exaEnabled: ${exaEnabled}, searchType: ${searchType}`);

    const recentHistory = history.slice(-20).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt(exaEnabled) },
      ...recentHistory,
      { role: "user", content: message },
    ];

    let toolCalls = [];
    let contentBuffer = "";
    let assistantMessage = { role: "assistant", content: null, tool_calls: null };

    await consumeStreamWithRetry(
      () => client.chat.completions.create({
        model,
        messages,
        tools: exaEnabled ? [getSearchTool()] : undefined,
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
      { onRetry: () => { toolCalls = []; contentBuffer = ""; } }
    );

    if (toolCalls.length === 0) {
      sendEvent("done", { exaUsed: false });
      return res.end();
    }

    // Build assistant message for tool call flow
    assistantMessage.content = contentBuffer || null;
    assistantMessage.tool_calls = toolCalls;

    // Collect searches with defensive parsing for different model formats
    const allSearches = [];
    const toolCallIds = [];
    for (const toolCall of toolCalls) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        let searches = args.searches;

        // Handle case where model returns a single search object instead of array
        if (searches && !Array.isArray(searches)) {
          searches = [searches];
        }

        // Handle case where model returns query directly in args
        if (!searches && args.query) {
          searches = [{ query: args.query, numResults: args.numResults }];
        }

        if (Array.isArray(searches)) {
          // Filter out invalid searches (missing query)
          const validSearches = searches.filter(s => s && typeof s.query === 'string' && s.query.trim());
          allSearches.push(...validSearches);
        }
        toolCallIds.push(toolCall.id);
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e.message);
        toolCallIds.push(toolCall.id);
      }
    }

    // If no valid searches, return without searching
    if (allSearches.length === 0) {
      console.log("No valid searches extracted from tool calls");
      sendEvent("done", { exaUsed: false });
      return res.end();
    }

    // Send search start event
    sendEvent("search_start", { queries: allSearches.map(s => s.query) });

    console.log(`Searching: ${allSearches.map(s => `${s.query}${s.category ? ` [${s.category}]` : ""} (${s.numResults || 10} results)`).join(", ")}`);
    const searchStart = Date.now();
    const searchResults = await searchMultiple(allSearches, searchType);
    const searchTimeMs = Date.now() - searchStart;
    const totalSources = searchResults.reduce((acc, s) => acc + s.results.length, 0);
    console.log(`Exa found ${totalSources} sources in ${searchTimeMs}ms (type: ${searchType})`);

    // Send search complete event
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

    // Format results for the model
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

    await consumeStreamWithRetry(
      () => client.chat.completions.create({
        model,
        messages: [
          ...messages,
          assistantMessage,
          ...toolMessages,
        ],
        stream: true,
      }),
      (chunk) => {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          sendEvent("content", { content });
        }
      }
    );

    sendEvent("done", { exaUsed: true, searchTimeMs, totalSources });
    res.end();

  } catch (err) {
    console.error("[Stream] Error:", err.message);
    sendEvent("error", { error: friendlyError(err.message) });
    res.end();
  }
});

// Non-streaming endpoint (kept for compatibility)
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], exaEnabled = true, model = DEFAULT_MODEL, searchType = "auto" } = req.body;

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
    });

    const choice = response.choices[0];

    if (!choice.message.tool_calls) {
      return res.json({ content: choice.message.content, searches: null, exaUsed: false });
    }

    // Collect searches with defensive parsing
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

    console.log(`Searching: ${allSearches.map(s => `${s.query}${s.category ? ` [${s.category}]` : ""} (${s.numResults || 10} results)`).join(", ")}`);
    const searchStart = Date.now();
    const searchResults = await searchMultiple(allSearches, searchType);
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
    });

    res.json({
      content: finalResponse.choices[0].message.content,
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
});

const PORT = 3001;
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
