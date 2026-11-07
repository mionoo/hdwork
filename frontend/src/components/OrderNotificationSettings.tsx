import { useEffect, useId, useRef, useState } from "react"
import { Bell, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  orderSoundChoices, playOrderSound, type OrderSoundSettings,
} from "@/lib/order-notification-sound"

export default function OrderNotificationSettings({ settings, ready, onSave, onActivate }: {
  settings: OrderSoundSettings
  ready: boolean
  onSave: (settings: OrderSoundSettings) => void
  onActivate: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState("")
  const groupId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  async function preview(sound = draft.sound) {
    try {
      setError("")
      await onActivate()
      playOrderSound({ sound, volume: draft.volume })
    } catch {
      setError("Suara belum dapat diputar. Coba klik Dengarkan lagi.")
    }
  }

  async function save() {
    try {
      if (draft.sound !== "none" && draft.volume > 0) await onActivate()
      onSave(draft)
      setOpen(false)
    } catch {
      setError("Suara belum dapat diaktifkan. Coba klik Dengarkan.")
    }
  }

  const muted = settings.sound === "none" || settings.volume === 0
  return (
    <>
      <Button ref={trigger} variant="outline" aria-label="Pengaturan notifikasi" onClick={() => { setError(""); setOpen(true) }}>
        {muted ? <VolumeX aria-hidden="true" /> : ready ? <Volume2 aria-hidden="true" /> : <Bell aria-hidden="true" />}
        {muted ? "Suara nonaktif" : ready ? "Suara aktif" : "Aktifkan suara"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent finalFocus={trigger} className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pengaturan notifikasi</DialogTitle>
            <DialogDescription>Suara untuk order baru di grup yang sedang Anda pantau. Pilihan disimpan untuk akun ini di browser ini.</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Pilih suara order baru</legend>
            {orderSoundChoices.map((choice) => (
              <div key={choice.id} className="flex items-center justify-between gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 py-2 text-sm">
                  <input type="radio" name={groupId} value={choice.id} className="size-4 accent-primary"
                    checked={draft.sound === choice.id} onChange={() => setDraft({ ...draft, sound: choice.id })} />
                  <span>{choice.name}<span className="block text-xs text-muted-foreground">{choice.duration}</span></span>
                </label>
                <Button type="button" size="sm" variant="outline" aria-label={`Dengarkan ${choice.name}`}
                  onClick={() => void preview(choice.id)}>Dengarkan</Button>
              </div>
            ))}
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="radio" name={groupId} value="none" className="size-4 accent-primary"
                checked={draft.sound === "none"} onChange={() => setDraft({ ...draft, sound: "none" })} />
              Tanpa suara
            </label>
          </fieldset>
          <div className="mt-4 space-y-2">
            <label htmlFor={`${groupId}-volume`} className="flex justify-between text-sm">
              Volume <span>{Math.round(draft.volume * 100)}%</span>
            </label>
            <input id={`${groupId}-volume`} type="range" min="0" max="100" step="5"
              value={Math.round(draft.volume * 100)} className="w-full accent-primary"
              onChange={(event) => setDraft({ ...draft, volume: Number(event.target.value) / 100 })} />
            <Button variant="outline" size="sm" disabled={draft.sound === "none" || draft.volume === 0}
              onClick={() => void preview()}>Tes notifikasi</Button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => void save()}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
