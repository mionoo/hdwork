import { useEffect, useState, type FormEvent } from "react"
import { Archive, Pencil, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/contexts/AuthContext"
import { API_URL } from "@/config/api"

type Group = {
  id: number; name: string; telegram_chat_id: number; telegram_thread_id: number
  city_id: number; city_name: string; segment_id: number; segment_code: string
  category: string; workflow: string | null; is_active: boolean
}
type Options = { cities: { id: number; name: string }[]; segments: { id: number; code: string }[] }
const selectClass = "h-9 rounded-lg border bg-background px-3 text-sm"

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/groups${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || "Gagal memproses grup")
  return result.data as T
}

export default function GroupManagementPage() {
  const { token, user } = useAuth()
  const superAdmin = user?.role === "SUPER_ADMIN"
  const canManage = superAdmin || user?.role === "ADMIN"
  const [groups, setGroups] = useState<Group[]>([])
  const [options, setOptions] = useState<Options>({ cities: [], segments: [] })
  const [cityId, setCityId] = useState("")
  const [archiveView, setArchiveView] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [confirmation, setConfirmation] = useState<{ group: Group; restore: boolean } | null>(null)
  const [form, setForm] = useState({ name: "", city_id: 0, segment_id: 0, category: "PENGAWALAN", workflow: "", is_active: true })
  const archived = superAdmin && archiveView

  useEffect(() => {
    if (!token || !canManage) return
    const controller = new AbortController()
    api<Options>(token, "/options", { signal: controller.signal }).then(setOptions).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Gagal memuat pilihan grup")
    })
    return () => controller.abort()
  }, [token, canManage])

  useEffect(() => {
    if (!token || !canManage) return
    const controller = new AbortController()
    const query = new URLSearchParams()
    if (cityId) query.set("city_id", cityId)
    if (archived) query.set("archived", "1")
    setLoading(true)
    api<Group[]>(token, `/?${query}`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setGroups(data)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setGroups([])
        setError(error instanceof Error ? error.message : "Gagal mengambil grup")
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, canManage, cityId, archived, revision])

  function edit(group: Group) {
    setError("")
    setEditing(group)
    setForm({ name: group.name, city_id: group.city_id, segment_id: group.segment_id, category: group.category, workflow: group.workflow ?? "", is_active: group.is_active })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || !editing || busy) return
    setBusy(true)
    setError("")
    setFeedback("")
    try {
      await api(token, `/${editing.id}`, { method: "PATCH", body: JSON.stringify({ ...form, workflow: form.workflow || null }) })
      setEditing(null)
      setFeedback("Konfigurasi grup disimpan.")
      setRevision((value) => value + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Gagal menyimpan grup")
    } finally { setBusy(false) }
  }

  async function changeArchive() {
    if (!token || !superAdmin || !confirmation || busy) return
    const { group, restore } = confirmation
    setBusy(true)
    setError("")
    setFeedback("")
    try {
      await api(token, `/${group.id}/${restore ? "restore" : "archive"}`, { method: "PATCH" })
      setGroups((items) => items.filter((item) => item.id !== group.id))
      setFeedback(restore ? "Grup dipulihkan sebagai nonaktif." : "Grup dipindahkan ke arsip.")
      setConfirmation(null)
      setRevision((value) => value + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Gagal mengubah arsip grup")
    } finally { setBusy(false) }
  }

  if (!canManage) return <div className="p-6 text-muted-foreground">Halaman ini hanya untuk admin.</div>

  return (
    <div className="min-h-screen bg-muted p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div>
            <h1 className="text-3xl font-semibold">Konfigurasi Grup</h1>
            <p className="text-muted-foreground">Kelola grup dan topik Telegram yang terdaftar</p>
          </div>
          {superAdmin && <select aria-label="Filter kota" className={selectClass} value={cityId} onChange={(event) => {
            setCityId(event.target.value); setLoading(true); setError("")
          }}>
            <option value="">Semua kota</option>
            {options.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>}
        </header>
        {error && !editing && !confirmation && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{archived ? "Arsip Grup" : "Grup Terdaftar"}</CardTitle>
            {superAdmin && <Button variant="outline" onClick={() => {
              setArchiveView(!archived); setLoading(true); setError(""); setFeedback("")
            }}>
              {archived ? "Kembali ke daftar grup" : <><Archive aria-hidden="true" /> Lihat arsip</>}
            </Button>}
          </CardHeader>
          <CardContent>
            {loading ? <p role="status" className="py-8 text-center text-muted-foreground">Memuat grup…</p>
              : groups.length === 0 ? <p className="py-8 text-center text-muted-foreground">
                {error ? "Daftar grup tidak dapat dimuat." : archived ? "Belum ada grup di arsip." : "Belum ada grup terdaftar."}
              </p> : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-muted-foreground">
                    {["Grup / Topik", "Kota", "Segmen", "Jenis", "Alur kerja", "Status", "Aksi"].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}
                  </tr></thead>
                  <tbody>{groups.map((group) => <tr className="border-b" key={group.id}>
                    <td className="p-3"><div className="font-medium">{group.name}</div><div className="whitespace-nowrap text-xs text-muted-foreground">Chat {group.telegram_chat_id}{group.telegram_thread_id ? ` · Topik ${group.telegram_thread_id}` : ""}</div></td>
                    <td className="p-3">{group.city_name}</td>
                    <td className="p-3">{group.segment_code}</td>
                    <td className="p-3">{group.category}</td>
                    <td className="p-3">{group.workflow === "ASSURANCE" ? "Assurance" : group.workflow === "PROVISIONING" ? "Provisioning" : "Belum dipilih"}</td>
                    <td className="p-3"><Badge variant={!archived && group.is_active ? "default" : "outline"}>
                      {archived ? "Diarsipkan" : group.is_active ? "Aktif" : "Nonaktif"}
                    </Badge></td>
                    <td className="p-3"><div className="flex gap-2">
                      {archived ? <Button size="sm" variant="outline" onClick={() => { setError(""); setConfirmation({ group, restore: true }) }}><RotateCcw aria-hidden="true" /> Pulihkan</Button>
                        : <>
                          <Button size="sm" variant="outline" onClick={() => edit(group)}><Pencil aria-hidden="true" /> Edit</Button>
                          {superAdmin && <Button size="sm" variant="outline" onClick={() => { setError(""); setConfirmation({ group, restore: false }) }}><Archive aria-hidden="true" /> Arsipkan</Button>}
                        </>}
                    </div></td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Grup</DialogTitle><DialogDescription>Chat ID dan Topic ID mengikuti konfigurasi Telegram.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={save}>
            <label className="grid gap-1 text-sm font-medium">Nama<input className={selectClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">Kota<select disabled={!superAdmin} className={selectClass} value={form.city_id} onChange={(event) => setForm({ ...form, city_id: Number(event.target.value) })}>{options.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium">Segmen<select className={selectClass} value={form.segment_id} onChange={(event) => setForm({ ...form, segment_id: Number(event.target.value) })}>{options.segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.code}</option>)}</select></label>
            </div>
            <label className="grid gap-1 text-sm font-medium">Jenis<select className={selectClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="PENGAWALAN">Pengawalan</option><option value="LOGIC">Logic</option></select></label>
            <label className="grid gap-1 text-sm font-medium">Alur kerja<select className={selectClass} value={form.workflow} onChange={(event) => setForm({ ...form, workflow: event.target.value })}><option value="">Belum dipilih</option><option value="ASSURANCE">Assurance</option><option value="PROVISIONING">Provisioning</option></select></label>
            <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Grup aktif</label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Batal</Button><Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !busy) setConfirmation(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.restore ? "Pulihkan grup?" : "Arsipkan grup?"}</DialogTitle>
            <DialogDescription>{confirmation?.restore
              ? `${confirmation.group.name} kembali ke daftar grup sebagai nonaktif. Aktifkan lewat Edit jika sudah siap menerima order.`
              : `${confirmation?.group.name ?? ""} akan hilang dari daftar grup dan Breakout Room. Riwayat order tetap tersimpan.`}</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Batal</Button>
            <Button disabled={busy} onClick={changeArchive}>{busy ? "Memproses…" : confirmation?.restore ? "Pulihkan" : "Arsipkan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
