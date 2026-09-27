import { mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { access, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export function isConversationStorageDirectory(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= 32768
		&& !value.includes('\0') && isAbsolute(value);
}

export function normalizeConversationStorageDirectory(value: unknown): string {
	if (!isConversationStorageDirectory(value)) throw new Error('对话保存位置必须是有效的绝对文件夹路径');
	return resolve(value);
}

/** Preparing a new root never moves or removes existing conversation files. */
export async function prepareConversationStorageDirectory(value: unknown): Promise<string> {
	const directory = normalizeConversationStorageDirectory(value);
	await mkdir(directory, { recursive: true });
	if (!(await stat(directory)).isDirectory()) throw new Error('对话保存位置必须是文件夹');
	await access(directory, constants.W_OK);
	return directory;
}

function conversationPrefix(directory: string): string {
	return join(directory, `conversation-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-`);
}

/** mkdtemp reserves a unique folder atomically, including simultaneous windows. */
export async function createConversationWorkspace(directory: string): Promise<string> {
	const root = await prepareConversationStorageDirectory(directory);
	return mkdtemp(conversationPrefix(root));
}

export function createConversationWorkspaceSync(value: string): string {
	const directory = normalizeConversationStorageDirectory(value);
	mkdirSync(directory, { recursive: true });
	if (!statSync(directory).isDirectory()) throw new Error('对话保存位置必须是文件夹');
	return mkdtempSync(conversationPrefix(directory));
}
