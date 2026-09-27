const LEGACY_REASONING_DELTA = 'response.reasoning.delta';
const REASONING_TEXT_DELTA = 'response.reasoning_text.delta';
const MAX_FRAME_BYTES = 64 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/** Locate the effective top-level type value without serializing other JSON values. */
function typeValueRange(data: string): [number, number] | undefined {
  let depth = 0;
  let range: [number, number] | undefined;
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]]/g;
  for (const token of data.matchAll(tokens)) {
    if (token[0] === '{' || token[0] === '[') depth += 1;
    else if (token[0] === '}' || token[0] === ']') depth -= 1;
    else if (depth === 1 && JSON.parse(token[0]) === 'type') {
      const after = token.index! + token[0].length;
      const value = /^\s*:\s*("(?:[^"\\]|\\.)*")/.exec(data.slice(after));
      if (value) range = [after + value[0].length - value[1]!.length, after + value[0].length];
    }
  }
  return range;
}

/** Unknown events, malformed data, and all non-type payload bytes remain intact. */
function normalizeFrame(bytes: Uint8Array): Uint8Array {
  let frame: string;
  try { frame = decoder.decode(bytes); } catch { return bytes; }
  const fields: { kind: string; value: string; start: number; dataStart?: number }[] = [];
  let data = '';
  for (const match of frame.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)) {
    const line = match[1]!;
    const bom = match.index === 0 && line.startsWith('\uFEFF') ? 1 : 0;
    const field = /^(data|event): ?(.*)$/.exec(line.slice(bom));
    if (!field) continue;
    const value = field[2]!;
    const start = match.index! + line.length - value.length;
    fields.push({ kind: field[1]!, value, start, ...(field[1] === 'data' ? { dataStart: data.length } : {}) });
    if (field[1] === 'data') data += value + '\n';
  }
  try {
    const payload: unknown = JSON.parse(data);
    if (!payload || typeof payload !== 'object' || !('type' in payload) || payload.type !== LEGACY_REASONING_DELTA || !('delta' in payload) || typeof payload.delta !== 'string') return bytes;
  } catch { return bytes; }
  const range = typeValueRange(data);
  if (!range) return bytes;
  const field = fields.find((item) => item.dataStart !== undefined && range[0] >= item.dataStart && range[1] <= item.dataStart + item.value.length);
  if (!field || field.dataStart === undefined) return bytes;
  const changes = [{ start: field.start + range[0] - field.dataStart, end: field.start + range[1] - field.dataStart, value: JSON.stringify(REASONING_TEXT_DELTA) }];
  for (const item of fields) {
    if (item.kind === 'event' && item.value === LEGACY_REASONING_DELTA) changes.push({ start: item.start, end: item.start + item.value.length, value: REASONING_TEXT_DELTA });
  }
  for (const change of changes.sort((a, b) => b.start - a.start)) frame = frame.slice(0, change.start) + change.value + frame.slice(change.end);
  return encoder.encode(frame);
}

/** Normalize one gateway alias before the Responses SDK consumes its SSE stream. */
export function normalizeResponsesReasoningStream(response: Response): Response {
  if (!response.ok || !response.body || response.bodyUsed || response.body.locked || response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/event-stream') return response;
  let parts: Uint8Array[] = [];
  let size = 0;
  let passthrough = false;
  let lineHasContent = false;
  let previousCR = false;
  let endedWithCR = false;
  const takeFrame = () => {
    const frame = parts.length === 1 ? parts[0]! : new Uint8Array(size);
    if (parts.length !== 1) { let offset = 0; for (const part of parts) { frame.set(part, offset); offset += part.byteLength; } }
    parts = []; size = 0;
    return frame;
  };
  const append = (part: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!part.byteLength) return;
    if (!passthrough && size + part.byteLength > MAX_FRAME_BYTES) {
      for (const pending of parts) controller.enqueue(pending);
      parts = []; size = 0; passthrough = true;
    }
    if (passthrough) controller.enqueue(part);
    else { parts.push(part.slice()); size += part.byteLength; }
  };
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let start = 0;
      for (let index = 0; index < chunk.byteLength; index += 1) {
        const byte = chunk[index];
        if (previousCR) {
          previousCR = false;
          if (byte === 10) {
            // Deliver the LF of a completed CRLF frame immediately, even when
            // its CR and LF arrived in separate network chunks.
            if (endedWithCR) { controller.enqueue(chunk.subarray(index, index + 1)); start = index + 1; endedWithCR = false; }
            continue;
          }
          endedWithCR = false;
        }
        if (byte === 13 || byte === 10) {
          const boundary = !lineHasContent;
          lineHasContent = false; previousCR = byte === 13;
          if (boundary) {
            append(chunk.subarray(start, index + 1), controller);
            if (!passthrough && size) controller.enqueue(normalizeFrame(takeFrame()));
            passthrough = false; endedWithCR = byte === 13; start = index + 1;
          }
        } else lineHasContent = true;
      }
      append(chunk.subarray(start), controller);
    },
    flush(controller) { if (size) controller.enqueue(takeFrame()); },
  }));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const normalized = new Response(body, { status: response.status, statusText: response.statusText, headers });
  Object.defineProperties(normalized, {
    url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type },
  });
  return normalized;
}
