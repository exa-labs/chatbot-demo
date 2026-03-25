import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { discoverySearch, fetchFreshContents } from "./exa.js";
import { getSystemPrompt, getSearchTool, getFetchTool } from "./prompt.js";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPEN_ROUTER_KEY,
});

const DEFAULT_MODEL = "google/gemini-2.5-flash";

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

app.post("/api/chat/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { message, history = [], model = DEFAULT_MODEL } = req.body;
    console.log(`[Stream] Request: "${message.slice(0, 80)}..." model: ${model}`);

    const recentHistory = history.slice(-20).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt() },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const tools = [getSearchTool(), getFetchTool()];
    let allSearchSources = [];
    let totalSearchTimeMs = 0;
    let round = 0;
    const MAX_ROUNDS = 3;

    while (round < MAX_ROUNDS) {
      round++;
      let toolCalls = [];
      let contentBuffer = "";

      await consumeStreamWithRetry(
        () => client.chat.completions.create({
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
        { onRetry: () => { toolCalls = []; contentBuffer = ""; } }
      );

      if (toolCalls.length === 0) break;

      const assistantMessage = {
        role: "assistant",
        content: contentBuffer || null,
        tool_calls: toolCalls,
      };
      messages.push(assistantMessage);

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

          const sources = results.map(r => ({
            title: r.title,
            url: r.url,
            date: r.publishedDate,
            author: r.author,
            crawlDate: r.crawlDate,
          }));
          allSearchSources.push(...sources);

          sendEvent("search_complete", {
            searchTimeMs: timeMs,
            totalSources: results.length,
            step: "discovery",
            searches: [{ query, sources }],
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

          sendEvent("search_start", { queries: urls.map(u => { try { return `Refreshing: ${new URL(u).hostname}`; } catch { return u; } }), step: "refresh" });
          console.log(`[Step 3] Fetching fresh content for ${urls.length} URLs`);

          const { results, timeMs } = await fetchFreshContents(urls);
          totalSearchTimeMs += timeMs;

          sendEvent("search_complete", {
            searchTimeMs: timeMs,
            totalSources: results.length,
            step: "refresh",
            searches: [{ query: `Fresh content (${results.length} URLs)`, sources: results.map(r => ({ title: r.title, url: r.url, crawlDate: r.crawlDate })) }],
          });

          console.log(`[Step 3] Fetched ${results.length} fresh results in ${timeMs}ms`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Fresh content results (${results.length} URLs, ${timeMs}ms):\n${formatFreshResults(results)}`,
          });
        } else {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Unknown tool: ${toolCall.function.name}` });
        }
      }
    }

    sendEvent("done", {
      exaUsed: allSearchSources.length > 0,
      searchTimeMs: totalSearchTimeMs,
      totalSources: allSearchSources.length,
    });
    res.end();

  } catch (err) {
    console.error("[Stream] Error:", err.message);
    sendEvent("error", { error: friendlyError(err.message) });
    res.end();
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], model = DEFAULT_MODEL } = req.body;

    const recentHistory = history.slice(-20).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const messages = [
      { role: "system", content: getSystemPrompt() },
      ...recentHistory,
      { role: "user", content: message },
    ];

    const tools = [getSearchTool(), getFetchTool()];
    let allSearchSources = [];
    let totalSearchTimeMs = 0;
    let round = 0;
    const MAX_ROUNDS = 3;

    while (round < MAX_ROUNDS) {
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
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
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
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Unknown tool: ${toolCall.function.name}` });
        }
      }
    }

    res.json({ content: "I encountered an issue processing your request. Please try again.", searches: null, exaUsed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`BlueJ PRA demo server on http://localhost:${PORT}`));
