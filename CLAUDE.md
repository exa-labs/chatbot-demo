# Exa AI Chatbot

A minimal chatbot demonstrating Exa's web search capabilities. The model decides when to search, decomposes complex queries, and synthesizes answers from real-time web data.

## Architecture

```
/
├── server.js       # Express API server with SSE streaming
├── exa.js          # Exa search client with rate limiting
├── prompt.js       # System prompt (all model behavior)
├── package.json
├── .env            # API keys
└── frontend/       # React UI (Vite)
    └── src/
        ├── App.jsx
        └── components/
            └── ChatInput.jsx
```

## How It Works

### Search Decision Flow

```
User query → Model decides:
  ├─ No search needed → Answer from training
  └─ Search needed → Call web_search tool → Exa fetches sources → Model synthesizes answer
```

The model handles ALL logic. No orchestration code. The system prompt in `prompt.js` controls everything.

### Tool Calling

The model receives a `web_search` tool that accepts 1-3 parallel searches:

```javascript
{
  searches: [
    { query: "natural language query", numResults: 5, category?: "company" }
  ]
}
```

Categories are optional and rarely used:
- `company` - Only for "what does X company do"
- `people` - Only for non-public figures (LinkedIn profiles)
- `research_paper` - Only for academic/arxiv papers

Most queries should NOT use a category.

## Setup

### 1. Clone and install

```bash
git clone <repo>
cd <repo>
npm install
cd frontend && npm install && cd ..
```

### 2. Add API keys to `.env`

```
EXA_API_KEY=your_exa_key
OPEN_ROUTER_KEY=your_model_api_key
```

### 3. Run

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

## Key Files

### server.js

Express server with two endpoints:

- `POST /api/chat/stream` - SSE streaming (primary)
- `POST /api/chat` - Non-streaming (compatibility)

Flow:
1. Receive message + history
2. Call model with `web_search` tool available
3. If model calls tool → run Exa searches → feed results back → stream final response
4. If no tool call → stream direct response

### exa.js

Thin wrapper around Exa's `searchAndContents` API:

- `searchExa(query, category?, maxAgeOverride?, numResults?)` - Single search
- `searchMultiple(searches)` - Sequential searches with rate limiting

Rate limited to 4 req/s to stay under Exa's limits. Applies freshness filters (2 weeks default, 6 months for research papers).

### prompt.js

Single function `getSystemPrompt(exaEnabled)` that returns the complete system prompt.

Key sections:
- **WHEN TO SEARCH** - Current events, news, prices, quotes, product info
- **WHEN NOT TO SEARCH** - General knowledge, coding, historical facts
- **PARTIAL SEARCH** - Mix knowledge + search for hybrid queries
- **WRITING QUERIES** - Natural language, correct year, minimal categories
- **RESPONSE STYLE** - Match user's request scope
- **CHARTS** - Render data as bar/line/pie charts

The prompt also handles the "Exa disabled" case, instructing the model to caveat time-sensitive answers.

### frontend/src/App.jsx

React app with:
- Chat history management
- SSE stream handling
- Source display (collapsible)
- Chart rendering (Chart.js)
- Follow-up suggestions

### frontend/src/components/ChatInput.jsx

Input component with:
- Model selector dropdown
- File attachment support
- Arrow key suggestion cycling

## Key Features

### 1. Exa Toggle

Switch between "Exa Search" and "Model Only" modes. Demonstrates value of real-time search vs. stale training data.

### 2. "What Would've Been Wrong"

When search reveals something different from training data, the model surfaces this:

```
⚠️ WITHOUT SEARCH: [outdated info]
✓ WITH SEARCH: [current data]
```

### 3. Source Attribution

Collapsible section shows:
- Search queries executed
- Sources found with titles, URLs, dates
- Search timing

### 4. Charts

For numeric/comparative data, model outputs chart blocks:

```chart
{"type":"bar","title":"Market Share","labels":["A","B"],"data":[60,40]}
```

Rendered as interactive Chart.js visualizations.

## Extension Points

### Adding Internal Search

The tool system is designed to support multiple search backends:

```javascript
// In server.js, add alongside searchTool:
const internalSearchTool = {
  type: "function",
  function: {
    name: "internal_search",
    description: "Search internal company documents",
    parameters: { /* ... */ }
  }
};

// Pass both tools:
tools: [searchTool, internalSearchTool]
```

Then handle the `internal_search` tool call alongside `web_search`.

### Adding New Models

In `frontend/src/components/ChatInput.jsx`, add to `MODEL_OPTIONS`:

```javascript
{ value: "provider/model-id", label: "Display Name", provider: "Provider" }
```

Model must support tool/function calling.
