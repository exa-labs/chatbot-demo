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
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "csk-ctnvpnrpxw5t244c83c84pdecwk9tpfdp3jkvece9kve248x",
});

// Default model
const DEFAULT_MODEL = "gpt-oss-120b";

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
            description: "1-3 searches to run in parallel. Use multiple searches with 5 results each for complex queries needing comprehensive coverage.",
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

  // Match JSON objects containing reasoning-specific keys
  const reasoningPattern = /\{[^{}]*"(?:search_query|search|cursor|topn|source|num_lines|loc|query)"[^{}]*\}/g;
  let lastEnd = -1;
  let m;
  while ((m = reasoningPattern.exec(content)) !== null) {
    lastEnd = m.index + m[0].length;
  }

  if (lastEnd >= 0 && lastEnd < content.length) {
    let answer = content.slice(lastEnd);
    // Clean remaining text reasoning markers
    answer = answer.replace(/\[Results\][^\n]*/g, '');
    answer = answer.replace(/Search results?:\s*\n?/gi, '');
    answer = answer.trim();
    if (answer.length > 0) return answer;
  }

  return content;
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

    // Stream first call to detect tool calls while streaming
    const stream = await client.chat.completions.create({
      model,
      messages,
      tools: exaEnabled ? [getSearchTool()] : undefined,
      stream: true,
      reasoning_format: "hidden",
    });

    // Accumulate tool calls and content from stream
    let toolCalls = [];
    let contentBuffer = "";
    let assistantMessage = { role: "assistant", content: null, tool_calls: null };

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Stream content immediately
      if (delta?.content) {
        contentBuffer += delta.content;
        sendEvent("content", { content: delta.content });
      }

      // Accumulate tool calls
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

    // No tool calls - we already streamed the response
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
    const searchResults = await searchMultiple(allSearches);
    const searchTimeMs = Date.now() - searchStart;
    const totalSources = searchResults.reduce((acc, s) => acc + s.results.length, 0);
    console.log(`Exa found ${totalSources} sources in ${searchTimeMs}ms`);

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

    // Stream the final response
    const finalStream = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        assistantMessage,
        ...toolMessages,
      ],
      stream: true,
      reasoning_format: "hidden",
    });

    // Buffer the full response — gpt-oss-120b mixes reasoning artifacts
    // (JSON search/cursor objects, internal monologue) with the actual answer.
    let fullContent = "";
    for await (const chunk of finalStream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullContent += content;
      }
    }

    const cleanedContent = cleanReasoningArtifacts(fullContent);
    if (cleanedContent) {
      sendEvent("content", { content: cleanedContent });
    }

    sendEvent("done", { exaUsed: true, searchTimeMs, totalSources });
    res.end();

  } catch (err) {
    console.error(err);
    sendEvent("error", { error: err.message });
    res.end();
  }
});

// Non-streaming endpoint (kept for compatibility)
app.post("/api/chat", async (req, res) => {
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
});

const PORT = 3001;
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
