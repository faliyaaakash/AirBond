import { theme } from '../theme';

export type ButtonVariant = 'primary' | 'secondary';

export function getButtonStyle(variant: ButtonVariant, disabled?: boolean): React.CSSProperties {
  if (variant === 'primary') {
    return {
      display: 'inline-block',
      padding: '11px 24px',
      borderRadius: theme.radius.pill,
      border: 'none',
      background: disabled ? theme.color.border : theme.color.accent,
      color: '#fff',
      fontWeight: 700,
      fontSize: 14,
      textDecoration: 'none',
      cursor: disabled ? 'default' : 'pointer',
      textAlign: 'center',
    };
  }
  return {
    display: 'inline-block',
    padding: '11px 24px',
    borderRadius: theme.radius.pill,
    border: `1.5px solid ${theme.color.border}`,
    background: theme.color.panel,
    color: theme.color.textPrimary,
    fontWeight: 700,
    fontSize: 14,
    textDecoration: 'none',
    cursor: disabled ? 'default' : 'pointer',
    textAlign: 'center',
  };
}
