import { Link } from "react-router-dom";
import { getAssetPath } from "../lib/basePath";

export function PageHeader({ title, subtitle, rightContent }) {
  return (
    <header className="relative z-[1] bg-white py-6 md:py-8">
      <div className="mx-auto max-w-7xl px-6 md:px-12 lg:px-20">
        <div className="flex items-start justify-between">
          {/* Left side - Logo and Title */}
          <div>
            <Link to="/" className="mb-4 flex items-center gap-2">
              <img src={getAssetPath("/exa-logomark-blue.svg")} alt="Exa" className="h-7 w-7" />
              <span className="text-[18px] font-medium text-[#000911]">exa</span>
            </Link>
            <h1 className="font-[family-name:var(--font-family-arizona)] text-3xl md:text-4xl tracking-tight text-[#000911] mb-2">
              {title}
            </h1>
            <p className="text-[#60646c] text-[16px] md:text-[17px]">
              {subtitle}
            </p>
          </div>

          {/* Right side - Custom content */}
          {rightContent && (
            <div className="flex items-center gap-4">
              {rightContent}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
