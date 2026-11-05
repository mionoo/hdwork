import { useEffect, useState } from "react"
import { API_URL } from "@/config/api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

type Photo = { id: number }

export default function OrderSourcePhotos({ orderId, photos = [], token }: {
  orderId: number; photos?: Photo[]; token: string | null
}) {
  const [selected, setSelected] = useState<{ url: string; label: string } | null>(null)
  return photos.length > 0 ? (
    <section className="mt-4 space-y-2" aria-label="Foto pesan asli Telegram">
      <p className="text-sm text-muted-foreground">Foto pesan awal · {photos.length} foto</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => <SourcePhoto key={photo.id} orderId={orderId} photo={photo}
          token={token} label={`Foto pesan awal ${index + 1}`} onOpen={setSelected} />)}
      </div>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selected?.label || "Foto pesan awal"}</DialogTitle>
            <DialogDescription>Order #{orderId} · Lampiran asli dari Telegram</DialogDescription>
          </DialogHeader>
          {selected && <img src={selected.url} alt={selected.label} className="max-h-[70svh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </section>
  ) : null
}

function SourcePhoto({ orderId, photo, token, label, onOpen }: {
  orderId: number; photo: Photo; token: string | null; label: string
  onOpen: (photo: { url: string; label: string }) => void
}) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    let blobUrl = ""
    setError(false)
    setUrl("")
    fetch(`${API_URL}/orders/${orderId}/source-photos/${photo.id}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Foto gagal dimuat")
      const blob = await response.blob()
      if (controller.signal.aborted) return
      blobUrl = URL.createObjectURL(blob)
      setUrl(blobUrl)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [orderId, photo.id, token, attempt])

  return url ? <button type="button" aria-label={`Perbesar ${label.toLowerCase()}`}
    className="overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    onClick={() => onOpen({ url, label })}>
    <img src={url} alt={label} className="aspect-square w-full object-cover" onError={() => { setUrl(""); setError(true) }} />
  </button> : <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border bg-muted p-3 text-center text-sm">
    <p className="text-muted-foreground">{error ? "Foto belum dapat dimuat" : "Memuat foto…"}</p>
    {error && <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Coba lagi</Button>}
  </div>
}
