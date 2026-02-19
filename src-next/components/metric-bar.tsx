interface MetricBarProps {
  label: string;
  value: string;
  percent?: number;
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

export function MetricBar({ label, value, percent }: MetricBarProps) {
  const safePercent = clampPercent(percent);

  return (
    <div className="metric-bar">
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
