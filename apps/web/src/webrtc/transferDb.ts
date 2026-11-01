// Persists receive progress per file so a transfer that gets cut short (page
// reload, dropped connection) can resume from the last written byte instead
// of restarting from zero - see usePeerConnection's FILE_ACCEPT handshake.
// Browsers without IndexedDB (rare) just never find a record, so every
// transfer behaves like today's from-scratch download.

export interface TransferRecord {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  receivedBytes: number;
  isCompleted: boolean;
  updatedAt: number;
}

const DB_NAME = 'airbond_transfers';
const STORE_NAME = 'files';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isTransferDbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveTransferProgress(record: TransferRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getTransferRecord(fileId: string): Promise<TransferRecord | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(fileId);
    request.onsuccess = () => resolve(request.result as TransferRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTransferRecord(fileId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(fileId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listTransferRecords(): Promise<TransferRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as TransferRecord[]) ?? []);
    request.onerror = () => reject(request.error);
  });
}
