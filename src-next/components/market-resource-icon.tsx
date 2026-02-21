import { useState } from "react";
import { getResourceMeta } from "../lib/screeps/resource-meta";

function classNames(baseClass: string, className: string | undefined): string {
  return className ? `${baseClass} ${className}` : baseClass;
}

function fallbackGlyph(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    return "?";
  }

  if (trimmed.length <= 3) {
    return trimmed.toUpperCase();
  }

  if (trimmed.includes("_")) {
    return trimmed
      .split("_")
      .filter((part) => part.length > 0)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("")
      .slice(0, 3);
  }

  return trimmed.slice(0, 3).toUpperCase();
}

export interface MarketResourceIconProps {
  resourceType: string;
  size?: number;
  className?: string;
  title?: string;
}

export function MarketResourceIcon({
  resourceType,
  size = 40,
  className,
  title,
}: MarketResourceIconProps) {
  const meta = getResourceMeta(resourceType);
  const resolvedTitle = title ?? `${meta.displayName} (${meta.code})`;
  const [loadFailed, setLoadFailed] = useState(false);
  const iconScale =
    typeof meta.iconScale === "number" && Number.isFinite(meta.iconScale)
      ? Math.max(0.2, Math.min(meta.iconScale, 4))
      : 1;
  const iconSize = Math.max(10, Math.round(size * iconScale));

  return (
    <span
      className={classNames("market-resource-icon-wrap", className)}
      role="img"
      aria-label={resolvedTitle}
      title={resolvedTitle}
      style={{ width: size, height: size }}
    >
      {loadFailed ? (
        <span className="market-resource-icon-fallback" aria-hidden="true">
          {fallbackGlyph(meta.code)}
        </span>
      ) : (
        <img
          className="market-resource-icon-image"
          src={meta.iconUrl}
          alt=""
          width={iconSize}
          height={iconSize}
          decoding="async"
          loading="lazy"
          style={{ width: iconSize, height: iconSize }}
          onError={() => {
            setLoadFailed(true);
          }}
        />
      )}
    </span>
  );
}
