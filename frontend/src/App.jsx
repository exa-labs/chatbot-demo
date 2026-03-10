import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronDown, ChevronUp, ChevronRight, AlertTriangle, Check, ExternalLink, Copy, ArrowRight } from "lucide-react";
import { ToggleElevated, CardGalleryItem } from "./components";
import { ChatInputBlue, SuggestionTag } from "./components/ChatInput";
import { PageHeader } from "./components/PageHeader";
import { ASCIIBackground } from "./components/ASCIIBackground";
import Button from "./components/Button";
import Lottie from "lottie-react";
import { getApiPath } from "./lib/basePath";
import exaLogomarkBlue from "./assets/exa-logomark-blue.svg";
import cerebrasLogo from "./assets/cerebras-logo.svg";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend);

const DEFAULT_SUGGESTIONS = [
  "What's trending in tech today?",
  "What are the top AI startups in 2026?",
  "What did Elon Musk say this week?",
  "Find recent research on AGI safety",
  "What's the current Bitcoin price?",
];

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
    title: "AI & Robotics Fundraises",
    prompt: "What are the most recent relevant fundraises in AI and robotics?"
  }
];

// Stream a request to one pane and update its state
async function streamPane({ message, history, exaEnabled, exaMode, assistantId, setMessages, setLoading, setLatency }) {
  const startTime = Date.now();
  let searches = null;
  let searchTimeMs = null;
  let totalSources = null;

  try {
    const truncatedHistory = history
      .filter(m => m.role === "user" || (m.role === "assistant" && m.content))
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    const response = await fetch(getApiPath("/api/chat/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: truncatedHistory,
        exaEnabled,
        exaMode: exaEnabled ? exaMode : undefined,
        model: "llama3.1-8b",
      }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let contentBuffer = "";
    let batchTimeout = null;

    const flushContent = () => {
      if (contentBuffer) {
        const c = contentBuffer;
        contentBuffer = "";
        setMessages(prev => prev.map(msg =>
          msg.id === assistantId ? { ...msg, content: msg.content + c } : msg
        ));
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (batchTimeout) clearTimeout(batchTimeout);
        flushContent();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }

        if (data.queries) {
          if (batchTimeout) clearTimeout(batchTimeout);
          flushContent();
          setMessages(prev => prev.map(msg =>
            msg.id === assistantId ? { ...msg, searching: true, queries: data.queries } : msg
          ));
        }

        if (data.content) {
          contentBuffer += data.content;
          if (batchTimeout) clearTimeout(batchTimeout);
          batchTimeout = setTimeout(flushContent, 16);
        }

        if (data.searches) {
          searches = data.searches;
          searchTimeMs = data.exaServerTimeMs || data.searchTimeMs;
          totalSources = data.totalSources;
          // Show sources immediately when Exa returns (before LLM streaming starts)
          if (batchTimeout) clearTimeout(batchTimeout);
          flushContent();
          setMessages(prev => prev.map(msg =>
            msg.id === assistantId ? { ...msg, searching: false, searchesReady: true, searches: data.searches, totalSources: data.totalSources, searchTimeMs: data.exaServerTimeMs || data.searchTimeMs } : msg
          ));
        }

        if (data.exaUsed !== undefined) {
          const totalMs = Date.now() - startTime;
          if (exaEnabled && data.exaUsed) {
            const cerebrasMs = (data.initialCallMs || 0) + (data.finalCallMs || 0);
            // Use Exa's server-side processing time (like instant extension) for more accurate latency
            const exaMs = data.exaServerTimeMs || data.searchTimeMs || searchTimeMs || 0;
            setLatency({
              totalMs,
              exaMs,
              cerebrasMs: cerebrasMs || (totalMs - exaMs),
            });
          } else {
            setLatency({ totalMs: data.totalMs || totalMs });
          }
        }

        if (data.error) throw new Error(data.error);
      }
    }

    // Finalize message
    setMessages(prev => prev.map(msg => {
      if (msg.id === assistantId) {
        return { ...msg, streaming: false, searches, exaUsed: exaEnabled && !!searches, searchTimeMs, totalSources };
      }
      return msg;
    }));
  } catch (error) {
    console.error("Stream error:", error);
    const totalMs = Date.now() - startTime;
    if (!exaEnabled) setLatency({ totalMs });
    setMessages(prev => prev.map(msg =>
      msg.id === assistantId
        ? { ...msg, content: `Error: ${error.message}`, error: true, streaming: false }
        : msg
    ));
  } finally {
    setLoading(false);
  }
}

function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [exaMode, setExaMode] = useState("instant");

  // Left pane (without Exa)
  const [leftMessages, setLeftMessages] = useState([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [leftLatency, setLeftLatency] = useState(null);

  // Right pane (with Exa)
  const [rightMessages, setRightMessages] = useState([]);
  const [rightLoading, setRightLoading] = useState(false);
  const [rightLatency, setRightLatency] = useState(null);

  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);

  // Auto-scroll both panes
  useEffect(() => {
    if (leftScrollRef.current) {
      const el = leftScrollRef.current;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
  }, [leftMessages]);

  useEffect(() => {
    if (rightScrollRef.current) {
      const el = rightScrollRef.current;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
  }, [rightMessages]);

  const handleSubmit = async (message) => {
    if (!message.trim() || leftLoading || rightLoading) return;
    setHasStarted(true);
    setLeftLatency(null);
    setRightLatency(null);

    const leftHistory = [...leftMessages];
    const rightHistory = [...rightMessages];

    const userMsg = { role: "user", content: message };
    const leftId = Date.now();
    const rightId = leftId + 1;

    setLeftMessages(prev => [...prev, userMsg, { id: leftId, role: "assistant", content: "", streaming: true }]);
    setRightMessages(prev => [...prev, userMsg, { id: rightId, role: "assistant", content: "", streaming: true }]);
    setLeftLoading(true);
    setRightLoading(true);

    await Promise.allSettled([
      streamPane({
        message,
        history: leftHistory,
        exaEnabled: false,
        exaMode: null,
        assistantId: leftId,
        setMessages: setLeftMessages,
        setLoading: setLeftLoading,
        setLatency: setLeftLatency,
      }),
      streamPane({
        message,
        history: rightHistory,
        exaEnabled: true,
        exaMode,
        assistantId: rightId,
        setMessages: setRightMessages,
        setLoading: setRightLoading,
        setLatency: setRightLatency,
      }),
    ]);
  };

  if (!hasStarted) {
    return (
      <div className="flex flex-col min-h-screen bg-white">
        <header className="px-6 py-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-3">
            <img src={exaLogomarkBlue} alt="Exa" className="h-6 w-6" />
            <h1 className="text-xl font-semibold text-[#000911]">Exa Chatbot Demo</h1>
            <span className="text-sm text-[#60646c]">Powered by Cerebras inference</span>
            <img src={cerebrasLogo} alt="Cerebras" className="h-4 w-4" />
          </div>
          <p className="text-sm text-[#9ca3af] mt-1">Model: llama3.1-8b &middot; Side-by-side comparison: with and without Exa search</p>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <EmptyState onSubmit={handleSubmit} suggestions={DEFAULT_SUGGESTIONS} disabled={false} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Compact header */}
      <header className="flex items-center gap-3 px-5 py-2.5 border-b border-[#e5e5e5] bg-white shrink-0">
        <img src={exaLogomarkBlue} alt="Exa" className="h-5 w-5" />
        <span className="text-base font-semibold text-[#000911]">Exa Chatbot Demo</span>
        <span className="text-xs text-[#9ca3af]">Cerebras llama3.1-8b</span>
      </header>

      {/* Split panes */}
      <div className="flex flex-1 min-h-0">
        {/* Left Pane - Without Exa */}
        <div className="flex-1 flex flex-col border-r border-[#e5e5e5]">
          <div className="flex items-center justify-between px-4 h-10 bg-[#fafafa] border-b border-[#e5e5e5] shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#d4d4d4]" />
              <span className="text-[13px] font-semibold text-[#000911]">Without Exa</span>
            </div>
            <div className="flex items-center gap-1.5">
              <img src={cerebrasLogo} alt="" className="h-3.5 w-3.5" />
              <span className="text-[11px] text-[#9ca3af]">Cerebras only</span>
            </div>
          </div>

          <div ref={leftScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {leftMessages.map((msg, i) => (
                <Message key={i} message={msg} />
              ))}
            </div>
          </div>

          <LatencyBar latency={leftLatency} side="left" />
        </div>

        {/* Right Pane - With Exa */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 h-10 bg-[#fafafa] border-b border-[#e5e5e5] shrink-0">
            <div className="flex items-center gap-2">
              <img src={exaLogomarkBlue} alt="Exa" className="h-3.5 w-3.5" />
              <span className="text-[13px] font-semibold text-[#000911]">With Exa</span>
            </div>
            <ModeDropdown mode={exaMode} onChange={setExaMode} disabled={rightLoading} />
          </div>

          <div ref={rightScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {rightMessages.map((msg, i) => (
                <Message key={i} message={msg} />
              ))}
            </div>
          </div>

          <LatencyBar latency={rightLatency} side="right" />
        </div>
      </div>

      {/* Bottom Input */}
      <footer className="border-t border-[#e5e5e5] bg-white shrink-0">
        <div className="max-w-2xl mx-auto px-6 py-3">
          <ChatInputBlue
            placeholder="Ask about anything on the web..."
            tags={DEFAULT_SUGGESTIONS}
            onSubmit={handleSubmit}
            disabled={leftLoading || rightLoading}
          />
        </div>
      </footer>
    </div>
  );
}

// Mode dropdown: instant / fast / auto
function ModeDropdown({ mode, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const modes = [
    { value: "instant", label: "Instant" },
    { value: "fast", label: "Fast" },
    { value: "auto", label: "Auto" },
  ];

  const current = modes.find(m => m.value === mode) || modes[0];

  // Close dropdown on outside click
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
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#e5e5e5] bg-white text-[11px] font-medium text-[#000911] transition-all hover:border-[#0040f0] ${
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

// Latency bar styled like Exa highlight extension
function LatencyBar({ latency, side }) {
  if (!latency) return null;

  if (side === "left") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-[#faf9f8] border-t border-[#e5e5e5] shrink-0">
        <img src={cerebrasLogo} alt="" className="h-3.5 w-3.5" />
        <span className="text-[13px] font-medium text-[#000911] tracking-[-0.01em]">
          Responded in <span className="text-[#0040f0] font-semibold">{latency.totalMs.toLocaleString()}ms</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[#faf9f8] border-t border-[#e5e5e5] shrink-0 flex-wrap">
      <div className="flex items-center gap-1.5">
        <img src={exaLogomarkBlue} alt="" className="h-3.5 w-3.5" />
        <span className="text-[13px] font-medium text-[#000911] tracking-[-0.01em]">
          Exa: <span className="text-[#0040f0] font-semibold">{(latency.exaMs || 0).toLocaleString()}ms</span>
        </span>
      </div>
      <span className="text-[#d4d4d4]">&middot;</span>
      <div className="flex items-center gap-1.5">
        <img src={cerebrasLogo} alt="" className="h-3.5 w-3.5" />
        <span className="text-[13px] font-medium text-[#000911] tracking-[-0.01em]">
          Cerebras: <span className="text-[#0040f0] font-semibold">{(latency.cerebrasMs || 0).toLocaleString()}ms</span>
        </span>
      </div>
      <span className="text-[#d4d4d4]">&middot;</span>
      <span className="text-[13px] font-medium text-[#000911] tracking-[-0.01em]">
        Total: <span className="text-[#0040f0] font-semibold">{latency.totalMs.toLocaleString()}ms</span>
      </span>
    </div>
  );
}

// Empty state with centered input and suggestion cards
function EmptyState({ onSubmit, suggestions, disabled }) {
  return (
    <div className="w-full max-w-4xl mx-auto px-6">
      <div className="rounded-2xl bg-[#fafafa] border border-[#f0f0f0] p-8">
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

        <ChatInputBlue
          placeholder="Ask about anything on the web..."
          tags={suggestions}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// --- Display components ---

function getDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.replace('www.', '').split('.');
    return parts[0];
  } catch {
    return '';
  }
}

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

const getRandomSearchPhrase = () =>
  SEARCH_PHRASES[Math.floor(Math.random() * SEARCH_PHRASES.length)];

const LOADER_LOTTIE = "https://assets-v2.lottiefiles.com/a/ca974640-116b-11ee-9862-ff8858832394/c8bJzzfgZt.json";

function LoadingRings({ searching = false, queries = [] }) {
  const [searchPhrase] = useState(getRandomSearchPhrase);
  const [animationData, setAnimationData] = useState(null);
  const displayText = searching ? searchPhrase : "Thinking...";

  useEffect(() => {
    fetch(LOADER_LOTTIE)
      .then(res => res.json())
      .then(data => setAnimationData(data))
      .catch(err => console.error("Failed to load animation:", err));
  }, []);

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
          <span className="text-[11px] text-[#60646c]">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </span>
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
                  {source.date && ` \u00b7 ${source.date.slice(0, 10)}`}
                  {source.author && ` \u00b7 ${source.author}`}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Sources banner - shows immediately when Exa returns results (like the instant extension)
function SourcesBanner({ searches, searchTimeMs, totalSources }) {
  const [expanded, setExpanded] = useState(false);
  const total = totalSources || searches.reduce((acc, s) => acc + (s.sources || []).length, 0);
  const allSources = searches.flatMap(s => (s.sources || []).map(src => ({ ...src, query: s.query })));

  return (
    <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-[#f0f0f0] transition-colors cursor-pointer"
      >
        <img src={exaLogomarkBlue} alt="Exa" className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[13px] font-medium text-[#000911] flex-1">
          Exa found {total} source{total !== 1 ? "s" : ""} in{" "}
          <span className="text-[#0040f0] font-semibold">{(searchTimeMs || 0).toLocaleString()}ms</span>
        </span>
        {/* Stacked favicons */}
        <div className="flex items-center -space-x-1.5">
          {allSources.slice(0, 5).map((src, i) => {
            let domain;
            try { domain = new URL(src.url).hostname; } catch { return null; }
            return (
              <img
                key={i}
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
                alt=""
                className="h-4 w-4 rounded-full border border-white"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            );
          })}
        </div>
        {expanded ? <ChevronUp size={14} className="text-[#60646c]" /> : <ChevronDown size={14} className="text-[#60646c]" />}
      </button>
      {expanded && allSources.length > 0 && (
        <div className="border-t border-[#e5e5e5] max-h-[200px] overflow-y-auto">
          {allSources.map((src, i) => {
            let domain;
            try { domain = new URL(src.url).hostname; } catch { domain = src.url; }
            return (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 hover:bg-[#f0f0f0] transition-colors border-b border-[#f0f0f0] last:border-0"
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[#000911]">{src.title || "Untitled"}</p>
                  <p className="text-[10px] text-[#60646c]">{domain}</p>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Message({ message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    const cleanContent = message.content
      .replace(/```chart[\s\S]*?```/g, '')
      .replace(/```followups[\s\S]*?```/g, '')
      .trim();
    await navigator.clipboard.writeText(cleanContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (message.streaming && !message.content && !message.queries && !message.searches) {
    return <LoadingRings searching={false} queries={[]} />;
  }

  // Show searching state with query cards (before Exa returns)
  if (message.streaming && !message.content && !message.searchesReady && message.queries && message.queries.length > 0) {
    return (
      <div className="animate-message-in">
        <div className="inline-flex flex-col gap-2 px-1 py-2">
          <span className="text-[13px] text-[#60646c] mb-1">Searching...</span>
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

  // Show sources immediately when Exa returns (before/during LLM streaming)
  if (message.searchesReady && message.searches && !message.content) {
    return (
      <div className="animate-message-in">
        <SourcesBanner searches={message.searches} searchTimeMs={message.searchTimeMs} totalSources={message.totalSources} />
        <div className="mt-3">
          <LoadingRings searching={false} queries={[]} />
        </div>
      </div>
    );
  }

  return (
    <div className={`animate-message-in ${isUser ? "flex justify-end" : ""}`}>
      <div
        className={`group relative max-w-[95%] rounded-[12px] ${
          isUser
            ? "bg-[#000911] px-4 py-3 text-white"
            : message.error
              ? "border border-red-200 bg-red-50 px-5 py-4"
              : "border border-[#e5e5e5] bg-white px-5 py-4 shadow-[var(--shadow-card)]"
        }`}
      >
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
            {/* Show sources banner at top when available (during or after streaming) */}
            {message.searchesReady && message.searches && message.searches.length > 0 && (
              <div className="mb-3">
                <SourcesBanner searches={message.searches} searchTimeMs={message.searchTimeMs} totalSources={message.totalSources} />
              </div>
            )}

            <MessageContent content={message.content} />

            {/* Legacy source rows at bottom (only if no banner shown) */}
            {!message.searchesReady && !message.streaming && message.searches && message.searches.length > 0 && (
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

function MessageContent({ content }) {
  const chartMatch = content.match(/```chart\s*\n?([\s\S]*?)\n?```/);

  let textContent = content
    .replace(/```chart\s*\n?[\s\S]*?\n?```/g, '')
    .replace(/```followups\s*\n?[\s\S]*?\n?```/g, '')
    .replace(/```chart[\s\S]*$/g, '')
    .replace(/```followups[\s\S]*$/g, '')
    .trim();

  let chartData = null;
  if (chartMatch) {
    try {
      chartData = JSON.parse(chartMatch[1].trim());
    } catch (e) {}
  }

  const warningMatch = textContent.match(/WITHOUT SEARCH[:\s]*(.+?)(?=WITH SEARCH|$)/is);
  const correctMatch = textContent.match(/WITH SEARCH[:\s]*(.+?)$/is);

  if (warningMatch && correctMatch) {
    const beforeWarning = textContent.split(/WITHOUT SEARCH/i)[0];

    return (
      <div className="prose prose-sm max-w-none text-[14px] text-[#000911]">
        <ReactMarkdown>{beforeWarning}</ReactMarkdown>

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

function ChartRenderer({ data }) {
  const { type, title, labels, data: values } = data;

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
