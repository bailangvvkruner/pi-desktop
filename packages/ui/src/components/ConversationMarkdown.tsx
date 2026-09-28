import { memo } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseResultFileReference, remarkResultFiles } from '../resultFileReferences';
import { renderMarkdownPre } from './CodeBlock';
import { ResultFileLink } from './ResultFileLink';

const plugins = [remarkGfm, remarkResultFiles];
const components = { pre: renderMarkdownPre, a: ResultFileLink };

/** Streaming and highlight re-renders are frequent; identical text must not re-run remark. */
export const ConversationMarkdown = memo(function ConversationMarkdown({ children }: { children: string }) {
  return <Markdown remarkPlugins={plugins} components={components}
    urlTransform={(url, key) => key === 'href' && parseResultFileReference(url) ? url : defaultUrlTransform(url)}>{children}</Markdown>;
});
