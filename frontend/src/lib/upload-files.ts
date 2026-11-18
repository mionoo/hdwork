/** Read bytes now: clipboard files can lose their disk backing before submission. */
export async function captureUploadFiles(files: File[]): Promise<File[]> {
  try {
    return await Promise.all(files.map(async (file) => new File(
      [await file.arrayBuffer()], file.name,
      { type: file.type, lastModified: file.lastModified },
    )))
  } catch {
    throw new Error("Lampiran tidak dapat dibaca atau sudah berubah. Pilih ulang file dari perangkat, lalu coba lagi.")
  }
}
