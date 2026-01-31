import { useState, useRef, useEffect } from "react";
import { ArrowUp, Plus, X, FileText, Code, Cpu, ChevronDown } from "lucide-react";

// Suggestion Tag - exactly from component library
export const SuggestionTag = ({ children, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="rounded-[100px] border border-[#e5e5e5] bg-white px-[12px] py-[8px] shadow-[0px_4px_12px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.03)] transition-colors hover:bg-[#f9f7f7]"
    >
      <p className="text-[12px] text-[#60646c]">{children}</p>
    </button>
  );
};

const MODEL_OPTIONS = [
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google" },
  { value: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI" },
  { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", provider: "Meta" },
  { value: "deepseek/deepseek-chat", label: "DeepSeek Chat", provider: "DeepSeek" },
  { value: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", provider: "Qwen" },
];

// Chat Input with Blue gradient button - from component library
export const ChatInputBlue = ({
  placeholder = "Search anything...",
  tags = [],
  onSubmit,
  disabled = false,
  model = "google/gemini-2.5-flash",
  onModelChange,
  dropdownDirection = "down", // "up" or "down"
}) => {
  const [value, setValue] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [attachedFile, setAttachedFile] = useState(null); // { name, content, type }
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const modelMenuRef = useRef(null);

  // Auto-resize textarea only when content exceeds one line
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "20px"; // Reset to single line
      if (textarea.scrollHeight > 20) {
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
      }
    }
  }, [value]);

  // Reset suggestion index when tags array content changes
  const tagsKey = tags.join('|');
  useEffect(() => {
    setSuggestionIndex(-1);
  }, [tagsKey]);

  // Reset suggestion index when value changes manually
  useEffect(() => {
    if (suggestionIndex >= 0 && value !== tags[suggestionIndex]) {
      setSuggestionIndex(-1);
    }
  }, [value, tags, suggestionIndex]);

  const handleSubmit = () => {
    if (onSubmit && (value.trim() || attachedFile) && !disabled) {
      // Send message and file info separately
      onSubmit(value.trim(), attachedFile);
      setValue("");
      setAttachedFile(null);
      setSuggestionIndex(-1);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Read file content
    const content = await file.text();
    const isCode = /\.(js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|css|html|json|yaml|yml|md|sh|sql)$/i.test(file.name);

    setAttachedFile({
      name: file.name,
      content: content.slice(0, 10000), // Limit to 10k chars
      type: isCode ? 'code' : 'file',
    });

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeAttachment = () => {
    setAttachedFile(null);
  };

  // Close model menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target)) {
        setModelMenuOpen(false);
      }
    };
    if (modelMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelMenuOpen]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "ArrowUp" && tags.length > 0) {
      // Allow cycling if empty or currently showing a suggestion
      const canCycle = !value.trim() || suggestionIndex >= 0;
      if (canCycle) {
        e.preventDefault();
        const newIndex = suggestionIndex <= 0 ? tags.length - 1 : suggestionIndex - 1;
        setSuggestionIndex(newIndex);
        setValue(tags[newIndex]);
      }
    } else if (e.key === "ArrowDown" && tags.length > 0) {
      // Allow cycling if empty or currently showing a suggestion
      const canCycle = !value.trim() || suggestionIndex >= 0;
      if (canCycle) {
        e.preventDefault();
        const newIndex = suggestionIndex < 0 ? 0 : (suggestionIndex + 1) % tags.length;
        setSuggestionIndex(newIndex);
        setValue(tags[newIndex]);
      }
    }
  };

  const handleTagClick = (tag) => {
    setValue(tag);
    setSuggestionIndex(tags.indexOf(tag));
  };

  return (
    <div className="flex w-full max-w-[699px] flex-col items-start gap-[8px]">
      {/* Attached file preview */}
      {attachedFile && (
        <div className="flex w-full items-center gap-2 rounded-[8px] border border-[#e5e7eb] bg-[#f9f7f7] px-3 py-2">
          {attachedFile.type === 'code' ? (
            <Code size={14} className="shrink-0 text-[#0040f0]" />
          ) : (
            <FileText size={14} className="shrink-0 text-[#60646c]" />
          )}
          <span className="flex-1 truncate text-[13px] text-[#000911]">{attachedFile.name}</span>
          <span className="text-[11px] text-[#60646c]">{(attachedFile.content.length / 1000).toFixed(1)}k chars</span>
          <button
            onClick={removeAttachment}
            className="shrink-0 rounded p-1 transition-colors hover:bg-[#e5e5e5]"
          >
            <X size={14} className="text-[#60646c]" />
          </button>
        </div>
      )}

      {/* Input field */}
      <div className="flex w-full items-center gap-2 rounded-[8px] border border-[#e5e7eb] bg-white p-[8px] shadow-[0px_60px_17px_0px_rgba(0,0,0,0),0px_38px_15px_0px_rgba(0,0,0,0),0px_22px_13px_0px_rgba(0,0,0,0.02),0px_10px_10px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.03)]">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.json,.yaml,.yml,.md,.sh,.sql,.txt,.csv,.xml,.log"
          className="hidden"
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none overflow-hidden bg-transparent px-1 text-[14px] text-black outline-none placeholder:text-[#ababa9] disabled:opacity-50"
          style={{ minHeight: "20px", maxHeight: "200px", lineHeight: "20px" }}
        />
        {/* Blue gradient button */}
        <button
          onClick={handleSubmit}
          disabled={disabled || (!value.trim() && !attachedFile)}
          className="gradient-arrow-btn relative flex h-[32px] w-[33px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] shadow-[inset_0px_-1.5px_2px_0px_#638dff,inset_0px_0px_1px_0px_#0043fb,inset_0px_0px_2px_0px_#0043fb,inset_0px_0px_8px_0px_#0043fb,inset_0px_0px_10px_0px_#0043fb] transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          <ArrowUp size={18} className="text-white" />
        </button>
      </div>

      {/* Sub-bar with attach and model buttons */}
      <div className="flex w-full items-center gap-1 px-1">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-[#60646c] transition-colors hover:bg-[#f4f4f5] disabled:opacity-50"
          title="Attach file or code"
        >
          <Plus size={14} />
          <span>Attach</span>
        </button>

        {/* Model selector */}
        <div className="relative" ref={modelMenuRef}>
          <button
            onClick={() => setModelMenuOpen(!modelMenuOpen)}
            disabled={disabled}
            className={`flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] transition-colors disabled:opacity-50 ${
              modelMenuOpen ? "bg-[#f4f4f5] text-[#000911]" : "text-[#60646c] hover:bg-[#f4f4f5]"
            }`}
            title="Select AI model"
          >
            <Cpu size={14} />
            <span>Model</span>
            <ChevronDown size={12} className={`transition-transform ${modelMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {/* Model dropdown menu */}
          {modelMenuOpen && (
            <div
              className={`absolute left-0 z-50 w-[240px] rounded-[6px] border-[0.5px] border-[#e5e5e5] bg-white py-1 ${
                dropdownDirection === "up" ? "bottom-full mb-2" : "top-full mt-2"
              }`}
              style={{
                boxShadow: "0px 10px 15px -3px rgba(0,0,0,0.1), 0px 4px 6px -4px rgba(0,0,0,0.1)",
              }}
            >
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onModelChange?.(option.value);
                    setModelMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors ${
                    model === option.value
                      ? "bg-[#f0f4ff] text-[#0040f0]"
                      : "text-[#000911] hover:bg-[#f4f4f5]"
                  }`}
                >
                  <span className="text-[13px]">{option.label}</span>
                  <span className="text-[11px] text-[#9a9a9a]">{option.provider}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatInputBlue;
