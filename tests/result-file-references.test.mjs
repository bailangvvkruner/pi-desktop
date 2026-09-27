import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseResultFileReference, resultFileTextMatches } from '../packages/ui/src/resultFileReferences.ts';

function assertReference(input, expected, mode = 'link') {
  const actual = parseResultFileReference(input, mode);
  assert.ok(actual, `${mode} should recognize ${JSON.stringify(input)}`);
  assert.equal(actual.path.replaceAll('\\', '/'), expected.path.replaceAll('\\', '/'), input);
  assert.equal(actual.line, expected.line, `${input}: line`);
  assert.equal(actual.column, expected.column, `${input}: column`);
}

test('result links recognize local absolute and relative file paths', () => {
  for (const path of [
    'C:/Users/shuaichao/report.pdf',
    'C:\\Users\\shuaichao\\report.pdf',
    '/tmp/report.pdf',
    './reports/report.pdf',
    '../reports/report.pdf',
    'src/main.ts',
    'README.md',
    '.env',
    '.env.local',
    '.npmrc',
    '.prettierrc',
    'archive.epub',
    'data.bin',
    'C:/Users/小明/My Documents/最终报告.pdf',
    './输出 文件/最终报告.pdf',
  ]) assertReference(path, { path });
});

test('result links decode local file URLs and encoded paths once', () => {
  assertReference('file:///C:/Users/小明/My%20Documents/report.pdf', { path: 'C:/Users/小明/My Documents/report.pdf' });
  assertReference('file:///tmp/report%20final.pdf', { path: '/tmp/report final.pdf' });
  assertReference('C:/reports/%E6%8A%A5%E5%91%8A%20final.pdf', { path: 'C:/reports/报告 final.pdf' });
  assertReference('./reports/report%20final.pdf', { path: './reports/report final.pdf' });
  assertReference('C:/reports/percent%2520literal.pdf', { path: 'C:/reports/percent%20literal.pdf' });
});

test('result links extract line and column suffixes without confusing Windows drive letters', () => {
  assertReference('C:\\project\\src\\main.ts:12:4', { path: 'C:/project/src/main.ts', line: 12, column: 4 });
  assertReference('src/main.ts:12', { path: 'src/main.ts', line: 12 });
  assertReference('/project/src/main.ts#L12', { path: '/project/src/main.ts', line: 12 });
  assertReference('./src/main.ts#L12C4-L18', { path: './src/main.ts', line: 12, column: 4 });
  assertReference('file:///C:/project/src/main.ts#L12C4-L18', { path: 'C:/project/src/main.ts', line: 12, column: 4 });
  assertReference('C:/project/src/main.ts', { path: 'C:/project/src/main.ts' });
});

test('result links reject web links, actions, anchors, and control characters', () => {
  for (const value of [
    '',
    'https://example.com/report.pdf',
    'http://example.com/src/main.ts:12',
    'www.example.com/report.pdf',
    'mailto:report@example.com',
    'tel:123456',
    'javascript:alert(1)',
    'data:text/plain,README.md',
    '#section',
    'C:/reports/bad\u0000name.pdf',
    'C:/reports/bad\nname.pdf',
    'C:/reports/bad\tname.pdf',
    'C:/reports/bad%00name.pdf',
    'C:/reports/bad%0Aname.pdf',
  ]) assert.equal(parseResultFileReference(value), null, JSON.stringify(value));
});

test('result links reject remote shares and Windows device namespaces', () => {
  for (const value of [
    '\\\\server\\share\\report.pdf',
    '//server/share/report.pdf',
    '\\\\?\\C:\\report.pdf',
    '\\\\.\\pipe\\report.pdf',
    '//?/C:/report.pdf',
    'file://server/share/report.pdf',
    '%5C%5Cserver%5Cshare%5Creport.pdf',
  ]) assert.equal(parseResultFileReference(value), null, value);
});

test('automatic references require a recognizable file or explicit path', () => {
  for (const path of [
    'README.md',
    'report.pdf',
    'src/main.ts',
    './src/main.ts',
    'C:/tmp/report.pdf',
    'C:\\tmp\\report.pdf',
    '/tmp/report.pdf',
    'C:/My Documents/最终报告.pdf',
    '/tmp/最终 报告.pdf',
    './输出 文件/最终报告.pdf',
  ]) assertReference(path, { path }, 'auto');
  assertReference('src/main.ts:12:4', { path: 'src/main.ts', line: 12, column: 4 }, 'auto');
});

test('automatic references do not turn prose, commands, code expressions, versions, or domains into files', () => {
  for (const value of [
    'npm run build',
    'node ./scripts/build.js',
    'foo.someMethod',
    '1.2',
    'example.com',
    'hello world',
    'report final.pdf',
    'reports/report final.pdf',
    'https://example.com/README.md',
  ]) assert.equal(parseResultFileReference(value, 'auto'), null, value);
});

test('bare text file references preserve exact offsets and omit surrounding punctuation', () => {
  const text = '生成文件：C:/tmp/report.pdf，修改 src/main.ts:12。另见（README.md）。';
  const expected = [
    ['C:/tmp/report.pdf', { path: 'C:/tmp/report.pdf' }],
    ['src/main.ts:12', { path: 'src/main.ts', line: 12 }],
    ['README.md', { path: 'README.md' }],
  ];
  const matches = resultFileTextMatches(text);
  assert.equal(matches.length, expected.length);
  for (const [index, [source, reference]] of expected.entries()) {
    const match = matches[index];
    assert.equal(match.start, text.indexOf(source));
    assert.equal(match.end, match.start + source.length);
    assert.equal(text.slice(match.start, match.end), source);
    assert.equal(match.reference.path.replaceAll('\\', '/'), reference.path);
    assert.equal(match.reference.line, reference.line);
    assert.equal(match.reference.column, reference.column);
  }
});

test('bare text recognition handles repeated files and ASCII sentence punctuation', () => {
  const text = 'Open (README.md), then src/main.ts:12. See README.md!';
  const matches = resultFileTextMatches(text);
  assert.deepEqual(matches.map(({ start, end }) => text.slice(start, end)), ['README.md', 'src/main.ts:12', 'README.md']);
  assert.equal(matches[0].start, text.indexOf('README.md'));
  assert.equal(matches[2].start, text.lastIndexOf('README.md'));
  assert.ok(matches.every((match, index) => index === 0 || match.start >= matches[index - 1].end));
});

test('bare text recognition never extracts local-looking fragments from URLs', () => {
  const text = 'https://example.com/src/main.ts http://example.com/README.md www.example.com/report.pdf mailto:report@example.com example.com foo.someMethod 1.2';
  assert.deepEqual(resultFileTextMatches(text), []);
  const mixed = `${text} README.md`;
  const matches = resultFileTextMatches(mixed);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].start, mixed.lastIndexOf('README.md'));
  assert.equal(mixed.slice(matches[0].start, matches[0].end), 'README.md');
});
