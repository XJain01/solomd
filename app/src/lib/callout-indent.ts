/**
 * Tab / Shift+Tab on a line inside an Obsidian callout.
 *
 * CodeMirror's `indentWithTab` inserts at the start of the line, so
 * `> body` became `  > body`: the `>` marker ran right together with the
 * content, and once it passed three spaces the line stopped being a quote at
 * all. Obsidian keeps the marker where it is and indents what follows it.
 *
 * List items follow the same nesting rules as ordinary Markdown lists, except
 * measured from the text after `>`:
 *
 *   > - a                     > - a
 *   > - b        Tab          >   - b
 *
 * A single item with no sibling above has nowhere to nest, so further Tab
 * presses just indent its content. Four spaces make Markdown read the line as
 * an indented code block — Obsidian does the same — but the `>` never moves,
 * which is the part this module is responsible for.
 *
 * Scope is deliberately narrow: only a `>` line inside a block whose first
 * line is `> [!type]`. Plain blockquotes, lists and every other construct
 * keep CodeMirror's default indentation.
 *
 * `parseCalloutMarker` owns what counts as a callout (aliases, fold markers,
 * custom titles), so this module never re-implements that grammar.
 */

import { parseCalloutMarker } from './callouts';
import { listIndentEdit } from './md-format';

const QUOTE_PREFIX = /^([ \t]*>)([ \t]?)/;

export interface CalloutIndentEdit {
  /** false for a line where the key is consumed but nothing may change. */
  changed: boolean;
  from: number;
  to: number;
  insert: string;
  /** Caret position after the edit (collapsed selections only). */
  sel: number;
}

function lineBounds(content: string, pos: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(pos, content.length));
  const start = content.lastIndexOf('\n', clamped - 1) + 1;
  const next = content.indexOf('\n', start);
  return { start, end: next < 0 ? content.length : next };
}

/** Leading whitespace width of a line. */
function leadWidth(text: string): number {
  return /^[ \t]*/.exec(text)?.[0].length ?? 0;
}

/**
 * The callout's own text with every `>` prefix replaced by spaces of the same
 * width. Offsets and columns are unchanged, so `listIndentEdit` can work on a
 * normal list inside the quote, and its answer can be measured back on the
 * original line.
 */
function withoutQuotePrefixes(
  content: string,
  blockStart: number,
  blockEnd: number,
): string {
  const out: string[] = [];
  let pos = blockStart;
  while (pos <= blockEnd) {
    const { start, end } = lineBounds(content, pos);
    out.push(
      content
        .slice(start, end)
        .replace(/^[ \t]*>/, (prefix) => ' '.repeat(prefix.length)),
    );
    if (end >= blockEnd) break;
    pos = end + 1;
  }
  return content.slice(0, blockStart) + out.join('\n') + content.slice(blockEnd);
}

function noop(caret: number): CalloutIndentEdit {
  return { changed: false, from: caret, to: caret, insert: '', sel: caret };
}

/** Insert/remove `delta` spaces at the start of the callout's content. */
function contentIndentEdit(
  content: string,
  caret: number,
  at: number,
  delta: number,
  lineEnd: number,
): CalloutIndentEdit {
  if (delta > 0) {
    return {
      changed: true,
      from: at,
      to: at,
      insert: ' '.repeat(delta),
      sel: caret >= at ? caret + delta : caret,
    };
  }
  let to = at;
  while (to < lineEnd && to - at < -delta && content[to] === ' ') to += 1;
  const removed = to - at;
  if (removed === 0) return noop(caret);
  return {
    changed: true,
    from: at,
    to,
    insert: '',
    sel: caret >= to ? caret - removed : caret >= at ? at : caret,
  };
}

/**
 * @param content whole document
 * @param pos     caret offset
 * @param outdent Shift+Tab instead of Tab
 * @param unit    indent width in spaces
 */
export function calloutIndentEdit(
  content: string,
  pos: number,
  outdent: boolean,
  unit = 2,
): CalloutIndentEdit | null {
  const caret = Math.max(0, Math.min(pos, content.length));
  const { start, end } = lineBounds(content, caret);
  const line = content.slice(start, end);
  const quote = QUOTE_PREFIX.exec(line);
  if (!quote) return null;

  // A callout is a contiguous `>` block whose first line is the `[!type]`
  // header. Walk back to that first line; anything else (a plain quote, a
  // quote that merely contains a callout later) is left alone.
  let blockStart = start;
  while (blockStart > 0) {
    const prevEnd = blockStart - 1;
    const prevStart = content.lastIndexOf('\n', prevEnd - 1) + 1;
    if (!/^[ \t]*>/.test(content.slice(prevStart, prevEnd))) break;
    blockStart = prevStart;
  }
  const { end: headerEnd } = lineBounds(content, blockStart);
  const headerMatch = /^[ \t]*>\s?(.*)$/.exec(content.slice(blockStart, headerEnd));
  if (!headerMatch || !parseCalloutMarker(headerMatch[1])) return null;

  // The header itself defines the callout. Indenting it would either stop it
  // being one (`>   [!note]`) or shift the marker, which is the bug this
  // module exists to prevent — consume the key, change nothing.
  if (start === blockStart) return noop(caret);

  // The rest of the quote block, needed to judge a list item's siblings.
  let blockEnd = end;
  while (blockEnd < content.length) {
    if (blockEnd + 1 >= content.length) break;
    const { start: nextStart, end: nextEnd } = lineBounds(content, blockEnd + 1);
    if (!/^[ \t]*>/.test(content.slice(nextStart, nextEnd))) break;
    blockEnd = nextEnd;
  }

  const prefixEnd = start + quote[1].length + quote[2].length;
  const contentText = content.slice(prefixEnd, end);
  const lead = leadWidth(contentText);
  const isList = /^(?:[-*+]|\d+[.)])[ \t]+/.test(contentText.slice(lead));

  if (isList) {
    const synthetic = withoutQuotePrefixes(content, blockStart, blockEnd);
    const listEdit = listIndentEdit(synthetic, caret, caret, outdent);
    if (listEdit) {
      // `listIndentEdit` works on the quote-free twin; only the caret line's
      // leading-space change is carried back, and it lands after `>` so the
      // marker never moves. Ordered-list renumbering is left to the normal
      // list command — indentation is what Tab is for.
      const lineIndex = synthetic.slice(0, caret).split('\n').length - 1;
      const after = (
        synthetic.slice(0, listEdit.from) +
        listEdit.insert +
        synthetic.slice(listEdit.to)
      ).split('\n');
      const before = synthetic.split('\n');
      const delta = leadWidth(after[lineIndex] ?? '') - leadWidth(before[lineIndex] ?? '');
      if (delta === 0) return noop(caret);
      return contentIndentEdit(content, caret, prefixEnd, delta, end);
    }
    // No sibling to nest under: keep the basic contract — every Tab press
    // indents the content, none of them touches the marker. Past three
    // spaces Markdown reads the line as an indented code block; that is the
    // Markdown rule (Obsidian behaves the same), not something to swallow.
    if (outdent) {
      if (lead === 0) return null;
      return contentIndentEdit(content, caret, prefixEnd, -Math.min(unit, lead), end);
    }
    return {
      changed: true,
      from: prefixEnd,
      to: prefixEnd,
      insert: ' '.repeat(unit),
      sel: caret >= prefixEnd ? caret + unit : caret,
    };
  }

  if (!outdent) {
    return {
      changed: true,
      from: prefixEnd,
      to: prefixEnd,
      insert: ' '.repeat(unit),
      sel: caret >= prefixEnd ? caret + unit : caret,
    };
  }

  // Remove only spaces sitting where Tab would have put them (right after
  // the quote prefix), never the single separator space that belongs to `>`.
  // With nothing to remove, fall through so the whole callout can dedent.
  if (lead === 0) return null;
  return contentIndentEdit(content, caret, prefixEnd, -Math.min(unit, lead), end);
}
