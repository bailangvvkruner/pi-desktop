import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppLocale } from '@pidesktop/shared';

export const MAX_PROJECT_NAME_LENGTH = 120;

function message(locale: AppLocale, english: string, chinese: string): string {
	return locale === 'en-US' ? english : chinese;
}

export function validateProjectName(value: unknown, locale: AppLocale): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(message(locale, 'Enter a project name.', '请输入项目名称。'));
	}
	if (value.length > MAX_PROJECT_NAME_LENGTH || Buffer.byteLength(value, 'utf8') > 255) {
		throw new Error(message(locale, 'The project name is too long. Use a shorter name.', '项目名称过长，请使用更短的名称。'));
	}
	if (value === '.' || value === '..' || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(value) || /[.\s]$/.test(value)) {
		throw new Error(message(locale, 'Use a folder name without path separators or special characters, and do not end it with a space or period.', '项目名称不能包含路径分隔符或特殊字符，也不能以空格或句点结尾。'));
	}
	if (/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value)) {
		throw new Error(message(locale, 'This name is reserved by Windows. Choose another project name.', '此名称为 Windows 保留名称，请使用其他项目名称。'));
	}
	return value;
}

type DirectoryIdentity = { dev: number; ino: number; birthtimeMs: number };

/** Creates only new folders. A failed registration can retry its own unchanged folder. */
export function createProjectCreator(options: {
	getProjectsDirectory(): string;
	getLocale(): AppLocale;
	register(cwd: string): Promise<void>;
}): (name: unknown) => Promise<string> {
	const pendingRegistrations = new Map<string, DirectoryIdentity>();
	let queue: Promise<void> = Promise.resolve();
	return (value) => {
		const result = queue.then(async () => {
			const locale = options.getLocale();
			const name = validateProjectName(value, locale);
			const directory = options.getProjectsDirectory();
			const target = join(directory, name);
			const conflict = () => new Error(message(locale, 'A file or folder with this name already exists. Choose another name or add the existing folder.', '已存在同名文件或文件夹，请使用其他名称，或添加已有文件夹。'));
			try {
				await mkdir(directory, { recursive: true });
				const pending = pendingRegistrations.get(target);
				let reuse = false;
				if (pending) {
					try {
						const current = await lstat(target);
						reuse = current.isDirectory() && current.dev === pending.dev && current.ino === pending.ino && current.birthtimeMs === pending.birthtimeMs;
						if (!reuse) throw conflict();
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
						pendingRegistrations.delete(target);
					}
				}
				if (!reuse) {
					await mkdir(target);
					const created = await lstat(target);
					pendingRegistrations.set(target, { dev: created.dev, ino: created.ino, birthtimeMs: created.birthtimeMs });
				}
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === 'EEXIST') throw conflict();
				if (code === 'EACCES' || code === 'EPERM') {
					throw new Error(message(locale, 'The project folder could not be created. Check your Documents folder permissions.', '无法创建项目文件夹，请检查文档文件夹的访问权限。'));
				}
				if (code === 'ENAMETOOLONG') throw new Error(message(locale, 'The project path is too long. Use a shorter name.', '项目路径过长，请使用更短的项目名称。'));
				if (code === 'ENOSPC') throw new Error(message(locale, 'There is not enough disk space to create the project folder.', '磁盘空间不足，无法创建项目文件夹。'));
				if (code) throw new Error(message(locale, 'The project folder could not be created. Check the Documents folder and try again.', '无法创建项目文件夹，请检查文档文件夹后重试。'));
				throw error;
			}
			try {
				await options.register(target);
			} catch {
				// Keep the folder and its identity; users may already have written files into it.
				throw new Error(message(locale, `The folder was created, but the project could not be saved. Retry to add it, or select this folder: ${target}`, `文件夹已创建，但无法保存项目。请重试添加，或选择此文件夹：${target}`));
			}
			pendingRegistrations.delete(target);
			return target;
		});
		queue = result.then(() => undefined, () => undefined);
		return result;
	};
}
