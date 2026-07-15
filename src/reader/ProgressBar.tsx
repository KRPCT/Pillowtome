/**
 * 2px hairline progress track under the reader toolbar (UI-SPEC).
 * Track uses --reader-chrome; fill uses --reader-accent.
 */
export interface ProgressBarProps {
  /** Reading fraction 0..1. Clamped for display. */
  fraction: number;
}

export function ProgressBar({ fraction }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100;

  return (
    <div
      className="reader__progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label="阅读进度"
    >
      <div className="reader__progress-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default ProgressBar;
