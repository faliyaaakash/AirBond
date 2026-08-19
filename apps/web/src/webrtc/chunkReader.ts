export async function sendRawFile(file: File, dataChannel: RTCDataChannel) {
  const CHUNK_SIZE = 64 * 1024; // 64 KB
  let offset = 0;

  // Send header metadata first
  dataChannel.send(JSON.stringify({ type: 'HEADER', name: file.name, size: file.size }));

  while (offset < file.size) {
    // Backpressure check: wait if buffer exceeds 1 MB
    if (dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    dataChannel.send(buffer);
    offset += buffer.byteLength;
  }

  // Send completion message
  dataChannel.send(JSON.stringify({ type: 'EOF' }));
}