import { parseOfficePreview } from './officePreviewParser';
self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; format: 'docx' | 'xlsx' }>) => {
  try { self.postMessage({ preview: parseOfficePreview(event.data.bytes, event.data.format) }); }
  catch (cause) { self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) }); }
};
