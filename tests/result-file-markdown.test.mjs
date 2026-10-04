import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const uiRequire = createRequire(new URL('../packages/ui/package.json', import.meta.url));
const desktopRequire = createRequire(new URL('../packages/desktop/package.json', import.meta.url));

test('conversation Markdown renders local references as file actions while preserving web links and code', async () => {
  const { createElement } = await import(pathToFileURL(uiRequire.resolve('react')).href);
  const { renderToStaticMarkup } = await import(pathToFileURL(uiRequire.resolve('react-dom/server')).href);
  const { createServer } = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
  const server = await createServer({ root: fileURLToPath(new URL('../packages/ui', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const { ConversationMarkdown } = await server.ssrLoadModule('/src/components/ConversationMarkdown.tsx');
    const render = source => renderToStaticMarkup(createElement(ConversationMarkdown, null, source));
    const source = [
      '[报告](<C:/output/报告 final.md>)',
      '[相对报告](<reports/最终 报告.pdf>)',
      '[本地链接](file:///C:/output/report.pdf)',
      '`src/main.ts:12:4` 和 README.md。',
      '[网页](https://example.com/report.pdf)',
      '[危险](javascript:alert)',
      '`npm run build` 与 `foo.someMethod`',
      '```ts\nconst file = "src/fenced.ts";\n```',
    ].join('\n\n');
    const html = render(source);
    assert.equal((html.match(/class="pd-result-file-link"/g) ?? []).length, 5);
    assert.match(html, /data-result-file="C:\/output\/报告 final.md"/);
    assert.match(html, /data-result-file="reports\/最终 报告.pdf"/);
    assert.match(html, /data-result-file="src\/main.ts"[^>]*><code>src\/main.ts:12:4<\/code>/);
    assert.match(html, /<a href="https:\/\/example.com\/report.pdf">网页<\/a>/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.match(html, /<code>npm run build<\/code>/);
    assert.match(html, /<code>foo.someMethod<\/code>/);
    assert.match(html, /pd-code-block/);
    assert.doesNotMatch(html, /data-result-file="src\/fenced.ts"/);
    assert.match(render('[encoded](C%3A%2Foutput%2Ffile.txt)'), /data-result-file="C:\/output\/file.txt"/);
    assert.doesNotMatch(render('[bad](javascript%3Aalert)'), /pd-result-file-link|href="javascript:/);
    // CommonMark eats "\." and "\_" inside Windows paths; the raw source is restored.
    const windows = render([
      '[ci](E:\\proj\\.github\\workflows\\ci.yml)',
      '[draft](C:\\work\\_draft\\a.md)',
      '打开 E:\\proj\\.vscode\\settings.json 查看，\\*字面星号\\* 保持转义。',
      '[ref][r]\n\n[r]: D:\\repo\\.claude\\notes.md',
    ].join('\n\n'));
    assert.match(windows, /data-result-file="E:\\proj\\.github\\workflows\\ci.yml"/);
    assert.match(windows, /data-result-file="C:\\work\\_draft\\a.md"/);
    assert.match(windows, /data-result-file="E:\\proj\\.vscode\\settings.json"/);
    assert.match(windows, /data-result-file="D:\\repo\\.claude\\notes.md"/);
    assert.match(windows, /\*字面星号\*/);
    assert.doesNotMatch(windows, /\\\*字面星号/);
    assert.doesNotMatch(windows, /proj\.github|work_draft/);
    // Ordinary escapes outside Windows paths are untouched.
    assert.match(render('价格 \\$5 与 a\\_b'), /价格 \$5 与 a_b/);
  } finally { await server.close(); }
});
