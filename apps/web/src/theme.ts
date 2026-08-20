// Shared visual language for the marketing/product pages (Home, File Share, Chat).
// Kept as plain constants (no CSS-in-JS library) to match the rest of the app's
// inline-style approach.
export const theme = {
  color: {
    background: '#f6f0e6',
    panel: '#ffffff',
    panelAlt: '#fbf6ee',
    border: '#e6dcc8',
    textPrimary: '#2b2118',
    textSecondary: '#8a7f6f',
    accent: '#d97a4a',
    accentHover: '#c66a3d',
    accentSoft: '#fbe0c8',
    success: '#5a8a5a',
    successSoft: '#e8f3e3',
    danger: '#b5482f',
  },
  font: {
    heading: "Georgia, 'Times New Roman', serif",
    body: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  radius: {
    sm: 8,
    md: 14,
    pill: 999,
  },
} as const;
