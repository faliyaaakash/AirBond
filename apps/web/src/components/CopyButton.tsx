import { useState } from 'react';

interface CopyButtonProps {
  value: string;
  label?: string;
}

export default function CopyButton({ value, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) - the value is still
      // visible/selectable in the UI as a fallback, so just ignore the failure.
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer' }}
      aria-label={`${label} to clipboard`}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
