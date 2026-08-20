// Turns a plain chat message into safe, lightly-formatted HTML:
// escape first, then auto-link URLs and apply WhatsApp-style *bold*/_italic_/~strike~/`code`.
// URLs are pulled out into placeholders before emphasis runs so markdown delimiters
// that happen to appear inside a URL (very common: _ and *) can't corrupt the link.

const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING_PUNCT_REGEX = /[),.!?;:]+$/;
const PLACEHOLDER_PREFIX = ' LINK';
const PLACEHOLDER_SUFFIX = ' ';
const PLACEHOLDER_REGEX = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g');

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractLinks(text: string): { text: string; links: string[] } {
  const links: string[] = [];
  const replaced = text.replace(URL_REGEX, (match) => {
    const trimmed = match.replace(TRAILING_PUNCT_REGEX, '');
    const suffix = match.slice(trimmed.length);
    const href = trimmed.toLowerCase().startsWith('http') ? trimmed : `https://${trimmed}`;
    links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${trimmed}</a>${suffix}`);
    return `${PLACEHOLDER_PREFIX}${links.length - 1}${PLACEHOLDER_SUFFIX}`;
  });
  return { text: replaced, links };
}

function applyMarkdownEmphasis(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, (_match, code: string) => `<code>${code}</code>`)
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '<strong>$1</strong>')
    .replace(/_(\S(?:[^_\n]*\S)?)_/g, '<em>$1</em>')
    .replace(/~(\S(?:[^~\n]*\S)?)~/g, '<del>$1</del>');
}

function restoreLinks(text: string, links: string[]): string {
  return text.replace(PLACEHOLDER_REGEX, (_match, index: string) => links[Number(index)]);
}

export function formatMessageHtml(rawText: string): string {
  const escaped = escapeHtml(rawText);
  const { text: withPlaceholders, links } = extractLinks(escaped);
  const withEmphasis = applyMarkdownEmphasis(withPlaceholders);
  return restoreLinks(withEmphasis, links).replace(/\n/g, '<br />');
}

// WhatsApp-style "jumbo" rendering: a message made up of only a handful of emoji
// (no other text) renders larger instead of at normal message font size.
// U+200D = zero-width joiner (multi-part emoji like family/profession sequences),
// U+FE0F = variation selector-16 (forces emoji-style presentation).
const ZWJ = String.fromCodePoint(0x200d);
const VARIATION_SELECTOR_16 = String.fromCodePoint(0xfe0f);
const EMOJI_REGEX = new RegExp(
  `\\p{Extended_Pictographic}(?:${ZWJ}\\p{Extended_Pictographic})*${VARIATION_SELECTOR_16}?`,
  'gu',
);
const JUMBO_EMOJI_MAX_COUNT = 3;

export function getEmojiOnlyInfo(text: string): { isJumboEmoji: boolean; emojiCount: number } {
  const trimmed = text.trim();
  if (!trimmed) return { isJumboEmoji: false, emojiCount: 0 };

  const matches = trimmed.match(EMOJI_REGEX) ?? [];
  const remainder = trimmed.replace(EMOJI_REGEX, '').replace(/\s/g, '');
  const isEmojiOnly = matches.length > 0 && remainder.length === 0;

  return {
    isJumboEmoji: isEmojiOnly && matches.length <= JUMBO_EMOJI_MAX_COUNT,
    emojiCount: matches.length,
  };
}
