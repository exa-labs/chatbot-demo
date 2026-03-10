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
const DEFAULT_MODEL = "llama3.1-8b";

/**
 * Attempt to parse a tool call from content text that the model output
 * instead of using the structured tool_calls field.
 * Handles multiple malformed JSON formats from llama3.1-8b.
 * Returns { name, arguments } or null.
 */
function tryExtractToolCallFromContent(content) {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;

  // Try 1: Direct JSON.parse
  try {
    const parsed = JSON.parse(trimmed);
    let name = parsed.name;
    let args = parsed.arguments || parsed.parameters;
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

  // Try 2: Regex extraction for malformed JSON (unescaped inner quotes, etc.)
  const nameMatch = trimmed.match(/"name"\s*:\s*"([^"]+)"/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  if (name !== "web_search") return null;

  const queries = [];
  const queryRegex = /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = queryRegex.exec(trimmed)) !== null) {
    queries.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
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

// Streaming endpoint
app.post("/api/chat/stream", async (req, res) => {
  // Set up SSE
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

    // Helper: stream a completion and extract tool calls + content
    async function streamAndParse() {
      const s = await client.chat.completions.create({
        model,
        messages,
        tools: exaEnabled ? [getSearchTool()] : undefined,
        stream: true,
      });

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
    let { toolCalls, contentBuffer } = await streamAndParse();
    if (toolCalls.length === 0 && !contentBuffer.trim()) {
      console.log("[Stream] Empty response from model, retrying once...");
      ({ toolCalls, contentBuffer } = await streamAndParse());
    }

    let assistantMessage = { role: "assistant", content: null, tool_calls: null };

    if (toolCalls.length === 0) {
      if (contentBuffer) {
        sendEvent("content", { content: contentBuffer });
      }
      sendEvent("done", { exaUsed: false });
      return res.end();
    }

    assistantMessage.content = contentBuffer || null;
    assistantMessage.tool_calls = toolCalls;

    // Collect searches with defensive parsing for different model formats
    const allSearches = [];
    const toolCallIds = [];
    for (const toolCall of toolCalls) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        let searches = args.searches;

        if (typeof searches === 'string') {
          try { searches = JSON.parse(searches); } catch (_) {}
        }

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

    // Stream the final response, filtering out any tool call JSON the model leaks
    const finalStream = await client.chat.completions.create({
      model,
      messages: [
        ...messages,
        assistantMessage,
        ...toolMessages,
      ],
      stream: true,
    });

    let finalBuffer = "";
    let streaming = false;
    for await (const chunk of finalStream) {
      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;
      if (streaming) {
        sendEvent("content", { content });
        continue;
      }
      finalBuffer += content;
      const trimmed = finalBuffer.trimStart();
      if (trimmed.startsWith("{")) {
        if (trimmed.includes("}") && trimmed.indexOf("}") < trimmed.length - 1) {
          const afterJson = trimmed.slice(trimmed.lastIndexOf("}") + 1);
          const cleaned = afterJson.replace(/^\s*assistant\s*/i, "").trimStart();
          if (cleaned) {
            sendEvent("content", { content: cleaned });
          }
          streaming = true;
        }
        continue;
      }
      const cleaned = trimmed.replace(/^\s*assistant\s*/i, "").trimStart();
      if (cleaned) {
        sendEvent("content", { content: cleaned });
      }
      streaming = true;
    }
    if (!streaming && finalBuffer) {
      const trimmed = finalBuffer.trim();
      if (!trimmed.startsWith("{")) {
        sendEvent("content", { content: trimmed });
      }
    }

    sendEvent("done", { exaUsed: true, searchTimeMs, totalSources });
    res.end();

  } catch (err) {
    console.error(err);
    sendEvent("error", { error: err.message });
    res.end();
  } finally {
    clearInterval(heartbeatInterval);
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

    // llama3.1-8b sometimes outputs tool calls as content text
    let toolCallsList = choice.message.tool_calls;
    let choiceMessage = choice.message;
    if (!toolCallsList && choice.message.content) {
      const extracted = tryExtractToolCallFromContent(choice.message.content);
      if (extracted) {
        toolCallsList = [{
          id: "manual_tool_call_0",
          type: "function",
          function: extracted,
        }];
        choiceMessage = { role: "assistant", content: null, tool_calls: toolCallsList };
      }
    }

    if (!toolCallsList) {
      return res.json({ content: choice.message.content, searches: null, exaUsed: false });
    }

    const allSearches = [];
    const toolCallIds = [];
    for (const toolCall of toolCallsList) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        let searches = args.searches;

        if (typeof searches === 'string') {
          try { searches = JSON.parse(searches); } catch (_) {}
        }

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
        choiceMessage,
        ...toolMessages,
      ],
    });

    let finalContent = finalResponse.choices[0].message.content || "";
    const trimmedFinal = finalContent.trimStart();
    if (trimmedFinal.startsWith("{") && trimmedFinal.includes("}")) {
      const afterJson = trimmedFinal.slice(trimmedFinal.lastIndexOf("}") + 1);
      finalContent = afterJson.replace(/^\s*assistant\s*/i, "").trim();
    } else {
      finalContent = trimmedFinal.replace(/^\s*assistant\s*/i, "").trimStart();
    }

    res.json({
      content: finalContent,
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
