import { useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { useT } from '../i18n';
import { readTableRows, tableToCsv, tableToMarkdown } from '../markdownTableText';
import { operationFeedback } from '../operationFeedback';
import { ContentPreviewDialog } from './ContentPreviewDialog';
import { Icon } from './Icons';

type TableProps = ComponentPropsWithoutRef<'table'> & { node?: unknown };

/**
 * Markdown tables with copy/export actions and a full-window view for wide data
 * (ZCode markdown-table). Exports read the rendered cells, so they match what
 * the reader sees, including linkified paths.
 */
export function MarkdownTable({ node: _node, children, ...props }: TableProps) {
	const { t } = useT();
	const table = useRef<HTMLTableElement>(null);
	const [preview, setPreview] = useState(false);
	const rows = () => (table.current ? readTableRows(table.current) : []);
	const copy = async (format: 'markdown' | 'csv') => {
		const text = format === 'markdown' ? tableToMarkdown(rows()) : tableToCsv(rows());
		try {
			await navigator.clipboard.writeText(text);
			operationFeedback.show({ id: 'markdown-table-copy', kind: 'success', title: t(format === 'markdown' ? 'markdownTable.copiedMarkdown' : 'markdownTable.copiedCsv') });
		} catch {
			operationFeedback.show({ id: 'markdown-table-copy', kind: 'error', title: t('markdownTable.copyFailed') });
		}
	};
	const download = () => {
		// A BOM lets spreadsheet apps detect UTF-8, so CJK text survives the round trip.
		const url = URL.createObjectURL(new Blob(['﻿', tableToCsv(rows())], { type: 'text/csv;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'table.csv';
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
	};
	return <div className="pd-md-table">
		<div className="pd-md-table-actions" role="toolbar" aria-label={t('markdownTable.actions')}>
			<button type="button" onClick={() => void copy('markdown')}>{t('markdownTable.copyMarkdown')}</button>
			<button type="button" onClick={() => void copy('csv')}>{t('markdownTable.copyCsv')}</button>
			<button type="button" onClick={download}>{t('markdownTable.downloadCsv')}</button>
			<button type="button" onClick={() => setPreview(true)} aria-label={t('markdownTable.preview')}><Icon name="maximize" width="12" height="12" /></button>
		</div>
		<div className="pd-md-table-scroll"><table ref={table} {...props}>{children}</table></div>
		{preview && <ContentPreviewDialog title={t('markdownTable.previewTitle')} onClose={() => setPreview(false)} bodyClassName="pd-md-table-preview">
			<table {...props}>{children}</table>
		</ContentPreviewDialog>}
	</div>;
}
