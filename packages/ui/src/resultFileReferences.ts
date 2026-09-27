export interface ResultFileReference { path: string; line?: number; column?: number }

const FILE_EXTENSIONS = new Set('txt md markdown mdx rst log csv tsv json jsonl yaml yml toml ini cfg conf xml html htm css scss less js jsx mjs cjs ts tsx mts cts vue svelte py pyw ipynb rb php go rs java kt swift c h cc cpp hpp cs fs sh bash zsh ps1 bat cmd sql graphql proto r tex pdf doc docx xls xlsx ppt pptx odt ods odp png jpg jpeg gif webp avif bmp ico svg mp3 wav ogg mp4 mov webm zip gz tar tgz 7z rar bin epub blend parquet sqlite db sln lock gitignore gitattributes editorconfig dockerfile code-workspace'.split(' '));
const positiveInteger = (value?: string) => value && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

/** Parse local destinations without treating URI schemes or code expressions as files. */
export function parseResultFileReference(value: string, mode: 'link' | 'auto' = 'link'): ResultFileReference | null {
  if (!value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let path = value.trim();
  if (!path || /^(?:#|www\.)/i.test(path)) return null;
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== 'localhost' || url.search) return null;
      path = url.pathname + url.hash;
      if (/^\/[a-z]:[\/\\]/i.test(path)) path = path.slice(1);
    } catch { return null; }
  } else if (path.startsWith('sandbox:/')) path = path.slice('sandbox:'.length);
  else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  try { path = decodeURIComponent(path); } catch { /* A native filename may contain a literal percent sign. */ }
  if (/[\u0000-\u001f\u007f]/.test(path) || /^[\\/]{2}/.test(path)) return null;
  // Line suffixes are navigation metadata, never part of the file system path.
  const location = /(?::(\d+)(?::(\d+))?(?:-\d+(?::\d+)?)?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/i.exec(path);
  const line = positiveInteger(location?.[1] ?? location?.[3]);
  const column = positiveInteger(location?.[2] ?? location?.[4]);
  if (location) path = path.slice(0, location.index);
  // Decoding must not turn an encoded destination back into a remote/active URI.
  if (!path || /[<>|?*]/.test(path) || /^(?:#|www\.)/i.test(path)
    || /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)
    || /:/.test(path.replace(/^[a-z]:/i, ''))) return null;
  const absolute = /^(?:[a-z]:[\\/]|\/|~[\\/])/i.test(path);
  const explicitRelative = /^\.{1,2}[\\/]/.test(path);
  if (mode === 'auto' && !absolute && !explicitRelative && /\s/.test(path)) return null;
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  const extension = name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
  const knownFile = FILE_EXTENSIONS.has(extension) || /^(?:Dockerfile|Makefile|LICENSE|README)$/i.test(name)
    || /^\.(?:env(?:\.[\w.-]+)?|npmrc|yarnrc|prettierrc|eslintrc|babelrc|nvmrc|dockerignore|gitmodules)$/i.test(name);
  if (mode === 'auto' && !knownFile) return null;
  if (!absolute && !explicitRelative && !/[\\/]/.test(path) && !knownFile) return null;
  return { path, ...(line ? { line } : {}), ...(line && column ? { column } : {}) };
}

export function resultFileTextMatches(text: string): Array<{ start: number; end: number; reference: ResultFileReference }> {
  const matches: Array<{ start: number; end: number; reference: ResultFileReference }> = [];
  // Unquoted prose is intentionally conservative. Paths containing spaces remain
  // supported inside inline code and explicit Markdown links.
  const tokens = /[^\s<>"'`，。；：！？、（）【】]+/gu;
  for (const token of text.matchAll(tokens)) {
    const original = token[0];
    if (/^(?:[a-z][a-z\d+.-]*:\/\/|www\.)/i.test(original) && !/^file:/i.test(original)) continue;
    const prefix = /^[([{]+/.exec(original)?.[0].length ?? 0;
    const value = original.slice(prefix).replace(/[),.;!}\]]+$/, '');
    const reference = parseResultFileReference(value, 'auto');
    if (reference) matches.push({ start: token.index! + prefix, end: token.index! + prefix + value.length, reference });
  }
  return matches;
}

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }

/** Linkify paths in prose/inline code, leaving fenced code and existing links intact. */
export function remarkResultFiles() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || ['link', 'linkReference', 'image', 'imageReference', 'code', 'html'].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type === 'inlineCode' && child.value && parseResultFileReference(child.value, 'auto')) {
          return [{ type: 'link', url: child.value, children: [child] }];
        }
        if (child.type === 'text' && child.value) {
          const value = child.value, result: MarkdownNode[] = []; let cursor = 0;
          for (const match of resultFileTextMatches(value)) {
            if (cursor < match.start) result.push({ type: 'text', value: value.slice(cursor, match.start) });
            const label = value.slice(match.start, match.end);
            result.push({ type: 'link', url: label, children: [{ type: 'text', value: label }] });
            cursor = match.end;
          }
          if (!cursor) return [child];
          if (cursor < value.length) result.push({ type: 'text', value: value.slice(cursor) });
          return result;
        }
        visit(child); return [child];
      });
    };
    visit(tree);
  };
}
