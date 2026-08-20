import { theme } from '../theme';

type BadgeTone = 'accent' | 'success' | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}

const toneStyles: Record<BadgeTone, { background: string; color: string; dot: string }> = {
  accent: { background: theme.color.accentSoft, color: theme.color.accentHover, dot: theme.color.accent },
  success: { background: theme.color.successSoft, color: theme.color.success, dot: theme.color.success },
  neutral: { background: theme.color.panelAlt, color: theme.color.textSecondary, dot: theme.color.textSecondary },
};

export default function Badge({ children, tone = 'neutral', dot = false }: BadgeProps) {
  const colors = toneStyles[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        padding: '4px 12px',
        borderRadius: theme.radius.pill,
        background: colors.background,
        color: colors.color,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors.dot, display: 'inline-block' }} />
      )}
      {children}
    </span>
  );
}
