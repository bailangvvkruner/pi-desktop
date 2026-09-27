import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store';
import { useT } from '../i18n';
import { runWithFeedback } from '../operationFeedback';
import { Icon } from './Icons';
import './folderProjectDrop.css';

/** Directory entries are inspected synchronously while the native drop is readable. */
function directoryFiles(transfer: DataTransfer): File[] {
	return Array.from(transfer.items).flatMap(item => {
		if (item.kind !== 'file' || !item.webkitGetAsEntry()?.isDirectory) return [];
		const file = item.getAsFile();
		return file ? [file] : [];
	});
}

export function FolderProjectDropZone({ onAdded }: { onAdded(): void }) {
	const { t } = useT();
	const bridge = useChatStore(state => state.bridge);
	const [active, setActive] = useState(false);
	const callbacks = useRef({ t, onAdded });
	callbacks.current = { t, onAdded };

	useEffect(() => {
		if (!bridge?.addDroppedWorkspaces) return;
		let depth = 0;
		let disposed = false;
		const reset = () => { depth = 0; setActive(false); };
		const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
		const preview = (event: DragEvent) => {
			if (!isFileDrag(event)) return;
			event.preventDefault();
			const transfer = event.dataTransfer!;
			// Chromium protects file paths until drop. A directory has an empty
			// MIME type; the main process verifies every directory before saving.
			const possibleDirectory = Array.from(transfer.items).some(item => item.kind === 'file' && (!item.type || item.webkitGetAsEntry()?.isDirectory));
			setActive(possibleDirectory);
			transfer.dropEffect = 'copy';
		};
		const enter = (event: DragEvent) => { if (isFileDrag(event)) { depth++; preview(event); } };
		const leave = (event: DragEvent) => {
			if (!isFileDrag(event)) return;
			depth = Math.max(0, depth - 1);
			if (!depth || event.relatedTarget === null) reset();
		};
		const drop = (event: DragEvent) => {
			reset();
			if (!isFileDrag(event)) return;
			// Prevent navigating Electron to a dropped file. Ordinary files still
			// reach the composer's attachment handler in the bubbling phase.
			event.preventDefault();
			const folders = directoryFiles(event.dataTransfer!);
			if (!folders.length) return;
			event.stopPropagation();
			const { t } = callbacks.current;
			void runWithFeedback({
				id: `add-dropped-projects:${crypto.randomUUID()}`,
				title: t('sidebar.addingDroppedProjects'),
				canRetry: () => !disposed && useChatStore.getState().bridge === bridge,
				run: async () => {
					const paths = await bridge.addDroppedWorkspaces(folders);
					if (disposed || useChatStore.getState().bridge !== bridge) return [];
					await useChatStore.getState().refreshWorkspaces();
					await Promise.all(paths.map(path => useChatStore.getState().refreshWorkspaceSessions(path)));
					if (!disposed && paths.length) callbacks.current.onAdded();
					return paths;
				},
				success: result => Array.isArray(result) && result.length ? t('sidebar.droppedProjectsAdded', { count: result.length }) : null,
			});
		};
		const key = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
		window.addEventListener('dragenter', enter, true);
		window.addEventListener('dragover', preview, true);
		window.addEventListener('dragleave', leave, true);
		window.addEventListener('drop', drop, true);
		window.addEventListener('dragend', reset, true);
		window.addEventListener('blur', reset);
		window.addEventListener('keydown', key);
		return () => {
			disposed = true;
			window.removeEventListener('dragenter', enter, true);
			window.removeEventListener('dragover', preview, true);
			window.removeEventListener('dragleave', leave, true);
			window.removeEventListener('drop', drop, true);
			window.removeEventListener('dragend', reset, true);
			window.removeEventListener('blur', reset);
			window.removeEventListener('keydown', key);
		};
	}, [bridge]);

	return active ? <div className="pd-project-folder-drop-overlay" role="status">
		<div className="pd-project-folder-drop-card"><Icon name="folder" width="32" height="32" /><strong>{t('sidebar.dropFolders')}</strong><span>{t('sidebar.dropFoldersHint')}</span></div>
	</div> : null;
}
