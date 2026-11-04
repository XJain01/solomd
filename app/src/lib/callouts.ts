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

/** Lucide-style strokes, the same set Obsidian uses for each callout type. */
const ICONS: Record<string, string> = {
  note: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  abstract: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  tip: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  important: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  failure: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  danger: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  example: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
};

function iconSvg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16">${body}</svg>`;
}

/** First line of a callout, without the leading `>`. */
const HEADER_RE = /^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+([^\n]*))?$/;

export function calloutColor(canonical: string): string {
  return COLORS[canonical] ?? COLORS.note;
}

export function calloutIcon(canonical: string): string {
  return iconSvg(ICONS[canonical] ?? ICONS.note);
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
  const icon = calloutIcon(info.canonical);
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
