/// <reference lib="webworker" />
// FileSystemSyncAccessHandle is synchronous and only available inside a
// worker thread - this keeps disk writes off the main UI thread and off the
// JS heap (receivedChunksRef's old in-memory array), so RAM usage stays flat
// regardless of file size instead of growing with every chunk received.

interface InitFileMessage {
  type: 'INIT_FILE';
  fileId: string;
}

interface WriteChunkMessage {
  type: 'WRITE_CHUNK';
  fileId: string;
  chunk: ArrayBuffer;
  offset: number;
}

interface CloseFileMessage {
  type: 'CLOSE_FILE';
  fileId: string;
}

interface GetFileMessage {
  type: 'GET_FILE';
  fileId: string;
  fileName: string;
  mimeType: string;
}

interface RemoveFileMessage {
  type: 'REMOVE_FILE';
  fileId: string;
}

type IncomingMessage =
  | InitFileMessage
  | WriteChunkMessage
  | CloseFileMessage
  | GetFileMessage
  | RemoveFileMessage;

const activeHandles = new Map<string, FileSystemSyncAccessHandle>();

// WRITE_CHUNK and CLOSE_FILE are handled fully synchronously (no `await`
// before touching `activeHandles`) and deliberately do NOT need the OPFS
// root directory handle at all - they only need the FileSystemSyncAccessHandle
// already sitting in `activeHandles` from a prior INIT_FILE.
//
// This used to `await navigator.storage.getDirectory()` unconditionally at
// the top of the handler for every message, including every single 64 KB
// WRITE_CHUNK. Because `self.onmessage` is itself async, the worker's
// message *task* is considered "done" the moment the handler hits its first
// `await` - it does not wait for that promise to resolve before the next
// queued message's handler starts running. With chunks arriving back to
// back at wire speed, this meant the handler for chunk N could still be
// suspended on `getDirectory()` when chunk N+1's (and eventually
// TRANSFER_COMPLETE's CLOSE_FILE) handler started executing - so
// `handle.close()` could run before an earlier `handle.write()` had
// actually happened, silently dropping the tail of the file (the
// "corrupted/won't open" symptom, worse on larger files and faster
// networks where more chunks are ever in flight at once).
//
// Keeping these two paths synchronous all the way through restores strict
// FIFO ordering between them - a worker thread processes one task to
// completion before the next, as long as nothing in it yields - which
// guarantees every WRITE_CHUNK the main thread sent before CLOSE_FILE has
// been fully applied before the file is flushed and closed.
self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;

  if (data.type === 'WRITE_CHUNK') {
    try {
      const handle = activeHandles.get(data.fileId);
      if (!handle) {
        throw new Error(`No active OPFS handle for file: ${data.fileId}`);
      }
      handle.write(new Uint8Array(data.chunk), { at: data.offset });
      self.postMessage({
        type: 'CHUNK_WRITTEN',
        fileId: data.fileId,
        currentOffset: data.offset + data.chunk.byteLength,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown OPFS worker error';
      self.postMessage({ type: 'ERROR', fileId: data.fileId, error: message });
    }
    return;
  }

  if (data.type === 'CLOSE_FILE') {
    try {
      const handle = activeHandles.get(data.fileId);
      if (handle) {
        handle.flush();
        handle.close();
        activeHandles.delete(data.fileId);
      }
      self.postMessage({ type: 'FILE_CLOSED', fileId: data.fileId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown OPFS worker error';
      self.postMessage({ type: 'ERROR', fileId: data.fileId, error: message });
    }
    return;
  }

  void handleDirectoryBackedMessage(data);
};

// INIT_FILE / GET_FILE / REMOVE_FILE each need the OPFS root directory
// handle and only ever happen once per transfer (before any writes, or
// after all writes are confirmed closed - see opfsClient.ts's awaited
// call sites), so there's no ordering hazard in keeping these async.
async function handleDirectoryBackedMessage(
  data: InitFileMessage | GetFileMessage | RemoveFileMessage,
): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();

    if (data.type === 'INIT_FILE') {
      const fileHandle = await root.getFileHandle(data.fileId, { create: true });
      const accessHandle = await fileHandle.createSyncAccessHandle();
      activeHandles.set(data.fileId, accessHandle);
      self.postMessage({ type: 'INIT_SUCCESS', fileId: data.fileId });
    } else if (data.type === 'GET_FILE') {
      const fileHandle = await root.getFileHandle(data.fileId);
      const file = await fileHandle.getFile();
      // Re-wrap with the real name/type - OPFS only knows the file by its
      // opaque fileId, but the UI and downstream download should see the
      // original filename the sender offered.
      const named = new File([file], data.fileName, { type: data.mimeType });
      self.postMessage({ type: 'FILE_READY', fileId: data.fileId, file: named });
    } else if (data.type === 'REMOVE_FILE') {
      const handle = activeHandles.get(data.fileId);
      if (handle) {
        handle.close();
        activeHandles.delete(data.fileId);
      }
      await root.removeEntry(data.fileId).catch(() => {
        // Already gone - nothing to clean up.
      });
      self.postMessage({ type: 'FILE_REMOVED', fileId: data.fileId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown OPFS worker error';
    self.postMessage({ type: 'ERROR', fileId: data.fileId, error: message });
  }
}
