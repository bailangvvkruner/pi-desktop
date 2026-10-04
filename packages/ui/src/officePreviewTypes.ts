export interface OfficeRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
export interface OfficeParagraph { type: 'paragraph'; runs: OfficeRun[]; heading?: number }
export interface OfficeTable { type: 'table'; rows: OfficeParagraph[][][] }
export interface OfficeSheet { name: string; rows: { number: number; cells: string[] }[]; columns: number; truncated: boolean }
/** One PowerPoint slide: the text runs it contains, in document order. */
export interface OfficeSlide { index: number; texts: string[] }
export type OfficePreview = { format: 'docx'; blocks: (OfficeParagraph | OfficeTable)[]; truncated: boolean } | { format: 'xlsx'; sheets: OfficeSheet[]; truncated: boolean } | { format: 'pptx'; slides: OfficeSlide[]; truncated: boolean };
