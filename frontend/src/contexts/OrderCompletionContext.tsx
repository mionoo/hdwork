import { createContext, useContext, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { completeOrder, orderDeliveryNotice, type Order } from "@/services/order.service"

type PendingCompletion = { order: Order }
type CompletionNotice = { order: Order; warning: boolean; message: string }
type CompletionContext = {
  pending: PendingCompletion[]
  notice: CompletionNotice | null
  complete: (order: Order, content: string, files: File[]) => ReturnType<typeof completeOrder>
}
const Context = createContext<CompletionContext | null>(null)

export function OrderCompletionProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  // A new login gets a fresh tracker; an old request cannot mutate the new session.
  return <CompletionState key={token ?? "guest"} token={token}>{children}</CompletionState>
}

function CompletionState({ token, children }: { token: string | null; children: ReactNode }) {
  const active = useRef(new Map<number, PendingCompletion>())
  const [pending, setPending] = useState<PendingCompletion[]>([])
  const [notice, setNotice] = useState<CompletionNotice | null>(null)

  async function complete(order: Order, content: string, files: File[]) {
    if (!token) throw new Error("Sesi login tidak tersedia.")
    if (active.current.has(order.id)) throw new Error("Penyelesaian order ini masih diproses.")
    active.current.set(order.id, { order })
    setPending([...active.current.values()])
    setNotice(null)
    try {
      const result = await completeOrder(token, order.id, content, files)
      setNotice({
        order,
        ...orderDeliveryNotice(`Order #${order.id} selesai`, result.telegram_delivery?.result),
      })
      return result
    } catch (failure) {
      setNotice({ order, warning: true, message: failure instanceof TypeError
        ? `Status penyelesaian order #${order.id} belum terkonfirmasi. Periksa order dan grup Telegram sebelum mencoba lagi.`
        : failure instanceof Error ? failure.message : "Penyelesaian order belum dapat dikonfirmasi." })
      throw failure
    } finally {
      active.current.delete(order.id)
      setPending([...active.current.values()])
    }
  }

  return <Context.Provider value={{ pending, notice, complete }}>{children}</Context.Provider>
}

export function useOrderCompletion() {
  const context = useContext(Context)
  if (!context) throw new Error("OrderCompletionProvider belum tersedia.")
  return context
}
