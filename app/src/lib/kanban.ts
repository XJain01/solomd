/**
 * Group vault notes into kanban columns by frontmatter status.
 *
 * The value lives on the note (`status`, or `state` / `stage` / `phase` when
 * that's the key the note already uses). Dragging a card writes that same
 * key back through `patchFrontmatter`.
 */
import { patchFrontmatter, splitFrontmatter } from './frontmatter';

export const DEFAULT_KANBAN_STATUSES = ['todo', 'doing', 'done'] as const;

/** Column id for notes that have no status field. */
export const UNSORTED_COLUMN = '__none__';

const STATUS_KEY_RE = /^(status|state|stage|phase)$/i;

export interface KanbanNote {
  path: string;
  frontmatter: Record<string, unknown> | null;
}

export interface KanbanColumn {
  /** Stable id. Default columns use the canonical status token. */
  id: string;
  /** Value written into frontmatter. `null` clears the status key. */
  writeValue: string | null;
  /** True for the three built-in columns (labels come from i18n). */
  builtin: boolean;
}

/** The frontmatter key this note already uses for workflow status. */
export function statusKeyOf(fm: Record<string, unknown> | null | undefined): string | null {
  if (!fm) return null;
  for (const key of Object.keys(fm)) {
    if (STATUS_KEY_RE.test(key)) return key;
  }
  return null;
}

/** Trimmed status string, or null when the note has none. */
export function noteStatus(fm: Record<string, unknown> | null | undefined): string | null {
  const key = statusKeyOf(fm);
  if (!key || !fm) return null;
  const v = fm[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function columnId(status: string): string {
  return status.trim().toLowerCase();
}

/**
 * Columns to render: unsorted, the three defaults, then any other status
 * values actually present in the vault (original spelling, alphabetical).
 */
export function kanbanColumns(notes: KanbanNote[]): KanbanColumn[] {
  const extras = new Map<string, string>();
  for (const note of notes) {
    const status = noteStatus(note.frontmatter);
    if (!status) continue;
    const id = columnId(status);
    if ((DEFAULT_KANBAN_STATUSES as readonly string[]).includes(id)) continue;
    if (!extras.has(id)) extras.set(id, status.trim());
  }
  const extraCols = [...extras.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, label]) => ({ id, writeValue: label, builtin: false }));
  return [
    { id: UNSORTED_COLUMN, writeValue: null, builtin: true },
    ...DEFAULT_KANBAN_STATUSES.map((id) => ({ id, writeValue: id, builtin: true })),
    ...extraCols,
  ];
}

export function columnForNote(note: KanbanNote, columns: KanbanColumn[]): string {
  const status = noteStatus(note.frontmatter);
  if (!status) return UNSORTED_COLUMN;
  const id = columnId(status);
  return columns.some((c) => c.id === id) ? id : UNSORTED_COLUMN;
}

/** Frontmatter patch that moves a note into `column`. */
export function statusPatch(
  fm: Record<string, unknown> | null | undefined,
  column: KanbanColumn,
): Record<string, unknown> {
  const key = statusKeyOf(fm) ?? 'status';
  if (column.writeValue == null) return { [key]: undefined };
  return { [key]: column.writeValue };
}

/** Apply a column move to a markdown document, keeping its existing status key. */
export function moveNoteStatus(text: string, column: KanbanColumn): string {
  return patchFrontmatter(text, statusPatch(splitFrontmatter(text).data, column));
}
