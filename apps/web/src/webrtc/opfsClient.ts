// Thin promise-based wrapper around opfsWorker.ts's postMessage protocol, so
// usePeerConnection can await INIT/CLOSE/GET/REMOVE without hand-rolling
// correlation IDs at every call site. WRITE_CHUNK is intentionally fire-and-
// forget (see writeChunk) to keep incoming data-channel messages flowing at
// wire speed instead of round-tripping to the worker per 64 KB chunk.

type WorkerResponse =
  | { type: 'INIT_SUCCESS'; fileId: string }
  | { type: 'CHUNK_WRITTEN'; fileId: string; currentOffset: number }
  | { type: 'FILE_CLOSED'; fileId: string }
  | { type: 'FILE_READY'; fileId: string; file: File }
  | { type: 'FILE_REMOVED'; fileId: string }
  | { type: 'ERROR'; fileId: string | null; error: string };

let worker: Worker | null = null;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

// CHUNK_WRITTEN confirmations are high-frequency (one per 64 KB chunk) and
// nobody awaits them individually - writeChunk is fire-and-forget by design.
// This is a separate, persistent listener per fileId (not the one-shot
// `pending` map above) so a caller can track how far writes have actually
// landed on disk, e.g. to detect write backpressure.
const chunkWrittenListeners = new Map<string, (currentOffset: number) => void>();

export function onChunkWritten(fileId: string, listener: ((currentOffset: number) => void) | null): void {
  if (listener) chunkWrittenListeners.set(fileId, listener);
  else chunkWrittenListeners.delete(fileId);
}

// A WRITE_CHUNK failure (e.g. OPFS quota exceeded, disk error) used to be
// completely silent: writeChunk is fire-and-forget, so nothing was ever
// awaiting that particular message to catch its rejection, and the worker's
// ERROR branch only forwards to a *pending* (awaited) request. The write
// itself would just never happen while receivedTotalRef kept counting the
// bytes as if it had - silently producing a corrupted file with no error
// anywhere. This is the write-side counterpart to chunkWrittenListeners,
// letting a caller actually find out when a write it never awaited failed.
const writeErrorListeners = new Map<string, (error: string) => void>();

export function onWriteError(fileId: string, listener: ((error: string) => void) | null): void {
  if (listener) writeErrorListeners.set(fileId, listener);
  else writeErrorListeners.delete(fileId);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/opfsWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data;
    if (data.type === 'ERROR') {
      const key = data.fileId ? pendingKeyFor(data.fileId) : undefined;
      if (key && pending.has(key)) {
        pending.get(key)!.reject(new Error(data.error));
        pending.delete(key);
        return;
      }
      // No pending (awaited) request matches - this was a fire-and-forget
      // WRITE_CHUNK failing. Tell whoever's listening instead of dropping it.
      if (data.fileId) writeErrorListeners.get(data.fileId)?.(data.error);
      return;
    }
    if (data.type === 'CHUNK_WRITTEN') {
      chunkWrittenListeners.get(data.fileId)?.(data.currentOffset);
      return;
    }
    const key = `${data.type}:${data.fileId}`;
    const waiter = pending.get(key);
    if (waiter) {
      waiter.resolve(data);
      pending.delete(key);
    }
  };
  return worker;
}

// Used only to clear out any pending wait for a given fileId when an ERROR
// arrives (ERROR messages don't say which request type failed).
function pendingKeyFor(fileId: string): string | undefined {
  for (const key of pending.keys()) {
    if (key.endsWith(`:${fileId}`)) return key;
  }
  return undefined;
}

function awaitResponse<T>(responseType: string, fileId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.set(`${responseType}:${fileId}`, { resolve: resolve as (v: unknown) => void, reject });
  });
}

export async function initFile(fileId: string): Promise<void> {
  const w = getWorker();
  const result = awaitResponse('INIT_SUCCESS', fileId);
  w.postMessage({ type: 'INIT_FILE', fileId });
  await result;
}

// Fire-and-forget by design (see module doc comment above).
export function writeChunk(fileId: string, chunk: ArrayBuffer, offset: number): void {
  getWorker().postMessage({ type: 'WRITE_CHUNK', fileId, chunk, offset }, [chunk]);
}

export async function closeFile(fileId: string): Promise<void> {
  const w = getWorker();
  const result = awaitResponse('FILE_CLOSED', fileId);
  w.postMessage({ type: 'CLOSE_FILE', fileId });
  await result;
}

export async function getOpfsFile(fileId: string, fileName: string, mimeType: string): Promise<File> {
  const w = getWorker();
  const result = awaitResponse<{ file: File }>('FILE_READY', fileId);
  w.postMessage({ type: 'GET_FILE', fileId, fileName, mimeType });
  const { file } = await result;
  return file;
}

export async function removeOpfsFile(fileId: string): Promise<void> {
  const w = getWorker();
  const result = awaitResponse('FILE_REMOVED', fileId);
  w.postMessage({ type: 'REMOVE_FILE', fileId });
  await result;
}
