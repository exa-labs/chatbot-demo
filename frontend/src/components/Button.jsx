import React from "react";

/**
 * Button component matching the Exa design system
 */

export default function Button({
  children,
  variant = "default",
  size = "sm",
  icon: Icon,
  iconPosition = "start",
  className = "",
  ...props
}) {
  const variantStyles = {
    default: "bg-white border border-[#e5e5e5] text-black hover:bg-[#f9f7f7] hover:border-[rgba(9,114,213,0.32)] active:bg-[#f9f7f7] active:border-[#e5e5e5]",
  };

  const sizeStyles = {
    sm: "px-3 py-2 text-sm",
    md: "px-3 py-2.5 text-base",
    lg: "px-8 py-3 text-lg",
  };

  const styles = variantStyles[variant] || variantStyles.default;
  const sizeStyle = sizeStyles[size] || sizeStyles.sm;

  const iconElement = Icon && (
    <Icon size={16} />
  );

  return (
    <button
      className={`flex cursor-pointer items-center gap-1 rounded-lg font-medium transition-all duration-200 ${styles} ${sizeStyle} ${className}`}
      {...props}
    >
      {iconPosition === "start" && iconElement}
      {children && <span>{children}</span>}
      {iconPosition === "end" && iconElement}
    </button>
  );
}
