export interface FileMetadata {
    fileId: string;
    name: string;
    size: number;
    type: string;
    totalChunks: number;
    chunkSize: number;
    salt: string;
}
export interface ChunkHeader {
    fileId: string;
    chunkIndex: number;
    byteOffset: number;
    iv: string;
    payloadLength: number;
}
export type FileTransferSignal = {
    type: 'FILE_OFFER';
    metadata: FileMetadata;
} | {
    type: 'FILE_ACCEPT';
    fileId: string;
    startByteOffset: number;
} | {
    type: 'FILE_REJECT';
    fileId: string;
    reason: string;
} | {
    type: 'TRANSFER_COMPLETE';
    fileId: string;
};
