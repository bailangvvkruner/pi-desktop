import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { OfficeParagraph, OfficePreview, OfficeRun, OfficeSheet, OfficeTable } from './officePreviewTypes';

export const OFFICE_LIMITS = { archive: 10 * 1024 * 1024, expanded: 24 * 1024 * 1024, xml: 8 * 1024 * 1024, sheets: 50, rows: 1000, columns: 100, cells: 50_000, blocks: 2000, characters: 2_000_000 } as const;
type Node = Record<string, any>;
const array = (value: any): any[] => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
function xml(source: string, ordered = false): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Unsupported XML declaration');
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false, preserveOrder: ordered, processEntities: true }).parse(source);
}
function textValue(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  return String(value['#text'] ?? '');
}
function richText(value: any): string {
  if (!value) return '';
  return value.t !== undefined ? textValue(value.t) : array(value.r).map(run => textValue(run.t)).join('');
}
function columnIndex(reference: string): number {
  let result = 0; for (const char of reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '') result = result * 26 + char.charCodeAt(0) - 64;
  return result - 1;
}
/** Parse only bounded XML parts. External relationships, macros, embedded objects and remote images are never loaded. */
export function parseOfficePreview(bytes: Uint8Array, format: 'docx' | 'xlsx'): OfficePreview {
  if (bytes.length > OFFICE_LIMITS.archive) throw new Error('Office file is too large');
  let total = 0;
  const parts = unzipSync(bytes, { filter: entry => {
    const wanted = format === 'docx' ? entry.name === 'word/document.xml' : /^(?:xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/sheet\d+\.xml))$/.test(entry.name);
    if (!wanted) return false;
    total += entry.originalSize;
    if (entry.originalSize > OFFICE_LIMITS.xml || total > OFFICE_LIMITS.expanded) throw new Error('Expanded Office content is too large');
    return true;
  } });
  const read = (name: string, ordered = false) => {
    const bytes = parts[name]; if (!bytes) return null;
    if (bytes.length > OFFICE_LIMITS.xml) throw new Error('Office XML is too large');
    return xml(strFromU8(bytes), ordered);
  };
  if (format === 'docx') {
    const document = read('word/document.xml', true);
    if (!document) throw new Error('Word document body is missing');
    let truncated = false, count = 0, characters = 0, cellsRead = 0;
    function paragraph(nodes: Node[]): OfficeParagraph {
      const runs: OfficeRun[] = []; let heading: number | undefined;
      const walk = (children: Node[], style: Omit<OfficeRun, 'text'> = {}) => {
        for (const node of children) {
          if (node['w:pStyle']) { const value = node[':@']?.['@_w:val']; const match = /heading\s*([1-6])/i.exec(String(value)); if (match) heading = Number(match[1]); }
          if (node['w:r']) {
            const properties = (node['w:r'] as Node[]).find(child => child['w:rPr'])?.['w:rPr'] ?? [];
            const enabled = (key: string) => properties.some((child: Node) => key in child && !['0', 'false', 'none'].includes(child[':@']?.['@_w:val']));
            walk(node['w:r'], { bold: enabled('w:b'), italic: enabled('w:i'), underline: enabled('w:u') });
          } else if (node['w:t']) {
            const value = node['w:t'].map((item: Node) => item['#text'] ?? '').join('');
            characters += value.length;
            if (characters <= OFFICE_LIMITS.characters) runs.push({ text: value, ...style }); else truncated = true;
          } else if ('w:tab' in node) runs.push({ text: '\t' });
          else if ('w:br' in node) runs.push({ text: '\n' });
          else for (const [key, value] of Object.entries(node)) if (key !== ':@' && Array.isArray(value)) walk(value, style);
        }
      };
      walk(nodes); return { type: 'paragraph', runs, heading };
    }
    const blocks: (OfficeParagraph | OfficeTable)[] = [];
    const body = document.find((item: Node) => item['w:document'])?.['w:document']?.find((item: Node) => item['w:body'])?.['w:body'];
    if (!Array.isArray(body)) throw new Error('Word document body is invalid');
    for (const node of body) {
      if (count++ >= OFFICE_LIMITS.blocks || characters >= OFFICE_LIMITS.characters) { truncated = true; break; }
      if (node['w:p']) blocks.push(paragraph(node['w:p']));
      if (node['w:tbl']) {
        const rows: OfficeParagraph[][][] = [];
        for (const row of node['w:tbl'].filter((child: Node) => child['w:tr'])) {
          if (rows.length >= OFFICE_LIMITS.rows || characters >= OFFICE_LIMITS.characters || cellsRead >= OFFICE_LIMITS.cells) { truncated = true; break; }
          const cells = row['w:tr'].filter((child: Node) => child['w:tc']);
          if (cells.length > OFFICE_LIMITS.columns) truncated = true;
          const limited = cells.slice(0, Math.min(OFFICE_LIMITS.columns, OFFICE_LIMITS.cells - cellsRead));
          cellsRead += limited.length;
          if (limited.length < cells.length) truncated = true;
          rows.push(limited.map((cell: Node) => cell['w:tc'].filter((child: Node) => child['w:p']).map((child: Node) => paragraph(child['w:p']))));
        }
        blocks.push({ type: 'table', rows });
      }
    }
    return { format, blocks, truncated };
  }
  const workbook = read('xl/workbook.xml')?.workbook;
  if (!workbook) throw new Error('Excel workbook is missing');
  const relations = new Map<string, string>();
  for (const relation of array(read('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship)) {
    if (relation['@_TargetMode'] === 'External') continue;
    const target = String(relation['@_Target'] ?? '').replace(/^\//, '');
    const path = target.startsWith('xl/') ? target : `xl/${target}`;
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) relations.set(relation['@_Id'], path);
  }
  const strings = array(read('xl/sharedStrings.xml')?.sst?.si).map(richText);
  const entries = array(workbook.sheets?.sheet);
  let count = 0, characters = 0, truncated = entries.length > OFFICE_LIMITS.sheets;
  const sheets: OfficeSheet[] = [];
  for (const entry of entries.slice(0, OFFICE_LIMITS.sheets)) {
    const path = relations.get(entry['@_r:id']);
    const worksheet = path && read(path)?.worksheet;
    if (!worksheet) continue;
    const sheet: OfficeSheet = { name: String(entry['@_name'] ?? 'Sheet'), rows: [], columns: 0, truncated: false };
    const rows = array(worksheet.sheetData?.row);
    for (const row of rows) {
      if (sheet.rows.length >= OFFICE_LIMITS.rows || count >= OFFICE_LIMITS.cells || characters >= OFFICE_LIMITS.characters) { sheet.truncated = true; break; }
      const cells: string[] = [];
      for (const cell of array(row.c)) {
        const index = columnIndex(String(cell['@_r'] ?? ''));
        if (index < 0 || index >= OFFICE_LIMITS.columns || count >= OFFICE_LIMITS.cells) { sheet.truncated = true; continue; }
        let value = cell['@_t'] === 's' ? strings[Number(textValue(cell.v))] ?? '' : cell['@_t'] === 'inlineStr' ? richText(cell.is) : textValue(cell.v);
        if (cell['@_t'] === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        // Cached formula results are displayed; no formula or external connection is executed.
        if (cell.f !== undefined && cell.v === undefined) value = `=${textValue(cell.f)}`;
        if (value.length > 32_000) { value = value.slice(0, 32_000) + '…'; sheet.truncated = true; }
        characters += value.length; count++;
        if (characters > OFFICE_LIMITS.characters) { sheet.truncated = true; break; }
        cells[index] = value;
      }
      sheet.columns = Math.max(sheet.columns, cells.length);
      sheet.rows.push({ number: Number(row['@_r']) || sheet.rows.length + 1, cells });
    }
    sheets.push(sheet); truncated ||= sheet.truncated;
  }
  if (!sheets.length) throw new Error('Excel worksheets are missing or unsupported');
  return { format, sheets, truncated };
}
