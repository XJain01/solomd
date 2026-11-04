/**
 * Open / close the 手绘画板. Same event model as the Kanban view: App.vue
 * swaps the centre pane when it hears these.
 */

export const DRAWING_OPEN_EVENT = 'solomd:open-drawing';
export const DRAWING_CLOSE_EVENT = 'solomd:close-drawing';

export function useDrawingView() {
  function openDrawing() {
    window.dispatchEvent(new CustomEvent(DRAWING_OPEN_EVENT));
  }
  function closeDrawing() {
    window.dispatchEvent(new CustomEvent(DRAWING_CLOSE_EVENT));
  }
  return { openDrawing, closeDrawing };
}
