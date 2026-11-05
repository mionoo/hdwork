import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronRight } from "lucide-react"
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { API_URL } from "@/config/api"
import { useAuth } from "@/contexts/AuthContext"
import {
  clearActiveOrderRoom, readActiveOrderRoom, readMonitoredOrderGroups,
  rememberActiveOrderRoom, rememberMonitoredOrderGroups,
} from "@/lib/active-order-room"
import OrdersPage from "@/pages/OrdersPage"

const workflows = { ASSURANCE: "Assurance", PROVISIONING: "Provisioning" } as const
const groupCategories = { PENGAWALAN: "Pengawalan", LOGIC: "Logic" } as const
type Workflow = keyof typeof workflows
type Segment = { id: number; code: string }
type Room = { id: number; name: string; segment_id: number; workflow: Workflow; category: keyof typeof groupCategories; city_name: string }
type Catalog = { segments: Segment[]; rooms: Room[] }

const segmentLabel = (code: string) => code === "REPLACE_ONT" ? "Replace ONT" : code
const monitorPath = "/orders?pantau=1"

function useRoomCatalog() {
  const { token } = useAuth()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    fetch(`${API_URL}/groups/rooms`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Daftar ruang tidak dapat dimuat.")
      const payload = await response.json()
      setCatalog(payload.data)
    }).catch(() => {
      if (!controller.signal.aborted) setError("Daftar ruang tidak dapat dimuat. Coba lagi.")
    })
    return () => controller.abort()
  }, [token, attempt])
  return { catalog, error, retry: () => { setError(""); setAttempt((current) => current + 1) } }
}

function CatalogStatus({ error, retry }: { error: string; retry: () => void }) {
  return error
    ? <div className="space-y-3 p-6"><p role="alert">{error}</p><Button onClick={retry}>Coba lagi</Button></div>
    : <p role="status" className="p-6 text-muted-foreground">Memuat ruang kerja…</p>
}

export function RoomOrdersRoute() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  if (params.get("pantau") === "1") {
    return <MonitoredOrders key={user?.id} />
  }
  const roomId = params.get("room")
  if (roomId && /^\d+$/.test(roomId)) {
    return <RoomOrders key={`${user?.id}:${roomId}`} roomId={roomId} />
  }
  const remembered = roomId === null && user ? readActiveOrderRoom(user.id) : null
  return <Navigate to={remembered ? `/orders?room=${remembered}` : "/breakout-room"} replace />
}

function RoomOrders({ roomId }: { roomId: string }) {
  const state = useRoomCatalog()
  const { user } = useAuth()
  const navigate = useNavigate()
  const room = state.catalog?.rooms.find((item) => String(item.id) === roomId)
  const segment = state.catalog?.segments.find((item) => Number(item.id) === Number(room?.segment_id))
  const verified = Boolean(room && segment)
  const catalogLoaded = Boolean(state.catalog)
  const userId = user?.id
  useEffect(() => {
    if (!catalogLoaded || userId === undefined) return
    if (verified) rememberActiveOrderRoom(userId, roomId)
    else if (readActiveOrderRoom(userId) === roomId) clearActiveOrderRoom()
  }, [catalogLoaded, roomId, userId, verified])
  if (!state.catalog) return <CatalogStatus {...state} />
  if (!room || !segment) return <Navigate to="/breakout-room" replace state={{ roomUnavailable: true }} />
  return <OrdersPage room={{ id: room.id, name: room.name, context: `${segmentLabel(segment.code)} / ${workflows[room.workflow]} / ${room.city_name}` }}
    controls={<Button variant="outline" onClick={() => navigate(monitorPath)}>Pantau grup</Button>}
    onLeaveRoom={() => {
      clearActiveOrderRoom()
      navigate("/breakout-room", { replace: true })
    }} />
}

function MonitoredOrders() {
  const state = useRoomCatalog()
  const { user } = useAuth()
  if (!state.catalog) return <CatalogStatus {...state} />
  if (!user) return <Navigate to="/login" replace />
  return <MonitorCatalog catalog={state.catalog} userId={user.id} />
}

function MonitorCatalog({ catalog, userId }: { catalog: Catalog; userId: number }) {
  const navigate = useNavigate()
  const activeRoom = readActiveOrderRoom(userId)
  const [selected, setSelected] = useState(() => {
    const saved = readMonitoredOrderGroups(userId)
    return catalog.rooms.filter((room) => saved.includes(Number(room.id))).map((room) => Number(room.id))
  })
  const [draft, setDraft] = useState<number[] | null>(() => selected.length ? null :
    catalog.rooms.filter((room) => String(room.id) === activeRoom).map((room) => Number(room.id)))
  const pickerHeading = useRef<HTMLHeadingElement>(null)
  const pickerButton = useRef<HTMLButtonElement>(null)
  const picking = draft !== null
  useEffect(() => {
    if (picking) pickerHeading.current?.focus()
    else pickerButton.current?.focus()
  }, [picking])

  const controls = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => navigate("/orders")}>{activeRoom ? "Ruang aktif" : "Pilih ruang"}</Button>
      <Button ref={pickerButton} variant="outline" aria-expanded={picking} aria-controls={picking ? "monitor-group-picker" : undefined}
        disabled={!catalog.rooms.length} onClick={() => setDraft(picking ? null : selected)}>
        Pilih grup{selected.length > 0 && ` (${selected.length})`}
      </Button>
    </div>
  )

  const picker = draft && catalog.rooms.length > 0 && (
    <section id="monitor-group-picker" aria-labelledby="monitor-group-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <h2 ref={pickerHeading} tabIndex={-1} id="monitor-group-heading" className="text-lg font-semibold">
        Pilih grup yang ingin dipantau
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.rooms.map((room) => {
          const id = Number(room.id)
          const segment = catalog.segments.find((item) => Number(item.id) === Number(room.segment_id))
          const context = [segment && segmentLabel(segment.code), workflows[room.workflow], groupCategories[room.category], room.city_name]
            .filter(Boolean).join(" · ")
          return (
            <label key={id} className="flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted has-checked:border-primary/50 has-checked:bg-primary/5">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={draft.includes(id)}
                onChange={(event) => setDraft(event.target.checked ? [...draft, id] : draft.filter((item) => item !== id))} />
              <span className="min-w-0 wrap-anywhere">
                <span className="block font-medium">{room.name}</span>
                <span className="block text-xs text-muted-foreground">{context}</span>
              </span>
            </label>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" disabled={draft.length === catalog.rooms.length}
          onClick={() => setDraft(catalog.rooms.map((room) => Number(room.id)))}>Pilih semua</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => selected.length ? setDraft(null) : navigate("/orders")}>Batal</Button>
          <Button disabled={!draft.length} onClick={() => {
            setSelected(draft)
            rememberMonitoredOrderGroups(userId, draft)
            setDraft(null)
          }}>
            {draft.length ? `Tampilkan ${draft.length} grup` : "Pilih minimal satu grup"}
          </Button>
        </div>
      </div>
    </section>
  )

  return <OrdersPage key={selected.join(",")} controls={controls} picker={picker}
    monitoredGroups={catalog.rooms.filter((room) => selected.includes(Number(room.id))).map((room) => ({
      id: Number(room.id), name: room.name,
    }))}
    monitorEmptyMessage={catalog.rooms.length ? "Pilih grup untuk melihat antrean order." : "Belum ada grup aktif yang dapat Anda akses."} />
}

export default function BreakoutRoomPage() {
  const state = useRoomCatalog()
  const navigate = useNavigate()
  const roomUnavailable = useLocation().state?.roomUnavailable
  const [segment, setSegment] = useState<Segment | null>(null)
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const step = workflow ? 2 : segment ? 1 : 0
  const { user } = useAuth()
  const rooms = state.catalog?.rooms.filter((room) =>
    Number(room.segment_id) === Number(segment?.id) && room.workflow === workflow) ?? []
  const choices: { id: number | string; label: string; detail?: string; choose: () => void }[] = step === 0
    ? (state.catalog?.segments ?? []).map((item) => ({
        id: item.id, label: segmentLabel(item.code), choose: () => setSegment(item),
      }))
    : step === 1
      ? (Object.keys(workflows) as Workflow[]).map((item) => ({
          id: item, label: workflows[item], choose: () => setWorkflow(item),
        }))
      : rooms.map((room) => ({
          id: room.id,
          label: room.name,
          detail: [groupCategories[room.category], user?.role === "SUPER_ADMIN" ? room.city_name : undefined]
            .filter(Boolean).join(" · "),
          choose: () => navigate(`/orders?room=${room.id}`, { replace: true }),
        }))

  useEffect(() => {
    if (step !== 0 || segment) heading.current?.focus()
  }, [step, segment])

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Breakout Room</h1>
        <p className="text-muted-foreground">Pilih antrean order yang ingin Anda tangani.</p>
        <Button variant="outline" className="mt-2" onClick={() => navigate(monitorPath)}>Pantau grup</Button>
      </header>
      {roomUnavailable && <p role="status" className="text-sm text-muted-foreground">Ruang sebelumnya tidak tersedia. Pilih ruang lain.</p>}
      {!state.catalog ? <CatalogStatus {...state} /> : (
        <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="breakout-step-title">
          <ol className="flex flex-wrap gap-x-4 gap-y-2 border-b pb-4 text-sm text-muted-foreground" aria-label="Tahap pemilihan ruang">
            {["Segmen", "Alur kerja", "Grup Telegram"].map((label, index) => (
              <li key={label} aria-current={step === index ? "step" : undefined}
                className={step === index ? "font-semibold text-primary" : undefined}>
                {index + 1}. {label}
              </li>
            ))}
          </ol>
          <div className="space-y-1">
            <h2 ref={heading} tabIndex={-1} id="breakout-step-title" className="text-xl font-semibold">
              {["Pilih segmen", "Pilih alur kerja", "Pilih grup Telegram"][step]}
            </h2>
            {segment && <p className="text-sm text-muted-foreground">
              {segmentLabel(segment.code)}{workflow && ` / ${workflows[workflow]}`}
            </p>}
          </div>
          {choices.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {choices.map(({ id, label, choose, detail }) => (
                <Button key={id} variant="outline" onClick={choose}
                  className="h-auto min-h-16 justify-between gap-3 whitespace-normal px-4 py-3 text-left">
                  <span className="min-w-0 wrap-anywhere">{label}
                    {detail && <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>}
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              ))}
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {step === 0 ? "Belum ada segmen yang dapat Anda akses. Hubungi admin."
                : "Belum ada grup aktif untuk alur ini. Pilih alur lain atau hubungi admin."}
            </p>
          )}
          {step > 0 && <Button variant="ghost" onClick={() => workflow ? setWorkflow(null) : setSegment(null)}>
            <ArrowLeft aria-hidden="true" /> Kembali
          </Button>}
        </section>
      )}
    </div>
  )
}
