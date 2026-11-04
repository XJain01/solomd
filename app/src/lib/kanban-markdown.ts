/**
 * Obsidian-Kanban-compatible markdown boards.
 *
 * The file is the source of truth; this module only converts between that
 * file and a small in-memory shape. It deliberately preserves the parts the
 * board UI does not understand: unknown frontmatter, the preamble before the
 * first lane, non-card lane text, the archive block, and the
 * `%% kanban:settings %%` footer.
 */

export type MarkdownPriority = 'P0' | 'P1' | 'P2';

export interface MarkdownCard {
  title: string;
  /** Card body lines, with the 4-space/tab indent stripped. */
  body: string[];
  checked: boolean;
  /** Stored as Obsidian Tasks priority emoji. */
  priority?: MarkdownPriority;
  /** ISO date, stored as `📅`. */
  due?: string;
}

export interface MarkdownLane {
  title: string;
  /** Raw lines between the heading and the first card. */
  intro: string[];
  cards: MarkdownCard[];
}

export interface MarkdownBoard {
  /** `---\nkey: value\n---` including both delimiters, or ''. */
  frontmatterRaw: string;
  /** Raw lines before the first `##` heading. */
  preamble: string[];
  lanes: MarkdownLane[];
  /** `***` + `## Archive` section, verbatim. */
  archiveRaw: string;
  /** `%% kanban:settings ... %%` and anything after it, verbatim. */
  footerRaw: string;
  eol: '\n' | '\r\n';
  bom: boolean;
}

const CARD_RE = /^\s{0,3}- \[([ xX])\](?:[ \t]?(.*))?$/;
const LANE_RE = /^##[ \t]+(.+?)[ \t]*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const PRIORITY_RE = /(🔺|⏫|🔼)/u;
const PRIORITY_EMOJI: Record<MarkdownPriority, string> = {
  P0: '🔺',
  P1: '⏫',
  P2: '🔼',
};
const EMOJI_PRIORITY: Record<string, MarkdownPriority> = {
  '🔺': 'P0',
  '⏫': 'P1',
  '🔼': 'P2',
};

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Strip one card-body indent: four spaces or one tab. */
function stripBodyIndent(line: string): string {
  if (line.startsWith('\t')) return line.slice(1);
  if (line.startsWith('    ')) return line.slice(4);
  return line;
}

function indentBodyLine(line: string): string {
  return line.trim() === '' ? '' : `    ${line}`;
}

/** Parse a board file. Unknown text is kept, never dropped. */
export function parseBoardMarkdown(text: string): MarkdownBoard {
  const bom = text.startsWith('\uFEFF');
  const body = bom ? text.slice(1) : text;
  const eol: '\n' | '\r\n' = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitLines(body);

  let pos = 0;
  let frontmatterRaw = '';
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (close > 0) {
      frontmatterRaw = lines.slice(0, close + 1).join(eol);
      pos = close + 1;
    }
  }

  let footerStart = -1;
  for (let i = pos; i < lines.length; i++) {
    if (/^\s*%%\s*kanban:settings/i.test(lines[i])) {
      footerStart = i;
      break;
    }
  }
  const contentEnd = footerStart >= 0 ? footerStart : lines.length;
  const footerRaw = footerStart >= 0 ? lines.slice(footerStart).join(eol) : '';

  let archiveStart = -1;
  for (let i = pos; i < contentEnd; i++) {
    if (!/^\s*\*\*\*\s*$/.test(lines[i])) continue;
    let next = i + 1;
    while (next < contentEnd && isBlank(lines[next])) next++;
    if (/^##[ \t]+archive\b/i.test(lines[next] ?? '')) {
      archiveStart = i;
      break;
    }
  }
  const bodyEnd = archiveStart >= 0 ? archiveStart : contentEnd;
  const archiveRaw = archiveStart >= 0 ? lines.slice(archiveStart, contentEnd).join(eol) : '';

  const preamble: string[] = [];
  const lanes: MarkdownLane[] = [];
  let lane: MarkdownLane | null = null;
  let fence: string | null = null;

  for (let i = pos; i < bodyEnd; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (line.trimStart().startsWith(fence)) fence = null;
      attach(line);
      continue;
    }
    const laneMatch = fence === null ? LANE_RE.exec(line) : null;
    if (laneMatch) {
      lane = { title: laneMatch[1].trim(), intro: [], cards: [] };
      lanes.push(lane);
      continue;
    }
    const cardMatch = fence === null ? CARD_RE.exec(line) : null;
    if (cardMatch && lane) {
      let title = (cardMatch[2] ?? '').trim();
      let priority: MarkdownPriority | undefined;
      const priorityMatch = PRIORITY_RE.exec(title);
      if (priorityMatch) {
        priority = EMOJI_PRIORITY[priorityMatch[1]];
        title = title.replace(priorityMatch[0], '');
      }
      let due: string | undefined;
      const dueMatch = DUE_RE.exec(title);
      if (dueMatch) {
        due = dueMatch[1];
        title = title.replace(dueMatch[0], '');
      }
      lane.cards.push({
        title: title.replace(/\s{2,}/g, ' ').trim(),
        body: [],
        checked: cardMatch[1].toLowerCase() === 'x',
        priority,
        due,
      });
      continue;
    }
    attach(line);
  }

  function attach(line: string): void {
    if (!lane) {
      preamble.push(line);
      return;
    }
    const last = lane.cards[lane.cards.length - 1];
    if (last) last.body.push(stripBodyIndent(line));
    else lane.intro.push(line);
  }

  // Trailing blank lines in a card body are just spacing, not content.
  for (const l of lanes) {
    for (const card of l.cards) {
      while (card.body.length && isBlank(card.body[card.body.length - 1])) card.body.pop();
    }
    while (l.intro.length && isBlank(l.intro[l.intro.length - 1])) l.intro.pop();
  }
  while (preamble.length && isBlank(preamble[preamble.length - 1])) preamble.pop();
  while (preamble.length && isBlank(preamble[0])) preamble.shift();

  for (const l of lanes) {
    while (l.intro.length && isBlank(l.intro[l.intro.length - 1])) l.intro.pop();
    while (l.intro.length && isBlank(l.intro[0])) l.intro.shift();
  }

  return { frontmatterRaw, preamble, lanes, archiveRaw, footerRaw, eol, bom };
}

/** Serialize a board. Lanes/cards are canonicalized; everything else is kept. */
export function serializeBoardMarkdown(board: MarkdownBoard): string {
  const out: string[] = [];
  const blank = () => {
    if (out.length && !isBlank(out[out.length - 1])) out.push('');
  };

  if (board.frontmatterRaw) out.push(...splitLines(board.frontmatterRaw));
  if (board.preamble.length) {
    blank();
    out.push(...board.preamble);
  }

  for (const lane of board.lanes) {
    blank();
    out.push(`## ${lane.title}`);
    blank();
    if (lane.intro.length) {
      out.push(...lane.intro);
      blank();
    }
    for (const card of lane.cards) {
      const meta: string[] = [];
      if (card.priority) meta.push(PRIORITY_EMOJI[card.priority]);
      if (card.due) meta.push(`📅 ${card.due}`);
      const title = [card.title, ...meta].filter(Boolean).join(' ');
      out.push(`- [${card.checked ? 'x' : ' '}] ${title}`.trimEnd());
      for (const line of card.body) out.push(indentBodyLine(line));
    }
  }

  if (board.archiveRaw) {
    blank();
    out.push(...splitLines(board.archiveRaw));
  }
  if (board.footerRaw) {
    blank();
    out.push(...splitLines(board.footerRaw));
  }

  // Drop the empty line produced by a trailing newline in an input block,
  // then guarantee exactly one final newline.
  while (out.length && isBlank(out[out.length - 1])) out.pop();
  const text = out.join(board.eol) + board.eol;
  return (board.bom ? '\uFEFF' : '') + text;
}

/** New board file: frontmatter + the requested lanes, empty. */
export function createBoardMarkdown(lanes: string[]): string {
  return serializeBoardMarkdown({
    frontmatterRaw: ['---', 'kanban-plugin: board', '---'].join('\n'),
    preamble: [],
    lanes: lanes.map((title) => ({ title, intro: [], cards: [] })),
    archiveRaw: '',
    footerRaw: '',
    eol: '\n',
    bom: false,
  });
}
