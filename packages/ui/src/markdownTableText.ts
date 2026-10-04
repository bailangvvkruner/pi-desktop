/**
 * Plain-text exports of a rendered Markdown table (ZCode markdown-table
 * buildMarkdownTableText / buildCsvTableText). Rows are cell texts read from the
 * rendered table, header row first.
 */

/** GitHub-flavored Markdown: pipes are escaped, line breaks collapse to spaces. */
export function tableToMarkdown(rows: readonly (readonly string[])[]): string {
	if (!rows.length) return '';
	const width = Math.max(...rows.map((row) => row.length));
	const cell = (value: string | undefined) => (value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
	const line = (row: readonly string[]) => `| ${Array.from({ length: width }, (_, index) => cell(row[index])).join(' | ')} |`;
	const [header, ...body] = rows;
	return [line(header!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

/** RFC 4180 CSV; fields with commas, quotes or line breaks are quoted. */
export function tableToCsv(rows: readonly (readonly string[])[]): string {
	const width = Math.max(0, ...rows.map((row) => row.length));
	const field = (value: string | undefined) => {
		const text = value ?? '';
		return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};
	return rows.map((row) => Array.from({ length: width }, (_, index) => field(row[index])).join(',')).join('\r\n');
}

/** Cell texts of a rendered table, header included. */
export function readTableRows(table: HTMLTableElement): string[][] {
	return [...table.rows].map((row) => [...row.cells].map((cell) => (cell.innerText ?? cell.textContent ?? '').trim()));
}
