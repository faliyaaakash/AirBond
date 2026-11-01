// OPFS sync access handles are Chromium-only today (not in Firefox/Safari,
// and flaky on iOS Safari where present) - callers must fall back to the
// original in-memory receive path when this is false rather than failing.
export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof Worker !== 'undefined'
  );
}
