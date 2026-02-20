"use client";

interface RouteTransitionProps {
  label: string;
  message: string;
}

export function RouteTransition({ label, message }: RouteTransitionProps) {
  const statusText = `${label} ${message}`.trim();

  return (
    <div className="route-transition" role="status" aria-live="polite" aria-label={statusText}>
      <img
        className="route-transition-logo"
        src="/screeps-loader-animated.svg"
        width={562}
        height={86}
        alt=""
        aria-hidden="true"
      />
      <p className="route-transition-a11y">{statusText}</p>
    </div>
  );
}
