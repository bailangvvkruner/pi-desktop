import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { parseOfficePreview, OFFICE_LIMITS } from '../packages/ui/src/officePreviewParser.ts';
const require = createRequire(new URL('../packages/ui/package.json', import.meta.url));
const { zipSync, strToU8 } = require('fflate');
const zip = files => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));

test('Word preview preserves paragraph order, emphasis, heading and table text without active HTML', () => {
  const document = '<w:document xmlns:w="word"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>中文 &amp; &lt;script&gt;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const preview = parseOfficePreview(zip({ 'word/document.xml': document }), 'docx');
  assert.equal(preview.blocks[0].heading, 1);
  assert.deepEqual(preview.blocks[0].runs, [{ text: '中文 & <script>', bold: true, italic: false, underline: false }]);
  assert.equal(preview.blocks[1].rows[0][0][0].runs[0].text, 'Cell');
});
test('Excel preview resolves shared strings, sparse positions, cached formulas and selectable sheets', () => {
  const preview = parseOfficePreview(zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="数据" r:id="r1"/><sheet name="Empty" r:id="r2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="r3" Target="https://example.test/evil" TargetMode="External"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>姓名</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+2</f><v>3</v></c><c r="D1" t="inlineStr"><is><t>&lt;img&gt;</t></is></c></row><row r="3"><c r="B3" t="b"><v>1</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
  }), 'xlsx');
  assert.deepEqual(preview.sheets.map(sheet => sheet.name), ['数据', 'Empty']);
  assert.equal(preview.sheets[0].rows[0].cells[0], '姓名');
  assert.equal(preview.sheets[0].rows[0].cells[2], '3');
  assert.equal(preview.sheets[0].rows[0].cells[3], '<img>');
  assert.equal(preview.sheets[0].rows[1].number, 3);
  assert.equal(preview.sheets[0].rows[1].cells[1], 'TRUE');
});
test('Office reader rejects active XML, oversized expansion and invalid containers', () => {
  assert.throws(() => parseOfficePreview(zip({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY e "bad">]><w:document/>' }), 'docx'), /XML declaration/);
  assert.throws(() => parseOfficePreview(zip({ 'word/document.xml': 'x'.repeat(OFFICE_LIMITS.xml + 1) }), 'docx'), /too large/);
  assert.throws(() => parseOfficePreview(new Uint8Array([1, 2, 3]), 'docx'));
  assert.throws(() => parseOfficePreview(zip({ 'other.xml': '<empty/>' }), 'docx'), /missing/);
});
