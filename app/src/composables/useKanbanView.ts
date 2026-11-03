/**
 * Open / close the kanban board. Same event model as `useInboxView`:
 * App.vue swaps the center pane when it hears these.
 */

export const KANBAN_OPEN_EVENT = 'solomd:open-kanban';
export const KANBAN_CLOSE_EVENT = 'solomd:close-kanban';

export function useKanbanView() {
  function openKanban() {
    window.dispatchEvent(new CustomEvent(KANBAN_OPEN_EVENT));
  }
  function closeKanban() {
    window.dispatchEvent(new CustomEvent(KANBAN_CLOSE_EVENT));
  }
  return { openKanban, closeKanban };
}
