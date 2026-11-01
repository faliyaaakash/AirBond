// A random UUID per send would make every resend of "the same file" look like
// a brand new transfer to the receiver, defeating resume - so the id is
// derived from stable file identity (name + size + lastModified) instead.
// Re-selecting the same file after a dropped connection reproduces the exact
// same id, which is how the receiver's IndexedDB lookup finds the prior
// progress record.
export async function computeFileId(file: File): Promise<string> {
  const identity = `${file.name}:${file.size}:${file.lastModified}`;
  const bytes = new TextEncoder().encode(identity);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
