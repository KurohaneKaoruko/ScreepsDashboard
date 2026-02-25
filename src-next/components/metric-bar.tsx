interface MetricBarProps {
  label: string;
  value: string;
  percent?: number;
  className?: string;
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export function MetricBar({ label, value, percent, className }: MetricBarProps) {
  const safePercent = clampPercent(percent);
  const mergedClassName = className ? `metric-bar ${className}` : "metric-bar";

  return (
    <div className={mergedClassName}>
      <div className="metric-bar-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="metric-track" aria-hidden>
        <span className="metric-fill" style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}
