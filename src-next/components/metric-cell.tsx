interface MetricCellProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "accent" | "ok" | "warn" | "danger";
  align?: "left" | "right";
}

function toneClassName(tone: MetricCellProps["tone"]): string {
  switch (tone) {
    case "accent":
      return "metric-accent";
    case "ok":
      return "metric-ok";
    case "warn":
      return "metric-warn";
    case "danger":
      return "metric-danger";
    default:
      return "";
  }
}

export function MetricCell({
  label,
  value,
  detail,
  tone = "default",
  align = "left",
}: MetricCellProps) {
  const classes = ["metric-cell", toneClassName(tone), align === "right" ? "metric-right" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </div>
  );
}
