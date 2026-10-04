import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tableToCsv, tableToMarkdown } from '../packages/ui/src/markdownTableText.ts';

test('table exports produce GitHub Markdown and RFC 4180 CSV from rendered cells', () => {
  const rows = [['文件', '说明'], ['a|b.ts', '含 "引号", 逗号'], ['多行', '第一行\n第二行'], ['短行']];
  assert.equal(tableToMarkdown(rows), [
    '| 文件 | 说明 |',
    '| --- | --- |',
    '| a\\|b.ts | 含 "引号", 逗号 |',
    '| 多行 | 第一行 第二行 |',
    '| 短行 |  |',
  ].join('\n'));
  assert.equal(tableToCsv(rows), '文件,说明\r\na|b.ts,"含 ""引号"", 逗号"\r\n多行,"第一行\n第二行"\r\n短行,');
  assert.equal(tableToMarkdown([]), '');
  assert.equal(tableToCsv([]), '');
});
