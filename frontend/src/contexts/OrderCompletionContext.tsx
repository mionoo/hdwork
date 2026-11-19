import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { completeOrder, getOrderDetail, orderDeliveryNotice, type Order } from "@/services/order.service"

type PendingCompletion = { order: Order }
type CompletionJob = PendingCompletion & {
  content: string
  files: File[]
  state: "saving" | "failed"
  error?: string
}
type CompletedOrder = {
  order: Order
  state: "completed"
  delivery?: string
  warning: boolean
}
export type CompletionEntry = CompletionJob | CompletedOrder
type CompletionContext = {
  pending: PendingCompletion[]
  entries: CompletionEntry[]
  retry: (orderId: number) => void
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
  const jobsRef = useRef(new Map<number, CompletionEntry>())
  const [entries, setEntries] = useState<CompletionEntry[]>([])
  const pending = entries.filter((entry) => entry.state === "saving")
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const expirationTimers = timers.current
    return () => {
      mounted.current = false
      for (const timer of expirationTimers.values()) clearTimeout(timer)
      expirationTimers.clear()
    }
  }, [])

  function publishJobs() {
    if (mounted.current) setEntries([...jobsRef.current.values()])
  }

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
    publishJobs()
    void save(job, false)
  }

  function retry(orderId: number) {
    const job = jobsRef.current.get(orderId)
    if (job?.state !== "failed") return
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
      if (!mounted.current) return
      const order: Order = { ...job.order, status: "DONE" }
      const delivery = result?.telegram_delivery?.result
      const { warning } = orderDeliveryNotice("Order selesai", delivery)
      let deliveryLabel: string | undefined
      if (delivery?.delivered) deliveryLabel = "Telegram terkirim"
      else if (warning) deliveryLabel = "Telegram belum terkonfirmasi"
      else if (delivery) deliveryLabel = "Telegram dalam antrean"

      acknowledge(order)
      jobsRef.current.set(order.id, {
        order, state: "completed", delivery: deliveryLabel, warning,
      })
      timers.current.set(order.id, setTimeout(() => {
        timers.current.delete(order.id)
        jobsRef.current.delete(order.id)
        publishJobs()
      }, 5000))
    } catch (failure) {
      jobsRef.current.set(job.order.id, { ...job, state: "failed",
        error: failure instanceof TypeError
          ? "Penyimpanan belum terkonfirmasi. Coba lagi untuk memeriksa status order."
          : failure instanceof Error ? failure.message : "Order belum dapat disimpan.",
      })
    } finally {
      publishJobs()
    }
  }

  return (
    <Context.Provider value={{ pending, entries, retry, complete, acknowledge, applyUpdates, revision: () => sequence.current }}>
      {children}
    </Context.Provider>
  )
}

export function useOrderCompletion() {
  const context = useContext(Context)
  if (!context) throw new Error("OrderCompletionProvider belum tersedia.")
  return context
}
