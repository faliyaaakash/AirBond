// Deterministic colour per stage name (same input always renders the same colour,
// no server round-trip needed) so each participant is visually distinguishable in
// message text and the participant chips, similar to Slack/Discord username colours.

function hashStageName(stageName: string): number {
  let hash = 0;
  for (let i = 0; i < stageName.length; i++) {
    hash = (hash * 31 + stageName.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getHue(stageName: string): number {
  // Normalized the same way the server enforces stage-name uniqueness (case-insensitive),
  // so "Alice" and "alice" always resolve to one colour.
  return hashStageName(stageName.trim().toLowerCase()) % 360;
}

export function getStageNameColor(stageName: string): string {
  return `hsl(${getHue(stageName)}, 65%, 38%)`;
}

export function getStageNameChipColors(stageName: string): { background: string; text: string } {
  const hue = getHue(stageName);
  return {
    background: `hsl(${hue}, 75%, 93%)`,
    text: `hsl(${hue}, 65%, 30%)`,
  };
}

export function getStageNameAvatarColor(stageName: string): string {
  return `hsl(${getHue(stageName)}, 55%, 45%)`;
}
