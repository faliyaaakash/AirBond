import { theme } from '../theme';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export default function Card({ padded = true, style, ...rest }: CardProps) {
  return (
    <div
      style={{
        background: theme.color.panel,
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        padding: padded ? 20 : 0,
        ...style,
      }}
      {...rest}
    />
  );
}
