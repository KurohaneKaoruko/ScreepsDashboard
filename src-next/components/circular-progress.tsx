import type { CSSProperties } from "react";

interface CircularProgressProps {
  label: string;
  level?: number;
  percent?: number;
  valueText?: string;
  subText?: string;
  ringColor?: string;
  size?: number;
  shrinkPercentSymbol?: boolean;
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatLevel(value: number | undefined): string {
  if (value === undefined) {
    return "N/A";
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toFixed(2);
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return `${value.toFixed(2)}%`;
}

export function CircularProgress({
  label,
  level,
  percent,
  valueText,
  subText,
  ringColor,
  size = 110,
  shrinkPercentSymbol = false,
}: CircularProgressProps) {
  const strokeWidth = Math.max(5, Math.round(size * 0.065));
  const safePercent = clampPercent(percent);
  const radius = (size - strokeWidth * 2) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safePercent / 100);
  const primaryText = valueText ?? formatLevel(level);
  const secondaryText = subText ?? formatPercent(percent);
  const renderPrimaryWithSmallPercent =
    shrinkPercentSymbol &&
    primaryText.endsWith("%") &&
    primaryText.length > 1;
  const primaryTextWithoutPercent = renderPrimaryWithSmallPercent
    ? primaryText.slice(0, -1)
    : primaryText;
  const labelLength = label.length;
  const primaryLength = primaryText.length;
  const secondaryLength = secondaryText.length;
  const labelScale =
    labelLength >= 8 ? 0.065 : labelLength >= 6 ? 0.072 : labelLength >= 5 ? 0.078 : 0.085;
  const primaryScale =
    primaryLength >= 14
      ? 0.09
      : primaryLength >= 12
        ? 0.1
        : primaryLength >= 10
          ? 0.112
          : primaryLength >= 8
            ? 0.128
            : primaryLength >= 6
              ? 0.145
              : 0.168;
  const secondaryScale =
    secondaryLength >= 16
      ? 0.07
      : secondaryLength >= 14
        ? 0.076
        : secondaryLength >= 12
          ? 0.084
          : secondaryLength >= 10
            ? 0.092
            : secondaryLength >= 8
              ? 0.1
              : secondaryLength >= 6
                ? 0.108
                : 0.114;
  const style = {
    "--ring-color": ringColor ?? "var(--accent)",
    "--ring-label-size": `${Math.max(7, Math.round(size * labelScale))}px`,
    "--ring-primary-size": `${Math.max(9, Math.round(size * primaryScale))}px`,
    "--ring-secondary-size": `${Math.max(7, Math.round(size * secondaryScale))}px`,
  } as CSSProperties;

  return (
    <div className="circle-progress" style={style}>
      <div className="circle-progress-shell" style={{ width: `min(100%, ${size}px)`, aspectRatio: "1 / 1" }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size} ${size}`}
          className="circle-progress-svg"
          aria-hidden
        >
          <circle
            className="circle-progress-track"
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={strokeWidth}
          />
          <circle
            className="circle-progress-bar"
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>

        <div className="circle-progress-center">
          <span className="circle-progress-inner-label">{label}</span>
          <strong
            className={
              renderPrimaryWithSmallPercent
                ? "circle-progress-primary circle-progress-primary-small-percent"
                : "circle-progress-primary"
            }
          >
            {renderPrimaryWithSmallPercent ? (
              <>
                <span>{primaryTextWithoutPercent}</span>
                <span className="circle-progress-percent-symbol">%</span>
              </>
            ) : (
              primaryText
            )}
          </strong>
          <span className="circle-progress-sub">{secondaryText}</span>
        </div>
      </div>
    </div>
  );
}
