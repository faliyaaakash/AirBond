import { getStageNameAvatarColor } from './stageColor';

interface AvatarProps {
  stageName: string;
  size?: number;
}

export default function Avatar({ stageName, size = 32 }: AvatarProps) {
  const initial = stageName.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: getStageNameAvatarColor(stageName),
        color: '#fff',
        fontSize: size * 0.45,
        fontWeight: 600,
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
