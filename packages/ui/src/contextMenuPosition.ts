export interface ContextMenuPoint { x: number; y: number }

/** Keep the menu's top-left at the pointer unless it would leave the viewport. */
export function contextMenuPosition(point: ContextMenuPoint, size: { width: number; height: number }, viewport: { width: number; height: number }, padding = 8): { left: number; top: number } {
	return {
		left: Math.max(padding, Math.min(point.x, viewport.width - size.width - padding)),
		top: Math.max(padding, Math.min(point.y, viewport.height - size.height - padding)),
	};
}
