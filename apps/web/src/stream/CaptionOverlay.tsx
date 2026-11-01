import { theme } from '../theme';

interface CaptionOverlayProps {
  finalCaption: string;
  interimCaption: string;
  visible: boolean;
  // Distance from the stage's bottom edge. Defaults to sitting just above the
  // video edge; callers in fullscreen pass the toolbar's measured height so
  // the caption stacks above it instead of overlapping the control buttons.
  bottomOffset?: number;
}

// Subtitle-style overlay: the last finalized line settles at full opacity,
// the current interim line (still being spoken) renders lighter/italic just
// beneath it - both update live, never a post-hoc transcript.
export default function CaptionOverlay({ finalCaption, interimCaption, visible, bottomOffset = 16 }: CaptionOverlayProps) {
  if (!visible || (!finalCaption && !interimCaption)) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: bottomOffset,
        transition: 'bottom 0.2s',
        transform: 'translateX(-50%)',
        maxWidth: '90%',
        padding: '8px 16px',
        borderRadius: theme.radius.md,
        background: 'rgba(0,0,0,0.65)',
        color: '#fff',
        fontSize: 15,
        lineHeight: 1.4,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      {finalCaption && <div>{finalCaption}</div>}
      {interimCaption && <div style={{ opacity: 0.7, fontStyle: 'italic' }}>{interimCaption}</div>}
    </div>
  );
}
