/** A file mentioned in a result, resolved relative to the conversation's directory. */
export interface ResultFileTarget {
  cwd: string;
  path: string;
  line?: number;
  column?: number;
}

export interface ResultFilePreview {
  path: string;
  name: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'unsupported' | 'directory';
  text?: string;
  dataUrl?: string;
  truncated?: boolean;
  reason?: 'too-large' | 'unsupported';
}

export interface ResultFilesBridge {
  openResultFile(target: ResultFileTarget): Promise<void>;
  revealResultFile(target: ResultFileTarget): Promise<void>;
  previewResultFile(target: ResultFileTarget): Promise<ResultFilePreview>;
}
