import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

// Custom minimal style - no grey highlighting
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
      {open && <div className="border-t border-[#e5e5e5] p-4">{children}</div>}
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
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#e5e5e5] bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-[#60646c] hover:text-[#000911] transition-colors"
          >
            <ArrowLeft size={18} />
            <span>Back to Chat</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-4xl px-6 py-12">
        {/* Title */}
        <h1 className="text-4xl font-bold text-[#000911] mb-4">Chatbot with Web Search</h1>
        <p className="text-xl text-[#60646c] mb-8">Build an AI chatbot that intelligently calls Exa to search the web for real-time information.</p>

        <hr className="my-8 border-[#e5e5e5]" />

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
          <a href="https://github.com/exa-labs/exa-chatbot-demo" target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">
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
          <li><strong>Cost efficient</strong>: Only pay for results you get</li>
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
            <p className="mb-4">Give the model a tool it can call when it needs web information:</p>
            <CodeBlock language="javascript" code={`const searchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web. Use natural language queries.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        numResults: { type: "number", default: 5 },
      },
      required: ["query"],
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

            <Note>In this example, <code className="bg-blue-100 px-1 rounded">category</code> isn't set and <code className="bg-blue-100 px-1 rounded">numResults</code> is fixed at 5. Try letting the LLM determine these parameters dynamically based on the query—add them to your tool definition and let the model decide when a query needs more results or a specific category like <code className="bg-blue-100 px-1 rounded">company</code> or <code className="bg-blue-100 px-1 rounded">research_paper</code>.</Note>
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
- Comparisons between AI models, tech products, or services

WHEN NOT TO SEARCH:
- General knowledge, coding help, creative writing
- Opinions, hypotheticals, well-established historical facts
- Static lists (all US presidents, all countries, historical events)
- Definitions of general concepts (NOT product-specific features)

PARTIAL SEARCH - CRITICAL:
When a query mixes static knowledge with time-sensitive information, ONLY search for the time-sensitive parts:
- "List all US presidents and their current rankings" → Answer the president list from knowledge, ONLY search for rankings
- "What are React hooks and what's new in 2026?" → Explain hooks from knowledge, ONLY search for 2026 updates
Your training data contains comprehensive knowledge. Use it. Only search when you genuinely need current/recent information.

WRITING QUERIES:
Exa is semantic/neural, not keyword-based. Write natural language queries.
Always use the correct year based on today's date:
❌ "TSLA stock price" (keyword style)
✅ "Tesla current stock performance and price"

CATEGORIES - Use sparingly. Most queries should NOT use a category:
- company: ONLY for "what does X company do" or company research
- research_paper: ONLY for academic papers or arxiv
For everything else (news, sports, general questions), DO NOT use a category.

RESPONSE STYLE - MATCH THE USER'S REQUEST:
- "Tell me everything about X" → Give a COMPREHENSIVE deep-dive
- "What is X?" → Give a thorough explanation
- "Quick question: X?" → Be concise
- Start directly with the answer, not "Great question!"

USING SEARCH RESULTS:
When you receive search results, you MUST use them to answer:
- Extract the answer from the sources provided
- Be direct and confident - don't hedge or apologize
- Only say "couldn't find" if you received literally 0 results
- Blend information naturally into flowing prose`} />
            </Accordion>

            <Note>The prompt guides the model on when to search vs answer directly. Customize this based on your chatbot's purpose.</Note>
          </Step>

          <Step number={6} title="Implement the chat flow">
            <p className="mb-4">The core pattern: call the model with the tool available, execute search if requested, then get the final answer:</p>

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
  });

  const assistantMsg = response.choices[0].message;

  // No search needed—return direct answer
  if (!assistantMsg.tool_calls) {
    return assistantMsg.content;
  }

  // Execute search
  const args = JSON.parse(assistantMsg.tool_calls[0].function.arguments);
  const results = await searchExa(args.query, args.numResults);

  // Second call: answer with search context
  messages.push(assistantMsg, {
    role: "tool",
    tool_call_id: assistantMsg.tool_calls[0].id,
    content: JSON.stringify(results),
  });

  const final = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
  });

  return final.choices[0].message.content;
}`} />

            <Note>The model makes two calls only when it decides to search. Direct answers skip the search entirely.</Note>
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
