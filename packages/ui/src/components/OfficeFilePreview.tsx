import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { OfficeParagraph, OfficePreview } from '../officePreviewTypes';
import './officeFilePreview.css';

function Paragraph({ value }: { value: OfficeParagraph }) {
  return <p className={value.heading ? `is-heading level-${value.heading}` : undefined} role={value.heading ? 'heading' : undefined} aria-level={value.heading}>{value.runs.map((run, index) => <span key={index} style={{ fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? 'italic' : undefined, textDecoration: run.underline ? 'underline' : undefined }}>{run.text}</span>)}</p>;
}
function columnName(index: number): string { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }

export default function OfficeFilePreview({ bytesBase64, format }: { bytesBase64: string; format: 'docx' | 'xlsx' | 'pptx' }) {
  const { locale } = useT();
  const label = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  const [preview, setPreview] = useState<OfficePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [rowLimit, setRowLimit] = useState(100);
  useEffect(() => {
    let active = true, worker: Worker | undefined;
    setPreview(null); setError(null); setSheetIndex(0); setRowLimit(100);
    const timeout = setTimeout(() => { if (active) setError(label('预览处理超时，请使用默认应用打开文件。', 'Preview timed out. Open the file in its default app.')); worker?.terminate(); }, 15_000);
    try {
      if (bytesBase64.length > 14 * 1024 * 1024) throw new Error('File is too large');
      const bytes = Uint8Array.from(atob(bytesBase64), char => char.charCodeAt(0));
      worker = new Worker(new URL('../officePreview.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ preview?: OfficePreview; error?: string }>) => { if (!active) return; clearTimeout(timeout); setPreview(event.data.preview ?? null); setError(event.data.error ?? null); worker?.terminate(); };
      worker.onerror = () => { if (active) setError(label('无法处理此文档，请使用默认应用打开。', 'This document could not be processed. Open it in its default app.')); clearTimeout(timeout); worker?.terminate(); };
      worker.postMessage({ bytes, format }, [bytes.buffer]);
    } catch (cause) { clearTimeout(timeout); setError(cause instanceof Error ? cause.message : String(cause)); worker?.terminate(); }
    return () => { active = false; clearTimeout(timeout); worker?.terminate(); };
  }, [bytesBase64, format, locale]);
  if (error) return <div className="pd-result-file-preview-state" role="alert"><strong>{label('无法预览文档', 'Unable to preview document')}</strong><p>{error}</p></div>;
  if (!preview) return <div className="pd-result-file-preview-state" role="status"><p>{label('正在读取文档…', 'Reading document…')}</p></div>;
  const sheet = preview.format === 'xlsx' ? preview.sheets[sheetIndex] : undefined;
  return <div className="pd-office-preview">
    <div className="pd-office-preview-toolbar"><span>{label('只读预览', 'Read-only preview')}</span>{preview.format === 'xlsx' && <label>{label('工作表', 'Sheet')} <select aria-label={label('工作表', 'Sheet')} value={sheetIndex} onChange={event => { setSheetIndex(Number(event.target.value)); setRowLimit(100); }}>{preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>}</div>
    <p className="pd-office-preview-note">{preview.format === 'docx' ? label('显示正文和表格；分页、图形及复杂排版请在默认应用中查看。', 'Text and tables are shown. Open the default app for pagination, graphics and advanced layout.') : preview.format === 'pptx' ? label('按幻灯片显示文字内容；图片、动画和排版请在默认应用中查看。', 'Shows slide text in order. Open the default app for images, animations and layout.') : label('显示单元格内容及已保存的公式结果；图表、合并样式和数字格式请在默认应用中查看。', 'Shows cell content and saved formula results. Open the default app for charts, merged styles and number formatting.')}{preview.truncated && <strong> {label('内容超过预览上限，部分内容已省略。', 'Some content exceeds the preview limit and was omitted.')}</strong>}</p>
    <div className="pd-office-preview-content" tabIndex={0} aria-label={label('文档内容', 'Document content')}>
      {preview.format === 'docx' ? <article className="pd-office-document">{preview.blocks.map((block, index) => block.type === 'paragraph' ? <Paragraph key={index} value={block} /> : <table key={index}><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column}>{cell.map((paragraph, paragraphIndex) => <Paragraph key={paragraphIndex} value={paragraph} />)}</td>)}</tr>)}</tbody></table>)}</article> : preview.format === 'pptx' ? <div className="pd-office-slides">
        {preview.slides.map(slide => <section key={slide.index} className="pd-office-slide" aria-label={label(`第 ${slide.index} 张幻灯片`, `Slide ${slide.index}`)}><h3>{label('幻灯片', 'Slide')} {slide.index}</h3>{slide.texts.length ? slide.texts.map((text, index) => <p key={index}>{text}</p>) : <p className="pd-office-slide-empty">{label('此幻灯片没有文字内容', 'No text on this slide')}</p>}</section>)}
        {preview.slides.length === 0 && <p>{label('没有可显示的幻灯片文字', 'No slide text to display')}</p>}
      </div> : sheet && <>
        <table className="pd-office-sheet" aria-label={sheet.name}><thead><tr><th scope="col">#</th>{Array.from({ length: sheet.columns }, (_, index) => <th key={index} scope="col">{columnName(index)}</th>)}</tr></thead><tbody>{sheet.rows.slice(0, rowLimit).map(row => <tr key={row.number}><th scope="row">{row.number}</th>{Array.from({ length: sheet.columns }, (_, column) => <td key={column} title={row.cells[column] ?? ''}>{row.cells[column] ?? ''}</td>)}</tr>)}</tbody></table>
        {rowLimit < sheet.rows.length && <button type="button" className="pd-workbench-show-lines" onClick={() => setRowLimit(value => value + 100)}>{label('继续显示后续行', 'Show more rows')} ({Math.min(rowLimit, sheet.rows.length)}/{sheet.rows.length})</button>}
        {sheet.rows.length === 0 && <p>{label('工作表为空', 'This sheet is empty')}</p>}
      </>}
    </div>
  </div>;
}
