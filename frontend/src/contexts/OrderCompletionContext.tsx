import { createContext, useContext, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/AuthContext"
import { completeOrder, getOrderDetail, orderDeliveryNotice, type Order } from "@/services/order.service"

type PendingCompletion = { order: Order }
type CompletionJob = PendingCompletion & {
  content: string
  files: File[]
  state: "saving" | "failed"
  error?: string
}
type CompletionNotice = { order: Order; warning: boolean; message: string }
type CompletionContext = {
  pending: PendingCompletion[]
  notice: CompletionNotice | null
  revision: () => number
  acknowledge: (order: Order) => void
  applyUpdates: (orders: Order[], startedAt: number) => Order[]
  complete: (order: Order, content: string, files: File[]) => void
}
const Context = createContext<CompletionContext | null>(null)

export function OrderCompletionProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  // A new login gets a fresh tracker; an old request cannot mutate the new session.
  return <CompletionState key={token ?? "guest"} token={token}>{children}</CompletionState>
}

function CompletionState({ token, children }: { token: string | null; children: ReactNode }) {
  const jobsRef = useRef(new Map<number, CompletionJob>())
  const [jobs, setJobs] = useState<CompletionJob[]>([])
  const pending = jobs.filter((job) => job.state === "saving")
  function publishJobs() { setJobs([...jobsRef.current.values()]) }
  const [notice, setNotice] = useState<CompletionNotice | null>(null)
  const [minimized, setMinimized] = useState(false)

  const updates = useRef(new Map<number, { revision: number; order: Order }>())
  const sequence = useRef(0)
  function acknowledge(order: Order) {
    updates.current.set(order.id, { revision: ++sequence.current, order })
  }
  function applyUpdates(orders: Order[], startedAt: number) {
    return orders.map((order) => {
      const update = updates.current.get(order.id)
      if (!update) return order
      if (update.revision > startedAt) return update.order
      updates.current.delete(order.id)
      return order
    })
  }

  function complete(order: Order, content: string, files: File[]) {
    if (!token) throw new Error("Sesi login tidak tersedia.")
    if (jobsRef.current.has(order.id)) throw new Error("Penyelesaian order ini sudah tercatat. Gunakan Coba lagi jika gagal.")
    const job: CompletionJob = { order, content, files: [...files], state: "saving" }
    jobsRef.current.set(order.id, job)
    setNotice(null)
    setMinimized(false)
    publishJobs()
    void save(job, false)
  }

  function retry(job: CompletionJob) {
    if (job.state !== "failed") return
    setNotice(null)
    const next: CompletionJob = { ...job, state: "saving", error: undefined }
    jobsRef.current.set(job.order.id, next)
    publishJobs()
    void save(next, true)
  }

  async function save(job: CompletionJob, verifyFirst: boolean) {
    try {
      if (!token) throw new Error("Sesi login tidak tersedia.")
      // A lost response can follow a successful commit. Check before submitting again.
      const detail = verifyFirst ? await getOrderDetail(token, job.order.id) : null
      const result = detail?.order.status === "DONE" ? null
        : await completeOrder(token, job.order.id, job.content, job.files)
      acknowledge({ ...job.order, status: "DONE" })
      jobsRef.current.delete(job.order.id)
      setNotice({
        order: job.order,
        ...orderDeliveryNotice(`Order #${job.order.id} selesai`, result?.telegram_delivery?.result),
      })
    } catch (failure) {
      jobsRef.current.set(job.order.id, { ...job, state: "failed",
        error: failure instanceof TypeError
          ? "Penyimpanan belum terkonfirmasi. Coba lagi untuk memeriksa status order."
          : failure instanceof Error ? failure.message : "Order belum dapat disimpan.",
      })
    } finally {
      setMinimized(false)
      publishJobs()
    }
  }

  return (
    <Context.Provider value={{ pending, notice, complete, acknowledge, applyUpdates, revision: () => sequence.current }}>
      {children}
      {(jobs.length > 0 || notice) && (
        <section aria-label="Penyelesaian order"
          className="fixed right-4 bottom-4 z-50 max-h-[50vh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border bg-background p-4 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Penyelesaian order{jobs.length ? ` (${jobs.length})` : ""}</h2>
            <Button type="button" size="sm" variant="ghost" aria-expanded={!minimized}
              onClick={() => setMinimized((current) => !current)}>{minimized ? "Tampilkan" : "Ringkas"}</Button>
          </div>
          <div hidden={minimized} className="mt-2">
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.order.id} className="text-sm">
                <p role={job.state === "failed" ? "alert" : "status"} className="font-medium">
                  Order #{job.order.id} · {job.state === "saving" ? "Sedang menyimpan" : "Perlu diperiksa"}
                </p>
                {job.error && <p className="mt-1 text-muted-foreground">{job.error}</p>}
                {job.files.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{job.files.length} lampiran tersimpan di sesi ini</p>}
                {job.state === "failed" && (
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => retry(job)}>Coba lagi</Button>
                )}
              </li>
            ))}
          </ul>
          {notice && (
            <div className={jobs.length ? "mt-3 border-t pt-3" : ""}>
              <p role={notice.warning ? "alert" : "status"} className="text-sm">{notice.message}</p>
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setNotice(null)}>Tutup pemberitahuan</Button>
            </div>
          )}
          </div>
        </section>
      )}
    </Context.Provider>
  )

}

export function useOrderCompletion() {
  const context = useContext(Context)
  if (!context) throw new Error("OrderCompletionProvider belum tersedia.")
  return context
}
