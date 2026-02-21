interface MetricCellProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "accent" | "ok" | "warn" | "danger";
  align?: "left" | "right";
  iconSrc?: string;
  iconClassName?: string;
  className?: string;
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
  iconSrc,
  iconClassName,
  className,
}: MetricCellProps) {
  const classes = ["metric-cell", toneClassName(tone), align === "right" ? "metric-right" : "", className]
    .filter(Boolean)
    .join(" ");
  const labelClasses = ["metric-label", iconSrc ? "metric-label-with-icon" : ""].filter(Boolean).join(" ");
  const iconClasses = ["metric-label-icon", iconClassName].filter(Boolean).join(" ");
  const iconStyle = iconSrc ? { backgroundImage: `url(${iconSrc})` } : undefined;

  return (
    <div className={classes}>
      <span className={labelClasses}>
        {iconSrc ? <span aria-hidden="true" className={iconClasses} style={iconStyle} /> : null}
        <span className="metric-label-text">{label}</span>
      </span>
      <strong className="metric-value">{value}</strong>
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </div>
  );
}
