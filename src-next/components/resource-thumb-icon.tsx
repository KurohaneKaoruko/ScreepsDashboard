import Image from "next/image";
import { useState } from "react";
import { getResourceMeta, getResourceThumbnailUrl } from "../lib/screeps/resource-meta";

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

export interface ResourceThumbIconProps {
  resourceType: string;
  size?: number;
  className?: string;
  title?: string;
}

export function ResourceThumbIcon({
  resourceType,
  size = 34,
  className,
  title,
}: ResourceThumbIconProps) {
  const meta = getResourceMeta(resourceType);
  const resolvedTitle = title ?? `${meta.displayName} (${meta.code})`;
  const [loadFailed, setLoadFailed] = useState(false);
  const thumbnailUrl = getResourceThumbnailUrl(resourceType);

  return (
    <span
      className={classNames("resource-thumb-icon-wrap", className)}
      role="img"
      aria-label={resolvedTitle}
      title={resolvedTitle}
      style={{ width: size, height: size }}
    >
      {loadFailed ? (
        <span className="resource-thumb-icon-fallback" aria-hidden="true">
          {fallbackGlyph(meta.code)}
        </span>
      ) : (
        <Image
          className="resource-thumb-icon-image"
          src={thumbnailUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          unoptimized
          onError={() => {
            setLoadFailed(true);
          }}
        />
      )}
    </span>
  );
}
