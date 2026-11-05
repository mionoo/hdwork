import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronRight } from "lucide-react"
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { API_URL } from "@/config/api"
import { useAuth } from "@/contexts/AuthContext"
import { clearActiveOrderRoom, readActiveOrderRoom, rememberActiveOrderRoom } from "@/lib/active-order-room"
import OrdersPage from "@/pages/OrdersPage"

const workflows = { ASSURANCE: "Assurance", PROVISIONING: "Provisioning" } as const
const groupCategories = { PENGAWALAN: "Pengawalan", LOGIC: "Logic" } as const
type Workflow = keyof typeof workflows
type Segment = { id: number; code: string }
type Room = { id: number; name: string; segment_id: number; workflow: Workflow; category: keyof typeof groupCategories; city_name: string }
type Catalog = { segments: Segment[]; rooms: Room[] }

const segmentLabel = (code: string) => code === "REPLACE_ONT" ? "Replace ONT" : code

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
    onLeaveRoom={() => {
      clearActiveOrderRoom()
      navigate("/breakout-room", { replace: true })
    }} />
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
