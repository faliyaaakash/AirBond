import { theme } from '../theme';

interface ProgressBarProps {
  fraction: number; // 0-1
  height?: number;
}

export default function ProgressBar({ fraction, height = 6 }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height, background: theme.color.border, borderRadius: height / 2, overflow: 'hidden' }}
    >
      <div
        style={{
          height,
          width: `${clamped * 100}%`,
          background: theme.color.accent,
          borderRadius: height / 2,
          transition: 'width 150ms ease-out',
        }}
      />
    </div>
  );
}
