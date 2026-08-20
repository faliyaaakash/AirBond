import { theme } from '../theme';

interface LiveChartProps {
  points: number[]; // oldest to newest
  color: string;
  height?: number;
  formatValue?: (value: number) => string;
  label: string;
}

const WIDTH = 100; // viewBox units; scales to container via CSS width: 100%

export default function LiveChart({ points, color, height = 90, formatValue, label }: LiveChartProps) {
  const values = points.length > 0 ? points : [0];
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? WIDTH / (values.length - 1) : WIDTH;

  const coords = values.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * (height - 8) - 2;
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${height} L 0 ${height} Z`;

  const current = values[values.length - 1];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: theme.color.textSecondary }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.color.textPrimary }}>
          {formatValue ? formatValue(current) : current}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
      >
        <path d={areaPath} fill={color} opacity={0.12} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
