import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { MessageSquare } from "lucide-react"
import { io } from "socket.io-client"
import { API_BASE_URL } from "@/config/api"

import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import OrderStatusBadge from "@/components/OrderStatusBadge"
import OrderSourcePhotos from "@/components/OrderSourcePhotos"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { useAuth } from "@/contexts/AuthContext"

import {
  claimOrder,
  completeOrder,
  getOrderRawMessage,
  getOrderDetail,
  getOrders,
  sendResult,
  type Order,
  type OrderDetail,
  type OrderRawMessage,
} from "@/services/order.service"

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export default function OrdersPage({ room, onLeaveRoom, controls, picker, monitoredGroups, monitorEmptyMessage }: {
  room?: { id: number; name: string; context: string }
  onLeaveRoom?: () => void
  controls: ReactNode
  picker?: ReactNode
  monitoredGroups?: { id: number; name: string }[]
  monitorEmptyMessage?: string
}) {
  const { token, user } = useAuth()
  const navigate = useNavigate()

  const [orders, setOrders] =
    useState<Order[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState("")

  const [loadError, setLoadError] = useState("")

  const [successMessage, setSuccessMessage] = useState("")

  const [claimingOrderId, setClaimingOrderId] = useState<number | null>(null)

  const [messageLoadingId, setMessageLoadingId] = useState<number | null>(null)

  const [selectedMessage, setSelectedMessage] = useState<OrderRawMessage | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const [quickResultOrder, setQuickResultOrder] = useState<Order | null>(null)
  const [quickResultContent, setQuickResultContent] = useState("")
  const [quickResultFiles, setQuickResultFiles] = useState<File[]>([])
  const [quickResultError, setQuickResultError] = useState("")
  const [quickCompleteOrder, setQuickCompleteOrder] = useState<Order | null>(null)
  const [quickCompleteDetail, setQuickCompleteDetail] = useState<OrderDetail | null>(null)
  const [quickCompleteContent, setQuickCompleteContent] = useState("")
  const [quickCompleteFiles, setQuickCompleteFiles] = useState<File[]>([])
  const [quickCompleteError, setQuickCompleteError] = useState("")
  const [quickActionLoading, setQuickActionLoading] = useState(false)
  const requestVersion = useRef(0)
  const scope = room ? String(room.id) : monitoredGroups?.map((group) => group.id).join(",")

  async function loadOrders() {
    if (!token || !scope) return
    const version = ++requestVersion.current

    try {
      setLoadError("")

      const data = await getOrders(token, room ? { groupId: scope } : { groupIds: scope.split(",").map(Number) })
      if (version === requestVersion.current) setOrders(data)

    } catch (error) {
      if (version !== requestVersion.current) return
      setOrders([])
      if (error instanceof Error) {
        setLoadError(error.message)
      } else {
        setLoadError("Gagal mengambil order")
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [token, scope])

  useEffect(() => {
    if (!token || !scope) return

    const socket = io(API_BASE_URL, { auth: { token } })
    const refreshOrders = () => loadOrders()

    socket.on("orders:changed", refreshOrders)

    return () => {
      socket.disconnect()
    }
  }, [token, scope])

  async function handleClaim(order: Order) {
    if (!token) return

    try {
      setClaimingOrderId(order.id)
      setError("")
      setSuccessMessage("")

      await claimOrder(token, order.id)

      setSuccessMessage(`Order #${order.id} berhasil di-claim`)
      await loadOrders()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Gagal claim order")
    } finally {
      setClaimingOrderId(null)
    }
  }

  async function handleOpenMessage(order: Order) {
    if (!token) return

    try {
      setMessageLoadingId(order.id)
      setError("")

      setSelectedOrder(order)
      setSelectedMessage(await getOrderRawMessage(token, order.id))
    } catch (error) {
      setSelectedOrder(null)
      setError(error instanceof Error ? error.message : "Gagal mengambil pesan asli")
    } finally {
      setMessageLoadingId(null)
    }
  }

  function addQuickFiles(files: File[], mode: "result" | "complete") {
    const current = mode === "result" ? quickResultFiles : quickCompleteFiles
    const setFiles = mode === "result" ? setQuickResultFiles : setQuickCompleteFiles
    const setFileError = mode === "result" ? setQuickResultError : setQuickCompleteError
    const validFiles = files.filter((file) => file.size <= 10 * 1024 * 1024)
    const availableSlots = 10 - current.length

    if (validFiles.length !== files.length) setFileError("Ukuran setiap file maksimal 10 MB")
    else if (files.length > availableSlots) setFileError("Maksimal 10 file dalam satu result")
    else setFileError("")

    setFiles((currentFiles) => [...currentFiles, ...validFiles.slice(0, Math.max(availableSlots, 0))])
  }

  function openQuickResult(order: Order) {
    setQuickResultContent("")
    setQuickResultFiles([])
    setQuickResultError("")
    setQuickResultOrder(order)
  }

  async function handleQuickResult(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !quickResultOrder) return
    if (!quickResultContent.trim() && quickResultFiles.length === 0) {
      setQuickResultError("Isi hasil pekerjaan atau pilih minimal satu file")
      return
    }

    try {
      setQuickActionLoading(true)
      setQuickResultError("")
      await sendResult(token, quickResultOrder.id, quickResultContent.trim(), quickResultFiles)
      setQuickResultOrder(null)
      setSuccessMessage(`Result order #${quickResultOrder.id} berhasil dikirim`)
      await loadOrders()
    } catch (error) {
      setQuickResultError(error instanceof Error ? error.message : "Gagal mengirim result")
    } finally {
      setQuickActionLoading(false)
    }
  }

  async function openQuickComplete(order: Order) {
    if (!token) return
    try {
      setQuickActionLoading(true)
      setQuickCompleteError("")
      setQuickCompleteContent("")
      setQuickCompleteFiles([])
      setQuickCompleteDetail(await getOrderDetail(token, order.id))
      setQuickCompleteOrder(order)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Gagal memuat data order")
    } finally {
      setQuickActionLoading(false)
    }
  }

  async function handleQuickComplete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !quickCompleteOrder || !quickCompleteDetail) return
    const needsResult = quickCompleteDetail.results.length === 0
    if (needsResult && !quickCompleteContent.trim() && quickCompleteFiles.length === 0) {
      setQuickCompleteError("Isi hasil pekerjaan atau pilih minimal satu file")
      return
    }

    try {
      setQuickActionLoading(true)
      setQuickCompleteError("")
      await completeOrder(token, quickCompleteOrder.id, needsResult ? quickCompleteContent.trim() : "", needsResult ? quickCompleteFiles : [])
      setQuickCompleteOrder(null)
      setQuickCompleteDetail(null)
      setSelectedMessage(null)
      setSelectedOrder(null)
      setSuccessMessage(`Order #${quickCompleteOrder.id} berhasil diselesaikan`)
      await loadOrders()
    } catch (error) {
      setQuickCompleteError(error instanceof Error ? error.message : "Gagal menyelesaikan order")
    } finally {
      setQuickActionLoading(false)
    }
  }

  const visibleOrders = orders.filter((order) => order.status !== "DONE")
  const countsByGroup = new Map<number, number>()
  if (monitoredGroups) {
    for (const order of visibleOrders) {
      const groupId = Number(order.telegram_group_id)
      countsByGroup.set(groupId, (countsByGroup.get(groupId) ?? 0) + 1)
    }
  }
  const canQuickAction = (order: Order) => user?.role === "HD"
    && order.performance_owner_id === user.id
    && (order.status === "IN_PROGRESS" || order.status === "ESCALATED")

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        <div className="sticky top-0 z-20 -mx-6 border-b bg-muted/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold wrap-anywhere">Orders · {room?.name ?? "Pantau grup"}</h1>
              <p className="text-muted-foreground">{room?.context ?? "Lihat antrean order dari beberapa grup sekaligus."}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {controls}
              {onLeaveRoom && <Button variant="outline" onClick={onLeaveRoom}>Keluar ruang</Button>}
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {loadError && <p role="alert" className="text-destructive">{loadError}</p>}

        {successMessage && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            {successMessage}
          </p>
        )}

        {picker}
        {!scope && <p className="text-sm text-muted-foreground">{monitorEmptyMessage}</p>}
        {scope && loading && <p role="status" className="text-sm text-muted-foreground">Memuat order…</p>}

        {scope && !loading && <Card>
          <CardHeader>
            <CardTitle>
              Order List
            </CardTitle>
          </CardHeader>

          <CardContent>
            {!loadError && <p className="mb-3 text-sm text-muted-foreground" role="status">Menampilkan {visibleOrders.length} order aktif</p>}
            {monitoredGroups && <ul aria-label="Grup dipantau" className="mb-3 flex flex-wrap gap-2">
              {monitoredGroups.map((group) => (
                <li key={group.id} className="rounded-md border bg-muted px-2.5 py-1 text-sm wrap-anywhere">
                  {group.name}{!loadError && <span className="text-muted-foreground"> · {countsByGroup.get(group.id) ?? 0} order</span>}
                </li>
              ))}
            </ul>}
            <div className="overflow-x-auto">

              <table className="w-full text-sm">

                <thead>
                  <tr className="border-b text-left">

                    <th className="p-3">
                      ID
                    </th>

                    <th className="p-3">
                      Type
                    </th>

                    <th className="p-3">
                      Service
                    </th>

                    {monitoredGroups && <th scope="col" className="p-3">Grup asal</th>}

                    <th className="p-3">
                      Jenis Grup
                    </th>

                    <th className="p-3">
                      Segment
                    </th>

                    <th className="p-3">
                      Status
                    </th>

                    <th className="p-3">
                      Dibuat
                    </th>

                    <th className="p-3">
                      Owner
                    </th>

                    <th className="p-3">
                      Action
                    </th>

                  </tr>
                </thead>

                <tbody>

                  {visibleOrders.map((order) => {
                    const isMyOrder = user?.role === "HD"
                      && order.performance_owner_id != null
                      && Number(order.performance_owner_id) === Number(user.id)

                    return (
                    <tr
                      key={order.id}
                      className={isMyOrder ? "border-b bg-primary/10" : "border-b"}
                    >

                      <td className="p-3">
                        {order.id}
                      </td>

                      <td className="p-3">
                        {order.order_type}
                      </td>

                      <td className="p-3">
                        {order.service_number ||
                          "-"}
                      </td>

                      {monitoredGroups && <td className="p-3">{order.telegram_group}</td>}

                      <td className="p-3">
                        {order.telegram_group_category === "LOGIC" ? "Logic" : "Pengawalan"}
                      </td>

                      <td className="p-3">
                        {order.segment_code}
                      </td>

                      <td className="p-3">
                        <OrderStatusBadge status={order.status} />
                      </td>

                      <td className="p-3 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(order.created_at)}
                      </td>

                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          <span className={isMyOrder ? "font-semibold" : undefined}>
                            {order.performance_owner_name || "-"}
                          </span>
                          {isMyOrder && (
                            <span className="whitespace-nowrap text-xs font-medium text-primary">
                              Anda menangani
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3">
                        <div className="flex items-center gap-2">
                        {user?.role === "HD" && order.status === "WAITING" && (
                          <Button
                            size="sm"
                            disabled={claimingOrderId === order.id}
                            onClick={() => handleClaim(order)}
                          >
                            {claimingOrderId === order.id ? "Claim..." : "Claim"}
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="outline"
                          disabled={messageLoadingId === order.id}
                          onClick={() => handleOpenMessage(order)}
                          aria-label={`Lihat pesan order #${order.id}`}
                          title="Lihat pesan asli"
                        >
                          <MessageSquare />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/orders/${order.id}`,
                              { state: { roomId: room?.id, monitoring: Boolean(monitoredGroups) } },
                            )
                          }
                        >
                          Detail
                        </Button>
                        </div>

                      </td>

                    </tr>
                    )
                  })}

                </tbody>
              </table>

              {!loadError && visibleOrders.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  {monitoredGroups ? "Tidak ada order aktif di grup yang dipilih." : "Tidak ada order aktif di ruang ini"}
                </div>
              )}

            </div>
          </CardContent>
        </Card>}

      </div>

      <Dialog
        open={Boolean(selectedMessage)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMessage(null)
            setSelectedOrder(null)
          }
        }}
      >
        <DialogContent className="ml-auto flex h-full max-w-lg flex-col rounded-l-xl rounded-r-none">
          <DialogHeader>
            <DialogTitle>Pesan Asli Telegram</DialogTitle>
            <DialogDescription>
              Order #{selectedMessage?.id} · {selectedMessage?.telegram_group}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Raw message
            </p>
            <pre className="max-h-60 overflow-auto rounded-lg border bg-muted p-4 font-mono text-sm whitespace-pre-wrap break-words">
              {selectedMessage?.raw_message || "Pesan asli tidak tersedia."}
            </pre>
            {selectedMessage && <OrderSourcePhotos orderId={selectedMessage.id} photos={selectedMessage.source_photos} token={token} />}
          </div>

          {selectedOrder && canQuickAction(selectedOrder) && (
            <div className="mt-5 flex gap-2 border-t pt-4">
              <Button className="flex-1" onClick={() => openQuickResult(selectedOrder)}>
                Kirim Hasil
              </Button>
              <Button className="flex-1" variant="outline" onClick={() => openQuickComplete(selectedOrder)}>
                Complete Order
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(quickResultOrder)}
        onOpenChange={(open) => {
          if (!open && !quickActionLoading) setQuickResultOrder(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kirim Hasil · Order #{quickResultOrder?.id}</DialogTitle>
            <DialogDescription>
              Hasil akan disimpan dan dikirim ke grup Telegram asal order.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={handleQuickResult}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length) {
                event.preventDefault()
                addQuickFiles(files, "result")
              }
            }}
          >
            <Textarea
              className="min-h-28"
              value={quickResultContent}
              onChange={(event) => setQuickResultContent(event.target.value)}
              placeholder="Tulis hasil pekerjaan"
              disabled={quickActionLoading}
            />
            <div className="space-y-2">
              <input
                type="file"
                multiple
                disabled={quickActionLoading}
                className="block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
                onChange={(event) => addQuickFiles(Array.from(event.target.files || []), "result")}
              />
              <p className="text-xs text-muted-foreground">Maksimal 10 file, masing-masing 10 MB. File dapat dipilih atau di-copy-paste.</p>
              {quickResultFiles.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  {quickResultFiles.map((file) => <p key={`${file.name}-${file.lastModified}-${file.size}`} className="break-all">📎 {file.name}</p>)}
                </div>
              )}
            </div>
            {quickResultError && <p className="text-sm text-destructive">{quickResultError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={quickActionLoading} onClick={() => setQuickResultOrder(null)}>Batal</Button>
              <Button type="submit" disabled={quickActionLoading || (!quickResultContent.trim() && quickResultFiles.length === 0)}>{quickActionLoading ? "Mengirim..." : "Kirim Hasil"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(quickCompleteOrder)}
        onOpenChange={(open) => {
          if (!open && !quickActionLoading) {
            setQuickCompleteOrder(null)
            setQuickCompleteDetail(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Order · #{quickCompleteOrder?.id}</DialogTitle>
            <DialogDescription>
              {quickCompleteDetail?.results.length === 0
                ? "Tambahkan hasil pekerjaan sebelum menyelesaikan order."
                : "Tandai order ini selesai. Notifikasi akan dikirim ke Telegram."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={handleQuickComplete}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length) {
                event.preventDefault()
                addQuickFiles(files, "complete")
              }
            }}
          >
            {quickCompleteDetail?.results.length === 0 && (
              <>
                <Textarea
                  className="min-h-28"
                  value={quickCompleteContent}
                  onChange={(event) => setQuickCompleteContent(event.target.value)}
                  placeholder="Tulis hasil pekerjaan"
                  disabled={quickActionLoading}
                />
                <div className="space-y-2">
                  <input
                    type="file"
                    multiple
                    disabled={quickActionLoading}
                    className="block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
                    onChange={(event) => addQuickFiles(Array.from(event.target.files || []), "complete")}
                  />
                  {quickCompleteFiles.length > 0 && <div className="rounded-lg border bg-muted/30 p-3 text-sm">{quickCompleteFiles.map((file) => <p key={`${file.name}-${file.lastModified}-${file.size}`} className="break-all">📎 {file.name}</p>)}</div>}
                </div>
              </>
            )}
            {quickCompleteError && <p className="text-sm text-destructive">{quickCompleteError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={quickActionLoading} onClick={() => { setQuickCompleteOrder(null); setQuickCompleteDetail(null) }}>Batal</Button>
              <Button type="submit" disabled={quickActionLoading}>{quickActionLoading ? "Memproses..." : "Ya, Selesaikan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
