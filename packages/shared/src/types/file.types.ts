export interface FileMetadata{
    fileId: string;
  name: string;
  size: number;
  type: string;
  totalChunks: number;
  chunkSize: number;
  salt: string; // Hex-encoded salt for PBKDF2
}

export interface ChunkHeader {
  fileId: string;
  chunkIndex: number;
  byteOffset: number;
  iv: string; // Hex-encoded 12-byte IV 
  payloadLength: number;
}

export type FileTransferSignal =
    { type: 'FILE_OFFER'; metadata: FileMetadata }
  | { type: 'FILE_ACCEPT'; fileId: string; startByteOffset: number }
  | { type: 'FILE_REJECT'; fileId: string; reason: string }
  | { type: 'TRANSFER_COMPLETE'; fileId: string }
  | { type: 'TRANSFER_PAUSED'; fileId: string }
  | { type: 'TRANSFER_RESUMED'; fileId: string }
  // Receiver -> sender: "my disk can't keep up, stop sending" / "caught up,
  // go ahead". Independent of the user-initiated pause above - a sender
  // combines both into a single effective pause (see usePeerConnection.ts).
  | { type: 'WRITE_BACKPRESSURE'; fileId: string; engaged: boolean };