import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { PageHeader } from "./components/PageHeader";

const PAGE_CONTENT_FOR_LLM = `# Chatbot with Web Search

Build an AI chatbot that intelligently calls Exa to search the web for real-time information.

## Overview

In this tutorial, we'll build a chatbot where the model decides when to search. No complex orchestration—just a tool definition and a system prompt. The model handles all the logic.

1. Define a search tool the model can call
2. Use exa.search with text: true to get search results with page contents
3. Let the model decide when to search vs answer from training data

GitHub repo: https://github.com/exa-labs/chatbot-demo

## Why Exa in a chatbot?

Whether you are building an internal chatbot for your employees, a customer-facing chatbot to field questions, or as a personal passion project, imbuing Exa yields massive gains:

1. Model agnostic: Works with OpenAI, Anthropic, or any open-source model
2. Superior search: Faster, more relevant, and more comprehensive than model search calling
3. Always current: Real-time information instead of stale training data
4. Configurable: Exa's model parameters can dynamically be adjusted for any use case

## Get Started

### Step 1: Install dependencies

\`\`\`bash
npm install exa-js openai
\`\`\`

Get your Exa API key from the Exa Dashboard (https://dashboard.exa.ai).

### Step 2: Initialize clients

\`\`\`javascript
import Exa from "exa-js";
import OpenAI from "openai";

const exa = new Exa(process.env.EXA_API_KEY);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
\`\`\`

### Step 3: Define the search tool

Give the model a tool it can call when it needs web information. The tool accepts 1-5 parallel searches:

\`\`\`javascript
const searchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information using Exa.",
    parameters: {
      type: "object",
      properties: {
        searches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              numResults: { type: "number", default: 10 },
              category: {
                type: "string",
                enum: ["company", "people", "research_paper"],
              }
            },
            required: ["query"]
          },
          description: "1-5 searches to run in parallel.",
          maxItems: 5,
        },
      },
      required: ["searches"],
    },
  },
};
\`\`\`

### Step 4: Create the search function

When the model calls the tool, execute an Exa search:

\`\`\`javascript
async function searchExa(query, numResults = 5) {
  const response = await exa.search(query, {
    numResults,
    text: true,
    type: "auto",
  });
  return response.results.map(r => ({
    title: r.title,
    url: r.url,
    text: r.text?.substring(0, 2000),
  }));
}
\`\`\`

Note: We use text: true to get page contents along with search results—no separate scraping needed.

### Step 5: Write the system prompt

The system prompt tells the model when to search. This is one example—adjust for your use case.

### Step 6: Implement the chat flow

The core pattern: call the model with the tool available, execute parallel searches if requested, then stream the final answer:

\`\`\`javascript
async function chat(userMessage) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  // First call: model decides if it needs to search
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools: [searchTool],
    stream: true,
  });

  const assistantMsg = response.choices[0].message;

  // No search needed—return direct answer
  if (!assistantMsg.tool_calls) {
    return assistantMsg.content;
  }

  // Execute parallel searches
  const args = JSON.parse(assistantMsg.tool_calls[0].function.arguments);
  const searchPromises = args.searches.map(s =>
    searchExa(s.query, s.category, s.numResults)
  );
  const allResults = await Promise.all(searchPromises);

  // Second call: answer with search context
  messages.push(assistantMsg, {
    role: "tool",
    tool_call_id: assistantMsg.tool_calls[0].id,
    content: JSON.stringify(allResults.flat()),
  });

  const final = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  return final.choices[0].message.content;
}
\`\`\`

Note: The model can request 1-5 parallel searches for complex queries. Streaming is supported for both the initial response and the final answer.

## Conclusion

That's it! The model now decides when to search, executes Exa queries for real-time information, and synthesizes answers with citations.

Get started with Exa for free: https://dashboard.exa.ai/overview
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

// Code block with copy button
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

// Note component
function Note({ children }) {
  return (
    <div className="my-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <p className="text-[14px] text-blue-800">{children}</p>
    </div>
  );
}

// Accordion component
function Accordion({ title, children }) {
  const [open, setOpen] = useState(false);
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

// Step component
function Step({ number, title, children }) {
  return (
    <div className="relative pl-10 pb-8 border-l-2 border-[#e5e5e5] last:border-l-0 last:pb-0">
      <div className="absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#0040f0] text-white text-sm font-medium">
        {number}
      </div>
      <h3 className="text-lg font-semibold text-[#000911] mb-3">{title}</h3>
      <div className="text-[#60646c]">{children}</div>
    </div>
  );
}

export default function Tutorial() {
  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        title="Chatbot with Web Search"
        subtitle="Build an AI chatbot that intelligently calls Exa to search the web for real-time information"
        rightContent={
          <Link
            to="/"
            className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-5 py-2.5 text-[14px] font-medium text-[#000911] hover:border-[#0040f0] hover:text-[#0040f0] transition-colors shadow-sm"
          >
            <ArrowLeft size={16} />
            <span>Back to Chat</span>
          </Link>
        }
      />

      {/* Content */}
      <main className="mx-auto max-w-4xl px-6 py-12">

        {/* Intro */}
        <p className="text-[16px] text-[#000911] mb-6">
          In this tutorial, we'll build a chatbot where the model decides when to search. No complex orchestration—just a tool definition and a system prompt. The model handles all the logic.
        </p>

        <ol className="list-decimal list-inside mb-6 text-[#000911] space-y-2">
          <li>Define a search tool the model can call</li>
          <li>Use <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">exa.search</code> with <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]">text: true</code> to get search results with page contents</li>
          <li>Let the model decide when to search vs answer from training data</li>
        </ol>

        <p className="text-[16px] text-[#000911] mb-8">
          Check out the{" "}
          <a href="https://github.com/exa-labs/chatbot-demo" target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">
            GitHub repo
          </a>{" "}
          for the complete implementation.
        </p>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* Why Exa */}
        <h2 className="text-2xl font-bold text-[#000911] mb-4">Why Exa in a chatbot?</h2>
        <p className="text-[16px] text-[#000911] mb-4">
          Whether you are building an internal chatbot for your employees, a customer-facing chatbot to field questions, or as a personal passion project, <em>imbuing Exa yields massive gains:</em>
        </p>

        <ol className="list-decimal list-inside mb-8 text-[#000911] space-y-2">
          <li><strong>Model agnostic</strong>: Works with OpenAI, Anthropic, or any open-source model</li>
          <li><strong>Superior search</strong>: Faster, more relevant, and more comprehensive than model search calling</li>
          <li><strong>Always current</strong>: Real-time information instead of stale training data</li>
          <li><strong>Configurable</strong>: Exa's model parameters can dynamically be adjusted for any use case</li>
        </ol>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* Get Started */}
        <h2 className="text-2xl font-bold text-[#000911] mb-6">Get Started</h2>

        <div className="space-y-0">
          <Step number={1} title="Install dependencies">
            <CodeBlock language="bash" code="npm install exa-js openai" />

            <p className="my-4">
              Get your Exa API key from the{" "}
              <a href="https://dashboard.exa.ai" target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">
                Exa Dashboard
              </a>.
            </p>

            <Note>You'll also need an API key from your model provider (OpenAI, OpenRouter, etc.).</Note>
          </Step>

          <Step number={2} title="Initialize clients">
            <CodeBlock language="javascript" code={`import Exa from "exa-js";
import OpenAI from "openai";

const exa = new Exa(process.env.EXA_API_KEY);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`} />
          </Step>

          <Step number={3} title="Define the search tool">
            <p className="mb-4">Give the model a tool it can call when it needs web information. The tool accepts 1-5 parallel searches:</p>
            <CodeBlock language="javascript" code={`const searchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: \`Search the web via Exa. Write queries as natural language.

RESULT COUNT - Choose based on query complexity:
- Simple factual query (price, score, single fact): numResults = 5
- Normal query (news, what someone said, general info): numResults = 10
- Complex query needing depth: use multiple searches with numResults = 10 each

CATEGORIES - Use sparingly:
- company: ONLY for "what does X company do" or company research
- people: ONLY for non-public figures (finding someone's LinkedIn)
- research_paper: ONLY for academic papers or arxiv

For news, sports, general facts, quotes - DO NOT use a category.\`,
    parameters: {
      type: "object",
      properties: {
        searches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              query: { type: "string" },
              numResults: { type: "number", default: 10 },
              category: {
                type: "string",
                enum: ["company", "people", "research_paper"],
              }
            },
            required: ["query"]
          },
          description: "1-5 searches to run in parallel.",
          maxItems: 5,
        },
      },
      required: ["searches"],
    },
  },
};`} />
          </Step>

          <Step number={4} title="Create the search function">
            <p className="mb-4">When the model calls the tool, execute an Exa search:</p>
            <CodeBlock language="javascript" code={`async function searchExa(query, numResults = 5) {
  const response = await exa.search(query, {
    numResults,
    text: true,
    type: "auto",
  });
  return response.results.map(r => ({
    title: r.title,
    url: r.url,
    text: r.text?.substring(0, 2000),
  }));
}`} />

            <Note>We use <code className="bg-blue-100 px-1 rounded">text: true</code> to get page contents along with search results—no separate scraping needed.</Note>
          </Step>

          <Step number={5} title="Write the system prompt">
            <p className="mb-4">The system prompt tells the model when to search. This is one example—adjust for your use case:</p>

            <Accordion title="View full system prompt">
              <CodeBlock language="text" code={`You are a helpful assistant with access to web search via Exa.

TODAY'S DATE: [current date]
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
- "List all US presidents and their current rankings" → Answer the president list from knowledge, ONLY search for rankings
- "What are React hooks and what's new in 2026?" → Explain hooks from knowledge, ONLY search for 2026 updates
- "Name every NBA team and their current standings" → List teams from knowledge, ONLY search for standings
Your training data contains comprehensive knowledge. Use it. Only search when you genuinely need current/recent information.

WRITING QUERIES:
Exa is semantic/neural, not keyword-based. Write natural language queries.
Always use the correct year based on today's date:
❌ "2024 NFL draft picks" (when asking about upcoming 2026 draft)
✅ "2026 NFL draft projections and mock drafts"
❌ "TSLA stock price" (keyword style)
✅ "Tesla current stock performance and price"

FOLLOW-UP QUERIES - USE CONVERSATION CONTEXT:
Before writing any search query, scan the recent conversation for the specific topic.
When the user uses referential language, expand it:
- "competitors" → include the specific product/company being discussed
- "how do I set it up" → include what "it" refers to
- "similar offerings" → include the domain/category from context
The user assumes you remember what you're talking about. Your queries should reflect that.

CATEGORIES - Use sparingly. Most queries should NOT use a category:
- company: ONLY for "what does X company do" or company research
- people: ONLY for biographical profiles of NON-PUBLIC figures (e.g., finding a specific professional's LinkedIn). NEVER use for public figures, quotes, interviews, or news about someone
- research_paper: ONLY for academic papers or arxiv
For everything else (news, sports, general questions, quotes from people), DO NOT use a category.

RESPONSE STYLE - MATCH THE USER'S REQUEST:
- "Tell me everything about X" → Give a COMPREHENSIVE deep-dive with all available information
- "What is X?" → Give a thorough explanation
- "Quick question: X?" → Be concise
- "Summarize X" → Be brief
- Start directly with the answer, not "Great question!" or restating the question
- Use clear formatting with bullet points or numbered lists when helpful

FOLLOW USER REQUESTS EXACTLY:
- If user asks for "everything" or comprehensive info → provide thorough, detailed coverage
- If user asks for quotes → give ACTUAL quotes with attribution, never paraphrase
- If user asks for "the top 5" → give exactly 5 items
- If user asks about a specific person/topic → focus on that topic fully

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
❌ "Rankings aren't always readily available in public articles"
✅ "I searched for presidential rankings but found Trump approval polls instead. The C-SPAN Historians Survey typically ranks presidents - let me know if you'd like me to search for that specifically."
Never vaguely hedge. Either answer from sources OR specifically explain what the sources contained vs what was requested.

"What Would've Been Wrong" - When search reveals something different from your training:
⚠️ WITHOUT SEARCH: [What you would have said]
✓ WITH SEARCH: [What the current data shows]
Only include this callout when there's a meaningful difference.

CHARTS - When data is numeric and comparative, include a chart block:
Use charts for: stock prices, rankings, comparisons, statistics, polls, market share, trends over time.
Do NOT use charts for: general news, explanations, single facts, non-numeric info.

Format (place AFTER your prose response):
\\\`\\\`\\\`chart
{"type":"bar","title":"Chart Title","labels":["A","B","C"],"data":[10,20,30]}
\\\`\\\`\\\`

Types: "bar", "line", "pie", "doughnut"
- bar/line: for comparisons, rankings, trends
- pie/doughnut: for market share, distributions (parts of whole)

FOLLOW-UP SUGGESTIONS - Always include at the very end of your response:
\\\`\\\`\\\`followups
["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]
\\\`\\\`\\\``} />
            </Accordion>

            <Note>The prompt guides the model on when to search vs answer directly. Customize this based on your chatbot's purpose.</Note>
          </Step>

          <Step number={6} title="Implement the chat flow">
            <p className="mb-4">The core pattern: call the model with the tool available, execute parallel searches if requested, then stream the final answer:</p>

            <CodeBlock language="javascript" code={`async function chat(userMessage) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  // First call: model decides if it needs to search
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools: [searchTool],
    stream: true,
  });

  const assistantMsg = response.choices[0].message;

  // No search needed—return direct answer
  if (!assistantMsg.tool_calls) {
    return assistantMsg.content;
  }

  // Execute parallel searches
  const args = JSON.parse(assistantMsg.tool_calls[0].function.arguments);
  const searchPromises = args.searches.map(s =>
    searchExa(s.query, s.category, s.numResults)
  );
  const allResults = await Promise.all(searchPromises);

  // Second call: answer with search context
  messages.push(assistantMsg, {
    role: "tool",
    tool_call_id: assistantMsg.tool_calls[0].id,
    content: JSON.stringify(allResults.flat()),
  });

  const final = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
    stream: true,
  });

  return final.choices[0].message.content;
}`} />

            <Note>The model can request 1-5 parallel searches for complex queries. Streaming is supported for both the initial response and the final answer.</Note>
          </Step>
        </div>

        <hr className="my-8 border-[#e5e5e5]" />

        {/* Conclusion */}
        <p className="text-[16px] text-[#000911] mb-6">
          That's it! The model now decides when to search, executes Exa queries for real-time information, and synthesizes answers with citations.
        </p>

        <p className="text-[16px] text-[#000911]">
          Get started with{" "}
          <a href="https://dashboard.exa.ai/overview" target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">
            Exa for free
          </a>.
        </p>
      </main>
    </div>
  );
}
