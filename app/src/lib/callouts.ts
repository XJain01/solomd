/**
 * Obsidian callouts: a blockquote whose first line is `> [!type]`.
 *
 *   > [!note]
 *   > Body
 *
 *   > [!tip] Custom title
 *   > Body
 *
 *   > [!faq]- Collapsed until opened
 *   > Hidden body
 *
 * The file stays plain Markdown. Unknown types use the note color and the
 * type name as the title (Obsidian's fallback).
 */

export type CalloutFold = 'none' | 'open' | 'closed';

export interface CalloutInfo {
  /** Identifier as written, without the brackets. */
  rawType: string;
  /** Style bucket. Unknown types are `note`. */
  canonical: string;
  fold: CalloutFold;
  /** Title shown in the header (custom, or the type's default). */
  title: string;
}

/** Alias → style bucket. Keys are lowercase. */
const ALIASES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'important',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

const COLORS: Record<string, string> = {
  note: '#4c8bf5',
  abstract: '#00b3a4',
  info: '#4c8bf5',
  todo: '#4c8bf5',
  tip: '#00a3c4',
  important: '#8b6ad6',
  success: '#2ea043',
  question: '#c69000',
  warning: '#d4890b',
  failure: '#e5534b',
  danger: '#e5534b',
  bug: '#e5534b',
  example: '#a371f7',
  quote: '#8b949e',
};

const ICONS: Record<string, string> = {
  note: 'ℹ',
  abstract: '✎',
  info: 'ℹ',
  todo: '☐',
  tip: '💡',
  important: '❗',
  success: '✓',
  question: '?',
  warning: '⚠',
  failure: '✗',
  danger: '⚡',
  bug: '🐞',
  example: '≡',
  quote: '❝',
};

/** First line of a callout, without the leading `>`. */
const HEADER_RE = /^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+([^\n]*))?$/;

export function calloutColor(canonical: string): string {
  return COLORS[canonical] ?? COLORS.note;
}

export function calloutIcon(canonical: string): string {
  return ICONS[canonical] ?? ICONS.note;
}

export function defaultCalloutTitle(rawType: string): string {
  const s = rawType.toLowerCase();
  if (s === 'tldr') return 'TLDR';
  if (s === 'faq') return 'FAQ';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parse `[!type]`, `[!type]+ Title`, or `[!type]- Title`. */
export function parseCalloutMarker(text: string): CalloutInfo | null {
  const m = HEADER_RE.exec(text.trimEnd());
  if (!m) return null;
  const rawType = m[1];
  const key = rawType.toLowerCase();
  const canonical = ALIASES[key] ?? 'note';
  const fold: CalloutFold = m[2] === '-' ? 'closed' : m[2] === '+' ? 'open' : 'none';
  const custom = (m[3] ?? '').trim();
  return {
    rawType,
    canonical,
    fold,
    title: custom || defaultCalloutTitle(rawType),
  };
}

/**
 * Inclusive end line of a callout that starts at `start` (0-based).
 * Continuation lines keep a `>` marker. A blank line ends the block.
 */
export function calloutEndLine(lines: readonly string[], start: number): number | null {
  const header = lines[start] ?? '';
  const opener = /^\s{0,3}>\s?(.*)$/.exec(header);
  if (!opener || !parseCalloutMarker(opener[1])) return null;
  let i = start;
  while (i + 1 < lines.length && /^\s{0,3}>/.test(lines[i + 1])) i++;
  return i;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Header row. Foldable callouts put this inside `<summary>`. */
export function calloutTitleHtml(info: CalloutInfo): string {
  const icon = escapeHtml(calloutIcon(info.canonical));
  const title = escapeHtml(info.title);
  const fold = info.fold === 'none' ? '' : '<span class="md-callout__fold" aria-hidden="true"></span>';
  return `<span class="md-callout__icon" aria-hidden="true">${icon}</span><span class="md-callout__label">${title}</span>${fold}`;
}

/**
 * Snippet for the insert command. A selection becomes the body, one `>`
 * line per source line. `$|$` is the caret when there is nothing to wrap.
 */
export function calloutSnippet(selection: string): string {
  const body = selection.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!body) return '\n> [!note]\n> $|$\n';
  const quoted = body.split('\n').map((line) => `> ${line}`).join('\n');
  return `\n> [!note]\n${quoted}\n`;
}
