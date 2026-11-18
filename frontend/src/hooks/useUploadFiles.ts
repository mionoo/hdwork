import { useEffect, useRef, useState } from "react"
import { captureUploadFiles } from "@/lib/upload-files"

export function useUploadFiles() {
  const [preparing, setPreparing] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function capture(files: File[], accept: (files: File[]) => void, reject: (message: string) => void) {
    if (busy.current || !files.length) return
    busy.current = true
    setPreparing(true)
    try {
      const snapshots = await captureUploadFiles(files)
      if (mounted.current) accept(snapshots)
    } catch (error) {
      if (mounted.current) reject(error instanceof Error ? error.message : "Lampiran belum dapat dibaca. Pilih ulang file.")
    } finally {
      busy.current = false
      if (mounted.current) setPreparing(false)
    }
  }

  return { preparing, capture, isPreparing: () => busy.current }
}
