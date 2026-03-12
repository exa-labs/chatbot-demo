import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronDown, ChevronRight, AlertTriangle, Check, ExternalLink, Copy, ArrowRight, RefreshCw } from "lucide-react";
import { ToggleElevated, CardGalleryItem } from "./components";
import { ChatInputBlue, SuggestionTag } from "./components/ChatInput";
import { PageHeader } from "./components/PageHeader";
import { ASCIIBackground } from "./components/ASCIIBackground";
import Button from "./components/Button";
import Lottie from "lottie-react";
import { getApiPath } from "./lib/basePath";
import exaLogomarkBlue from "./assets/exa-logomark-blue.svg";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend);

// Default suggestion tags - defined outside component to prevent recreation
const DEFAULT_SUGGESTIONS = [
  "What's trending in tech today?",
  "What are the top AI startups in 2026?",
  "What did Elon Musk say this week?",
  "Find recent research on AGI safety",
  "What's the current Bitcoin price?",
];

function App() {
  const [chats, setChats] = useState([{ id: Date.now(), title: "New Chat", messages: [] }]);
  const [currentChatId, setCurrentChatId] = useState(chats[0].id);
  const [isLoading, setIsLoading] = useState(false);
  const [exaEnabled, setExaEnabled] = useState(true);
  const [followups, setFollowups] = useState([]);
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [searchType, setSearchType] = useState("auto");
  const messagesEndRef = useRef(null);

  const currentChat = chats.find(c => c.id === currentChatId) || chats[0];
  const messages = currentChat.messages;

  const setMessages = (updater) => {
    setChats(prev => prev.map(chat =>
      chat.id === currentChatId
        ? { ...chat, messages: typeof updater === 'function' ? updater(chat.messages) : updater }
        : chat
    ));
  };

  const createNewChat = () => {
    const newChat = { id: Date.now(), title: "New Chat", messages: [] };
    setChats(prev => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    setFollowups([]);
  };

  const updateChatTitle = (chatId, firstMessage) => {
    const title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? "..." : "");
    setChats(prev => prev.map(chat =>
      chat.id === chatId ? { ...chat, title } : chat
    ));
  };

  // Debounced scroll for smoother experience
  const scrollTimeoutRef = useRef(null);
  const isUserAtBottomRef = useRef(true);

  const scrollToBottom = (behavior = "instant") => {
    // Check if user is near bottom (within 100px)
    const element = messagesEndRef.current?.parentElement;
    if (element) {
      const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
      isUserAtBottomRef.current = isNearBottom;
    }

    // Only auto-scroll if user is at bottom
    if (isUserAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  };

  const debouncedScroll = () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      // Use instant scroll during streaming for smoothness
      const behavior = isLoading ? "instant" : "smooth";
      scrollToBottom(behavior);
    }, 150);
  };

  useEffect(() => {
    debouncedScroll();
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [messages, isLoading]);

  const handleSubmit = async (message) => {
    if (!message.trim()) return;

    // Update chat title if first message
    if (messages.length === 0) {
      updateChatTitle(currentChatId, message || "New Chat");
    }

    // Add user message
    const userMessage = { role: "user", content: message };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Add placeholder for streaming assistant message
    const assistantMessageId = Date.now();
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, role: "assistant", content: "", streaming: true },
    ]);

    try {
      const response = await fetch(getApiPath("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message,
          history: messages,
          exaEnabled,
          model,
          searchType,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let searches = null;
      let exaUsed = false;
      let searchTimeMs = null;
      let totalSources = null;

      // Batching for smoother streaming
      let contentBuffer = "";
      let batchTimeout = null;
      const BATCH_DELAY = 16; // 16ms batching window (~60fps)

      const flushContentBuffer = () => {
        if (contentBuffer) {
          const bufferedContent = contentBuffer;
          contentBuffer = "";
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: msg.content + bufferedContent }
                : msg
            )
          );
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush any remaining buffered content
          if (batchTimeout) clearTimeout(batchTimeout);
          flushContentBuffer();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7);
            continue;
          }
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            // Handle search_start - mark message as searching and save queries
            if (data.queries) {
              // Flush content buffer before state change
              if (batchTimeout) clearTimeout(batchTimeout);
              flushContentBuffer();

              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, searching: true, queries: data.queries }
                    : msg
                )
              );
            }

            if (data.content) {
              // Batch content updates for smoother streaming
              contentBuffer += data.content;

              if (batchTimeout) clearTimeout(batchTimeout);
              batchTimeout = setTimeout(flushContentBuffer, BATCH_DELAY);
            }

            if (data.searches) {
              searches = data.searches;
              searchTimeMs = data.searchTimeMs;
              totalSources = data.totalSources;
              // Show sources immediately when Exa returns (before LLM streaming starts)
              if (batchTimeout) clearTimeout(batchTimeout);
              flushContentBuffer();
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, searching: false, searchesReady: true, searches: data.searches, totalSources: data.totalSources, searchTimeMs: data.searchTimeMs }
                    : msg
                )
              );
            }

            if (data.exaUsed !== undefined) {
              exaUsed = data.exaUsed;
            }

            if (data.error) {
              throw new Error(data.error);
            }
          }
        }
      }

      // Finalize the message and extract followups
      setMessages((prev) => {
        const updatedMessages = prev.map((msg) => {
          if (msg.id === assistantMessageId) {
            // Extract followups from content
            const followupMatch = msg.content.match(/```followups\s*\n?([\s\S]*?)\n?```/);
            if (followupMatch) {
              try {
                const parsedFollowups = JSON.parse(followupMatch[1].trim());
                setFollowups(parsedFollowups);
              } catch (e) {
                // Failed to parse followups
              }
            }
            return { ...msg, streaming: false, searches, exaUsed, searchTimeMs, totalSources };
          }
          return msg;
        });
        return updatedMessages;
      });
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: `Error: ${error.message}`, error: true, streaming: false }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`relative flex min-h-screen flex-col ${exaEnabled ? "" : "bg-[#dcdce0]"}`}>
      {/* White background when Exa is ON */}
      {exaEnabled && (
        <div className="fixed inset-0 z-0 bg-white" />
      )}

      <PageHeader
        title="Exa Chatbot Demo"
        subtitle="AI chatbot with real-time web search powered by Exa"
        rightContent={
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => {
                  if (isLoading) return;
                  createNewChat();
                }}
                disabled={isLoading}
                className={`p-2 rounded-lg border border-[#e5e5e5] bg-white text-[#60646c] transition-all hover:border-[#0040f0] hover:text-[#0040f0] ${
                  isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                }`}
                title="New conversation"
              >
                <RefreshCw size={14} />
              </button>
            )}
            <SearchTypeDropdown mode={searchType} onChange={setSearchType} disabled={isLoading} />
            <Link to="/tutorial">
              <Button
                variant="default"
                size="sm"
                icon={ArrowRight}
                iconPosition="end"
                className="w-[140px] justify-between"
              >
                How It Works
              </Button>
            </Link>
          </div>
        }
      />

      {/* Chat Area */}
      <main className="relative z-[1] flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {messages.length === 0 ? (
            <EmptyState onSubmit={handleSubmit} suggestions={DEFAULT_SUGGESTIONS} disabled={isLoading} exaEnabled={exaEnabled} />
          ) : (
            <div className="space-y-6">
              {messages.map((msg, i) => (
                <Message key={i} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      {/* Input Area - only show when there are messages */}
      {messages.length > 0 && (
        <footer className="relative z-[1] sticky bottom-0 border-t border-[#e5e5e5] bg-white/80 backdrop-blur-sm">
          <div className="mx-auto max-w-4xl px-6 py-4">
            <ChatInputBlue
              placeholder="Ask about anything on the web..."
              tags={followups.length > 0 ? followups : DEFAULT_SUGGESTIONS}
              onSubmit={handleSubmit}
              disabled={isLoading}
            />
          </div>
        </footer>
      )}
    </div>
  );
}

// Multi-hop search nudges for empty state
const SEARCH_NUDGES = [
  {
    title: "Multi-source Analysis",
    prompt: "Compare the latest climate policies from the US, EU, and China"
  },
  {
    title: "Emerging Trends",
    prompt: `What are the most promising AI safety breakthroughs from ${new Date().getFullYear()}?`
  },
  {
    title: "Market Intelligence",
    prompt: "Which YC-backed startups in autonomous vehicles raised funding this month?"
  }
];

// Empty state component with centered input
function EmptyState({ onSubmit, suggestions, disabled, exaEnabled }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center -mt-8">
      <div className="w-full max-w-4xl mx-auto px-6">
        <div className="rounded-2xl bg-[#fafafa] border border-[#f0f0f0] p-8">
          {/* Search Nudges */}
          {exaEnabled && (
            <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              {SEARCH_NUDGES.map((nudge, i) => (
                <button
                  key={i}
                  onClick={() => onSubmit(nudge.prompt)}
                  disabled={disabled}
                  className="group relative rounded-xl border border-[#e5e5e5] bg-white p-6 text-left transition-all hover:border-[#0040f0] hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="mb-2 text-sm font-medium text-[#60646c]">{nudge.title}</div>
                  <div className="text-sm text-[#000911] group-hover:text-[#0040f0] transition-colors">
                    {nudge.prompt}
                  </div>
                </button>
              ))}
            </div>
          )}

          <ChatInputBlue
            placeholder="Ask about anything on the web..."
            tags={suggestions}
            onSubmit={onSubmit}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

// Search type dropdown: auto / fast / instant
function SearchTypeDropdown({ mode, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const modes = [
    { value: "auto", label: "Auto" },
    { value: "fast", label: "Fast" },
    { value: "instant", label: "Instant" },
  ];

  const current = modes.find(m => m.value === mode) || modes[0];

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] bg-white text-[12px] font-medium text-[#000911] transition-all hover:border-[#0040f0] ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        {current.label}
        <ChevronDown size={12} className={`text-[#60646c] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg border border-[#e5e5e5] bg-white shadow-lg py-1">
          {modes.map(m => (
            <button
              key={m.value}
              onClick={() => { onChange(m.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                mode === m.value
                  ? "font-semibold text-[#0040f0] bg-[#f0f4ff]"
                  : "text-[#000911] hover:bg-[#fafafa]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Extract domain name from URL (e.g., "cnbc" from "https://www.cnbc.com/...")
function getDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.replace('www.', '').split('.');
    return parts[0];
  } catch {
    return '';
  }
}

// Search loading phrases
const SEARCH_PHRASES = [
  "Seeking the highest quality knowledge...",
  "Investigating groundbreaking discoveries...",
  "Foraging through the web...",
  "Initiating a probe...",
  "Sifting through sources...",
  "Rummaging through the web...",
  "Unearthing digital treasures...",
  "Casting a wide net...",
  "Dispatching search party...",
  "Charting unknown territories...",
  "Venturing into the knowledge frontier...",
];

// Get a random search phrase
const getRandomSearchPhrase = () =>
  SEARCH_PHRASES[Math.floor(Math.random() * SEARCH_PHRASES.length)];

// Gradient loader Lottie animation URL
const LOADER_LOTTIE = "https://assets-v2.lottiefiles.com/a/ca974640-116b-11ee-9862-ff8858832394/c8bJzzfgZt.json";

function LoadingRings({ searching = false, queries = [] }) {
  // Pick a random phrase once when searching becomes true
  const [searchPhrase] = useState(getRandomSearchPhrase);
  const [animationData, setAnimationData] = useState(null);
  const displayText = searching ? searchPhrase : "Thinking...";

  // Load Lottie animation
  useEffect(() => {
    fetch(LOADER_LOTTIE)
      .then(res => res.json())
      .then(data => setAnimationData(data))
      .catch(err => console.error("Failed to load animation:", err));
  }, []);

  // If we have queries, show them instead of generic loading text
  if (searching && queries && queries.length > 0) {
    return (
      <div className="animate-message-in space-y-3 max-w-[85%]">
        {queries.map((query, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2.5 animate-pulse"
          >
            <img src={exaLogomarkBlue} alt="Exa" className="h-4 w-4 shrink-0" />
            <span className="text-[13px] text-[#000911]">{query}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="animate-message-in">
      <div className="inline-flex items-center gap-2 px-1 py-2">
        <div className="h-16 w-16">
          {animationData ? (
            <Lottie
              animationData={animationData}
              loop={true}
              style={{ width: 64, height: 64 }}
            />
          ) : (
            <div className="h-16 w-16" />
          )}
        </div>
        <div className="relative">
          {/* Animated transparent bubble background */}
          <div className="absolute inset-0 -inset-x-3 -inset-y-2 rounded-full bg-white/60 backdrop-blur-sm animate-bubble-wave" />
          <span className="relative text-[13px] text-[#60646c] animate-text-flicker flex items-center gap-1.5">
            {displayText}
            {searching && <img src={exaLogomarkBlue} alt="Exa" className="h-3.5 w-auto" />}
          </span>
        </div>
      </div>
    </div>
  );
}

// Search Query Row component - shows Exa queries with expandable sources
function SearchQueryRow({ query, category, sources = [] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-left transition-all hover:border-[#0040f0] hover:bg-white w-full"
      >
        <img src={exaLogomarkBlue} alt="Exa" className="h-4 w-4 shrink-0" />
        <span className="text-[13px] text-[#000911] flex-1">{query}</span>
        {category && (
          <span className="rounded bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-[#60646c]">
            {category}
          </span>
        )}
        {sources.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center -space-x-1">
              {sources.slice(0, 5).map((src, i) => {
                let domain;
                try { domain = new URL(src.url).hostname; } catch { return null; }
                return (
                  <img
                    key={i}
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                    alt=""
                    className="h-3.5 w-3.5 rounded-full border border-white"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                );
              })}
            </div>
            <span className="text-[11px] text-[#60646c]">
              {sources.length} {sources.length === 1 ? 'source' : 'sources'}
            </span>
          </div>
        )}
        {sources.length > 0 && (
          expanded ? (
            <ChevronDown size={16} className="text-[#60646c]" />
          ) : (
            <ChevronRight size={16} className="text-[#60646c]" />
          )
        )}
      </button>

      {expanded && sources.length > 0 && (
        <div className="mt-2 space-y-2 animate-sources-expand">
          {sources.map((source, j) => (
            <a
              key={j}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 rounded-lg border border-[#e5e5e5] bg-[#faf9f8] p-3 transition-colors hover:border-[#d4d4d4]"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${new URL(source.url).hostname}&sz=32`}
                alt=""
                className="mt-0.5 h-4 w-4 shrink-0 rounded"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[#000911]">
                  {source.title || "Untitled"}
                </p>
                <p className="text-[11px] text-[#60646c]">
                  <span className="font-medium text-[#0040f0]">{getDomain(source.url)}</span>
                  {source.date && ` · ${source.date.slice(0, 10)}`}
                  {source.author && ` · ${source.author}`}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Message component
function SourcesFlashBanner({ searches, totalSources }) {
  const total = totalSources || searches.reduce((acc, s) => acc + (s.sources || []).length, 0);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <img src={exaLogomarkBlue} alt="Exa" className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[13px] font-medium text-[#000911]">
        Found {total} source{total !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

function Message({ message }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    // Strip out chart and followup blocks for cleaner copy
    const cleanContent = message.content
      .replace(/```chart[\s\S]*?```/g, '')
      .replace(/```followups[\s\S]*?```/g, '')
      .trim();

    await navigator.clipboard.writeText(cleanContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Show "Thinking..." for initial loading
  if (message.streaming && !message.content && !message.queries && !message.searches) {
    return <LoadingRings searching={false} queries={[]} />;
  }

  // Show "Searching for" with queries during search phase (before Exa returns)
  if (message.streaming && !message.content && !message.searchesReady && message.queries && message.queries.length > 0) {
    return (
      <div className="animate-message-in">
        <div className="inline-flex flex-col gap-2 px-1 py-2">
          <span className="text-[13px] text-[#60646c] mb-1">Searching for</span>
          <div className="space-y-2">
            {message.queries.map((query, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 animate-pulse"
              >
                <img src={exaLogomarkBlue} alt="Exa" className="h-4 w-4 shrink-0" />
                <span className="text-[13px] text-[#000911]">{query}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Flash sources banner when Exa returns but LLM hasn't started streaming yet
  if (message.searchesReady && message.searches && !message.content) {
    return (
      <div className="animate-message-in">
        <SourcesFlashBanner searches={message.searches} searchTimeMs={message.searchTimeMs} totalSources={message.totalSources} />
        <div className="mt-3">
          <LoadingRings searching={false} queries={[]} />
        </div>
      </div>
    );
  }

  return (
    <div className={`animate-message-in ${isUser ? "flex justify-end" : ""}`}>
      <div
        className={`relative max-w-[85%] rounded-[12px] ${
          isUser
            ? "bg-[#000911] px-4 py-3 text-white"
            : message.error
              ? "border border-red-200 bg-red-50 px-5 py-4"
              : "border border-[#e5e5e5] bg-white px-5 py-4 shadow-[var(--shadow-card)]"
        }`}
      >
        {/* Copy button for assistant messages */}
        {!isUser && !message.streaming && (
          <button
            onClick={handleCopy}
            className="absolute right-2 top-2 rounded-md p-1.5 text-[#9ca3af] opacity-0 transition-all hover:bg-[#f4f4f5] hover:text-[#60646c] group-hover:opacity-100"
            title="Copy to clipboard"
          >
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
        )}

        {isUser ? (
          <p className="text-[14px]">{message.content}</p>
        ) : (
          <>
            <MessageContent content={message.content} />

            {/* Search queries at bottom - only show when complete */}
            {!message.streaming && message.searches && message.searches.length > 0 && (
              <div className="mt-4 border-t border-[#e5e5e5] pt-4">
                {message.searches.map((search, i) => (
                  <SearchQueryRow
                    key={i}
                    query={search.query}
                    category={search.category}
                    sources={search.sources || []}
                  />
                ))}
              </div>
            )}

            {/* Exa badge */}
            {message.exaUsed && (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#60646c]">
                <Check size={12} className="text-[#0040f0]" />
                Powered by Exa Search
                <img src={exaLogomarkBlue} alt="Exa" className="ml-0.5 h-3 w-auto" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Code block with copy button
function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded-md bg-[#3a3f4b] p-1.5 text-[#9ca3af] opacity-0 transition-all hover:bg-[#4a4f5b] hover:text-white group-hover:opacity-100"
        title="Copy code"
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: '8px', fontSize: '13px', paddingRight: '3rem' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

// Message content with special formatting for "What Would've Been Wrong" and charts
function MessageContent({ content }) {
  // Extract chart data if present (complete block)
  const chartMatch = content.match(/```chart\s*\n?([\s\S]*?)\n?```/);

  // Remove chart blocks, followup blocks, and partial blocks from display
  let textContent = content
    .replace(/```chart\s*\n?[\s\S]*?\n?```/g, '') // complete chart blocks
    .replace(/```followups\s*\n?[\s\S]*?\n?```/g, '') // complete followup blocks
    .replace(/```chart[\s\S]*$/g, '') // partial chart blocks (still streaming)
    .replace(/```followups[\s\S]*$/g, '') // partial followup blocks (still streaming)
    .trim();

  let chartData = null;
  if (chartMatch) {
    try {
      chartData = JSON.parse(chartMatch[1].trim());
    } catch (e) {
      // Chart JSON not yet complete, don't show error
    }
  }

  // Check for the warning pattern
  const warningMatch = textContent.match(/WITHOUT SEARCH[:\s]*(.+?)(?=WITH SEARCH|$)/is);
  const correctMatch = textContent.match(/WITH SEARCH[:\s]*(.+?)$/is);

  if (warningMatch && correctMatch) {
    const beforeWarning = textContent.split(/WITHOUT SEARCH/i)[0];

    return (
      <div className="prose prose-sm max-w-none text-[14px] text-[#000911]">
        <ReactMarkdown>{beforeWarning}</ReactMarkdown>

        {/* What Would've Been Wrong callout */}
        <div className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <span className="text-[13px] font-medium text-amber-800">What Would've Been Wrong</span>
          </div>
          <p className="text-[13px] text-amber-700">
            {warningMatch[1].trim()}
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Check size={16} className="text-green-600" />
            <span className="text-[13px] font-medium text-green-800">Current Information</span>
          </div>
          <p className="text-[13px] text-green-700">
            {correctMatch[1].trim()}
          </p>
        </div>

        {chartData && <ChartRenderer data={chartData} />}
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none text-[14px] text-[#000911]">
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');
            return inline ? (
              <code className="bg-[#f4f4f5] px-1.5 py-0.5 rounded text-[13px] text-[#0040f0]" {...props}>
                {children}
              </code>
            ) : (
              <CodeBlock code={codeString} language={language} />
            );
          },
          a({ href, children }) {
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#0040f0] hover:underline">{children}</a>;
          },
        }}
      >
        {textContent}
      </ReactMarkdown>
      {chartData && <ChartRenderer data={chartData} />}
    </div>
  );
}

// Chart renderer component
function ChartRenderer({ data }) {
  const { type, title, labels, data: values } = data;

  // Vibrant, distinct colors for pie/doughnut charts
  const pieColors = [
    'rgba(0, 64, 240, 0.85)',
    'rgba(16, 185, 129, 0.85)',
    'rgba(245, 158, 11, 0.85)',
    'rgba(239, 68, 68, 0.85)',
    'rgba(139, 92, 246, 0.85)',
    'rgba(236, 72, 153, 0.85)',
    'rgba(6, 182, 212, 0.85)',
    'rgba(132, 204, 22, 0.85)',
  ];

  // Gradient-style single color for bar charts
  const barColor = 'rgba(0, 64, 240, 0.75)';
  const barHoverColor = 'rgba(0, 64, 240, 0.9)';
  const lineColor = 'rgba(0, 64, 240, 1)';
  const lineFillColor = 'rgba(0, 64, 240, 0.1)';

  const chartData = {
    labels,
    datasets: [{
      label: title,
      data: values,
      backgroundColor: type === 'pie' || type === 'doughnut' ? pieColors : barColor,
      hoverBackgroundColor: type === 'pie' || type === 'doughnut' ? pieColors : barHoverColor,
      borderColor: type === 'line' ? lineColor : type === 'pie' || type === 'doughnut' ? 'white' : 'transparent',
      borderWidth: type === 'line' ? 3 : type === 'pie' || type === 'doughnut' ? 2 : 0,
      tension: 0.4,
      fill: type === 'line',
      ...(type === 'line' && { backgroundColor: lineFillColor }),
      borderRadius: type === 'bar' ? 6 : 0,
      pointBackgroundColor: lineColor,
      pointBorderColor: 'white',
      pointBorderWidth: 2,
      pointRadius: type === 'line' ? 4 : 0,
      pointHoverRadius: type === 'line' ? 6 : 0,
    }],
  };

  // Calculate smart y-axis bounds
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const range = maxValue - minValue;
  const padding = range * 0.1;
  const suggestedMin = minValue > 0 && minValue - padding > 0 ? Math.floor((minValue - padding) / 10) * 10 : 0;
  const suggestedMax = Math.ceil((maxValue + padding) / 10) * 10;

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    animation: {
      duration: 600,
      easing: 'easeOutQuart',
    },
    plugins: {
      legend: {
        display: type === 'pie' || type === 'doughnut',
        position: 'bottom',
        labels: {
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle',
          font: { size: 12 },
        },
      },
      title: {
        display: true,
        text: title,
        font: { size: 15, weight: '600' },
        padding: { bottom: 16 },
        color: '#000911',
      },
      tooltip: {
        backgroundColor: '#000911',
        titleFont: { size: 13, weight: '600' },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: type === 'pie' || type === 'doughnut' ? {} : {
      y: {
        suggestedMin,
        suggestedMax,
        grid: {
          color: 'rgba(0, 0, 0, 0.06)',
        },
        ticks: {
          font: { size: 11 },
          color: '#6b7280',
          padding: 8,
        },
      },
      x: {
        grid: {
          display: false,
        },
        ticks: {
          font: { size: 11 },
          color: '#6b7280',
          padding: 8,
        },
      },
    },
  };

  const ChartComponent = { bar: Bar, line: Line, pie: Pie, doughnut: Doughnut }[type] || Bar;

  return (
    <div className="mt-4 rounded-lg border border-[#e5e5e5] bg-white p-5">
      <div className="max-w-lg mx-auto">
        <ChartComponent data={chartData} options={options} />
      </div>
    </div>
  );
}

export default App;
