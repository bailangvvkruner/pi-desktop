import { dialog } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isConversationStorageDirectory } from './conversationStorage';
import { backupCorruptStateFile, CorruptStateFileError, readStateFile, writeStateFile, writeStateFileAsync } from './stateFiles';

export interface DesktopSettings {
	/** OS notifications for background/automation completion while the window is unfocused or hidden (4.1). */
	notificationsEnabled: boolean;
	/** What the window close button does on Windows: hide to tray (default) or quit (4.2). */
	closeBehavior: 'tray' | 'quit';
	/** Parent folder used only for newly created standalone conversations. */
	conversationStorageDirectory: string;
}

export function isValidDesktopSettings(value: unknown): value is DesktopSettings {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Partial<DesktopSettings>;
	return typeof candidate.notificationsEnabled === 'boolean'
		&& (candidate.closeBehavior === 'tray' || candidate.closeBehavior === 'quit')
		&& (candidate.conversationStorageDirectory === undefined || isConversationStorageDirectory(candidate.conversationStorageDirectory));
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
	notificationsEnabled: true, closeBehavior: 'tray', conversationStorageDirectory: join(homedir(), 'PiDesktopWorkspace'),
};

/** Reads desktop-level preferences; corrupt or missing files fall back to defaults (4.1/4.2). */
export function readDesktopSettings(path: string, defaultStorageDirectory = DEFAULT_DESKTOP_SETTINGS.conversationStorageDirectory): DesktopSettings {
	const defaults = { ...DEFAULT_DESKTOP_SETTINGS, conversationStorageDirectory: defaultStorageDirectory };
	try {
		return { ...defaults, ...readStateFile(path, () => defaults, isValidDesktopSettings) };
	} catch (error) {
		if (!(error instanceof CorruptStateFileError)) throw error;
		// Do not allow a later settings write to overwrite bytes we could not preserve.
		const backup = backupCorruptStateFile(path);
		dialog.showErrorBox('Pi Desktop 桌面设置已恢复 / Desktop settings recovered',
			`损坏的桌面设置已备份到 / Damaged settings were saved to:\n${backup}`);
		return defaults;
	}
}

export function writeDesktopSettings(path: string, settings: DesktopSettings): void {
	writeStateFile(path, settings);
}

export function writeDesktopSettingsAsync(path: string, settings: DesktopSettings): Promise<void> {
	return writeStateFileAsync(path, settings);
}
