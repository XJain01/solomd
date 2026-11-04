# Kanban Markdown Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the task board from `localStorage` to Obsidian-Kanban-compatible `.md` files under `<workspace>/boards/`, with one-time migration and no loss of unknown file content.

**Architecture:** A pure parser/serializer owns the Markdown format. The Pinia kanban store becomes a thin file-backed layer: it lists/reads `boards/*.md` on open, keeps the existing project/column/task model for the UI, and writes the owning file after every mutation. The existing center-pane `KanbanView` keeps its UX; an "open source" button opens the `.md` in the editor.

**Tech Stack:** Vue 3 + Pinia + TypeScript, existing Tauri commands `read_file` / `write_file` / `list_dir` / `fs_create_dir` / `remove_path` / `rename_path` (no new Rust), node:test.

**Spec:** `docs/superpowers/specs/2026-11-04-kanban-markdown-storage-design.md`

## Global Constraints

- Board files are UTF-8, LF, no BOM when created by SoloMD.
- Never drop: unknown frontmatter keys, `%% kanban:settings %%` footer, `*** ## Archive` section, preamble before the first `##`.
- Existing `solomd.kanban.v1` data is migrated once and kept as a backup.
- Do not add Rust commands; use the generic file commands.
- Keep the current center-pane UI (project dropdown, add/rename/delete columns and cards, drag).
- `##` inside ``` / ~~~ fences is not a lane.

## Review Focus

- An Obsidian board with CRLF + BOM round-trips byte-compatible except for intentional edits.
- Code fences containing `##` or `- [ ]` never become lanes/cards.
- Duplicate card titles still drag/delete correctly (position-based identity).
- Migration does not overwrite an existing `boards/*.md` with the same name.
- A file changed on disk while the board is open does not silently lose the user's in-memory edits.

---

### Task 1: Markdown board parser and serializer

**Files:**
- Create: `app/src/lib/kanban-markdown.ts`
- Test: `app/src/lib/kanban-markdown.test.ts`

**Interfaces:**
- `parseBoardMarkdown(text: string): MarkdownBoard`
- `serializeBoardMarkdown(board: MarkdownBoard): string`
- `createBoardMarkdown(name: string, lanes: string[]): string`
- `MarkdownBoard { frontmatterRaw, preamble, lanes: MarkdownLane[], archiveRaw, footerRaw, eol, bom }`
- `MarkdownLane { title, cards: MarkdownCard[], rawBefore: string[] }`
- `MarkdownCard { title, body: string[], checked }`

- [ ] **Step 1: Write failing tests** for: standard board, CRLF, BOM, unknown frontmatter, settings footer, archive, indented body, nested checklist, empty lanes, duplicate titles, fenced code containing `##`, no frontmatter.
- [ ] **Step 2: Run tests — expect failure (module missing).**
- [ ] **Step 3: Implement the line scanner + writer.** Preserve frontmatter/preamble/footer/archive verbatim; canonicalize lanes/cards only.
- [ ] **Step 4: Run tests — expect pass; add round-trip/idempotence assertions.**
- [ ] **Step 5: Commit** `feat(kanban): add Obsidian-compatible markdown parser`.

### Task 2: Legacy localStorage migration

**Files:**
- Create: `app/src/lib/kanban-migrate.ts`
- Test: `app/src/lib/kanban-migrate.test.ts`

**Interfaces:**
- `legacyBoardFromStorage(raw: string | null): KanbanBoard | null`
- `boardToMarkdown(board: KanbanBoard): string[]` — one Markdown string per project.
- `safeBoardFileName(name: string, taken: Set<string>): string` — lowercase slug, `-2` suffix on collision.

- [ ] **Step 1: Write failing tests** for a legacy blob with 2 projects, notes, empty projects, malformed JSON, name collisions.
- [ ] **Step 2: Run tests — expect failure.**
- [ ] **Step 3: Implement** using `parse/normalizeBoard` from `lib/kanban.ts`.
- [ ] **Step 4: Run tests — expect pass.**
- [ ] **Step 5: Commit** `feat(kanban): add legacy localStorage migration helpers`.

### Task 3: File-backed kanban store

**Files:**
- Modify: `app/src/stores/kanban.ts`
- Modify: `app/src/lib/kanban.ts` (add `filePath?: string`)
- Test: existing `app/src/lib/kanban.test.ts` stays green.

**Interfaces:**
- `load(folder: string): Promise<void>` — migrate legacy once, then list/read `boards/*.md`.
- `createProject(name, columnTitles): Promise<void>` — write `boards/<slug>.md`.
- `renameProject(projectId, name): Promise<void>` — rename file + update model.
- `deleteProject(projectId): Promise<void>` — delete file.
- Every column/task action calls `schedulePersist(projectId)` (debounced 250ms).
- `openSource(projectId): Promise<void>` is handled in the view via `useFiles().openPath(filePath)`.

- [ ] **Step 1: Add `filePath` to `KanbanProject`; keep `lib/kanban.test.ts` green.**
- [ ] **Step 2: Implement load/list/read + legacy migration + collision-safe names.**
- [ ] **Step 3: Implement write-on-mutation and file rename/delete.**
- [ ] **Step 4: Tests for pure helpers; manual store smoke.**
- [ ] **Step 5: Commit** `feat(kanban): store boards as markdown files`.

### Task 4: KanbanView file lifecycle + source toggle

**Files:**
- Modify: `app/src/components/KanbanView.vue`
- Modify: `app/src/i18n/en.ts`, `zh.ts` (+ fallback keys in other locales)
- Test: manual smoke + existing 562 tests.

- [ ] **Step 1: On mount and workspace change, `await board.load(folder)`; show loading/error.**
- [ ] **Step 2: Add "打开源文件" button (uses `useFiles().openPath(project.filePath)`).**
- [ ] **Step 3: Add a small done checkbox per card bound to `task.checked`; drag/edit unchanged.**
- [ ] **Step 4: Update empty-state copy: boards live in `boards/`.**
- [ ] **Step 5: Commit** `feat(kanban): load and save boards from markdown files`.

### Task 5: Verification and release notes

- [ ] **Step 1:** `vue-tsc --noEmit`, `cargo check`, `bash app/scripts/run-tests.sh` (expect 0 fail).
- [ ] **Step 2:** Manual: create board → file appears in `boards/`; drag → file updates; open in editor; reopen app → board persists; delete file → project disappears.
- [ ] **Step 3:** Confirm legacy localStorage board migrated once, backup still present.
- [ ] **Step 4: Commit** `docs: describe markdown kanban storage`.

## Self-review notes

- Parser is the risk centre: frontmatter/footer/archive preservation is tested first.
- Store writes are optimistic (UI updates immediately, file write best-effort + toast on failure).
- v1 keeps the center-pane UI; a tab-bound board mode and archive UI are follow-ups.
