import { memo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseResultFileReference, remarkResultFiles } from '../resultFileReferences';
import { remarkWindowsPathEscapes } from '../windowsPathEscapes';
import { renderMarkdownPre } from './CodeBlock';
import { MarkdownImage } from './MarkdownImage';
import { MarkdownTable } from './MarkdownTable';
import { ResultFileLink } from './ResultFileLink';

// Windows path recovery must run before linkification reads the parsed paths.
const plugins = [remarkGfm, remarkWindowsPathEscapes, remarkResultFiles];
const components = { pre: renderMarkdownPre, a: ResultFileLink, table: MarkdownTable, img: MarkdownImage };

/** Local file links/images and inline raster images survive; everything else uses react-markdown's safe defaults. */
function urlTransform(url: string, key: string): string {
  if ((key === 'href' || key === 'src') && parseResultFileReference(url)) return url;
  if (key === 'src' && /^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url;
  return defaultUrlTransform(url);
}

/** Streaming and highlight re-renders are frequent; identical text must not re-run remark. */
export const ConversationMarkdown = memo(function ConversationMarkdown({ children }: { children: string }) {
  return <Markdown remarkPlugins={plugins} components={components} urlTransform={urlTransform}>{children}</Markdown>;
});
