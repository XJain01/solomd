/**
 * Highlights and margin notes.
 *
 * A highlight is Obsidian's `==text==`. A note hangs off it as `^{comment}`
 * immediately after the closing marks:
 *
 *   ==quoted words==^{why this matters}
 *
 * Both pieces stay in the file, so source mode, git, and a hand edit all see
 * the same thing. The comment is single-line and may not contain `}`.
 */
import type { FormatEdit } from './md-format';

export interface Annotation {
  /** 1-based line of the opening `==`. */
  line: number;
  /** Document offset of the opening `==`. */
  from: number;
  /** Document offset just after the highlight, or after `^{...}` when present. */
  end: number;
  /** Offset just after the closing `==` (where a comment would start). */
  markEnd: number;
  text: string;
  comment: string;
  commentFrom: number | null;
  commentTo: number | null;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const MARK_RE = /==([^\s=](?:[^=\n]*?[^\s=])?)==(?!=)/g;
const NOTE_RE = /^\^\{([^{}\n]*)\}/;

function maskInlineCode(line: string): string {
  return line.replace(/`+[^`\n]*`+/g, (m) => ' '.repeat(m.length));
}

/** Every highlight in `doc`, skipping fenced code and inline code. */
export function parseAnnotations(doc: string): Annotation[] {
  const out: Annotation[] = [];
  let fence: string | null = null;
  let offset = 0;
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else {
      const masked = maskInlineCode(line);
      MARK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MARK_RE.exec(masked)) !== null) {
        const start = offset + m.index;
        const markEnd = start + m[0].length;
        const note = NOTE_RE.exec(doc.slice(markEnd));
        const comment = note ? note[1] : '';
        const end = markEnd + (note ? note[0].length : 0);
        out.push({
          line: i + 1,
          from: start,
          end,
          markEnd,
          text: m[1],
          comment,
          commentFrom: note ? markEnd + 2 : null,
          commentTo: note ? markEnd + 2 + note[1].length : null,
        });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * Turn the selection into a highlight with an empty note, or put the caret
 * in the note of a highlight the selection already sits in.
 * A multi-line selection is left alone (the caller keeps the plain highlight).
 */
export function applyAnnotation(doc: string, from: number, to: number): FormatEdit | null {
  const a = Math.max(0, Math.min(from, to, doc.length));
  const b = Math.max(0, Math.min(Math.max(from, to), doc.length));
  if (doc.slice(a, b).includes('\n')) return null;
  const hit = parseAnnotations(doc).find((ann) => a >= ann.from && b <= ann.end);
  if (hit) {
    if (hit.commentFrom == null) {
      return { from: hit.markEnd, to: hit.markEnd, insert: '^{}', selFrom: hit.markEnd + 2, selTo: hit.markEnd + 2 };
    }
    return {
      from: hit.commentFrom,
      to: hit.commentTo!,
      insert: doc.slice(hit.commentFrom, hit.commentTo!),
      selFrom: hit.commentFrom,
      selTo: hit.commentTo!,
    };
  }
  if (a === b) {
    const insert = '====^{}';
    return { from: a, to: b, insert, selFrom: a + 2, selTo: a + 2 };
  }
  const inner = doc.slice(a, b);
  const insert = `==${inner}==^{}`;
  const caret = a + insert.length - 1;
  return { from: a, to: b, insert, selFrom: caret, selTo: caret };
}
