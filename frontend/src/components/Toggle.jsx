import React, { useState } from "react";

/**
 * Simple Toggle component with two options
 */
export function Toggle({ options = ["Toggle1", "Toggle2"], value, onChange, className = "" }) {
  const [selected, setSelected] = useState(value || options[0]);

  const handleSelect = (option) => {
    setSelected(option);
    onChange?.(option);
  };

  return (
    <div
      className={`border-exa-gray-300 inline-flex items-center gap-2 rounded-md border bg-white p-1 ${className} `}
    >
      {options.map((option) => (
        <button
          key={option}
          onClick={() => handleSelect(option)}
          className={`h-6 rounded px-1.5 py-0.5 text-xs font-medium transition-all duration-200 ${
            selected === option ? "bg-gray-200 text-black" : "text-gray-400 hover:text-gray-600"
          } `}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * Elevated Toggle with shadow and animated background
 */
export function ToggleElevated({
  options = ["Toggle1", "Toggle2", "Toggle3"],
  tooltips = {},
  value,
  onChange,
  className = "",
}) {
  const [selected, setSelected] = useState(value || options[0]);
  const [hoveredOption, setHoveredOption] = useState(null);
  const selectedIndex = options.indexOf(selected);

  const handleSelect = (option) => {
    setSelected(option);
    onChange?.(option);
  };

  // Calculate width percentage based on number of options
  const optionWidth = 100 / options.length;
  const translateX = selectedIndex * 100;

  return (
    <div
      className={`bg-exa-gray-100 relative inline-flex items-center gap-2 rounded-lg p-1 ${className} `}
      style={{
        boxShadow: "inset 0.5px 1px 2px 0px #e0d7c1",
      }}
    >
      {/* Animated background */}
      <div
        className="shadow-toggle-elevated absolute bottom-1.5 top-1.5 rounded bg-white transition-all duration-200 ease-out"
        style={{
          width: `calc(${optionWidth}% - 8px)`,
          left: `calc(${selectedIndex * optionWidth}% + 4px)`,
        }}
      />

      {options.map((option) => {
        return (
          <div key={option} className="relative">
            <button
              onClick={() => handleSelect(option)}
              onMouseEnter={() => setHoveredOption(option)}
              onMouseLeave={() => setHoveredOption(null)}
              className={`relative z-10 whitespace-nowrap rounded px-5 py-1.5 text-sm tracking-tight transition-opacity duration-200 ${
                selected === option ? "text-black" : "text-black opacity-70 hover:opacity-100"
              } `}
            >
              {option}
            </button>
            {/* Tooltip */}
            {hoveredOption === option && tooltips[option] && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 z-50 mt-2.5 whitespace-nowrap rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#60646c]"
                style={{
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
                }}
              >
                {tooltips[option]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default Toggle;
