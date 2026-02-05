import { useState, useRef, useEffect } from "react";
import { ArrowUp } from "lucide-react";

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

// Chat Input with Blue gradient button - from component library
export const ChatInputBlue = ({
  placeholder = "Search anything...",
  tags = [],
  onSubmit,
  disabled = false,
}) => {
  const [value, setValue] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const textareaRef = useRef(null);

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
    if (onSubmit && value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
      setSuggestionIndex(-1);
    }
  };

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
    <div className="flex w-full flex-col items-start gap-[8px]">
      {/* Input field */}
      <div className="flex w-full items-center gap-2 rounded-[8px] border border-[#e5e7eb] bg-white p-[8px] shadow-[0px_60px_17px_0px_rgba(0,0,0,0),0px_38px_15px_0px_rgba(0,0,0,0),0px_22px_13px_0px_rgba(0,0,0,0.02),0px_10px_10px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.03)]">

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
          disabled={disabled || !value.trim()}
          className="gradient-arrow-btn relative flex h-[32px] w-[33px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] shadow-[inset_0px_-1.5px_2px_0px_#638dff,inset_0px_0px_1px_0px_#0043fb,inset_0px_0px_2px_0px_#0043fb,inset_0px_0px_8px_0px_#0043fb,inset_0px_0px_10px_0px_#0043fb] transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          <ArrowUp size={18} className="text-white" />
        </button>
      </div>

    </div>
  );
};

export default ChatInputBlue;
