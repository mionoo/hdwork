import {
  useEffect,
  useState,
} from "react"
import { MessageSquare } from "lucide-react"
import { io } from "socket.io-client"
import { API_BASE_URL } from "@/config/api"

import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import OrderStatusBadge from "@/components/OrderStatusBadge"
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

export default function OrdersPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()

  const [orders, setOrders] =
    useState<Order[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState("")

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

  const [filters, setFilters] = useState({
    cityId: "",
    segmentId: "",
  })

  const [filterOptions, setFilterOptions] = useState({
    cities: [] as Array<{ id: number; name: string }>,
    segments: [] as Array<{ id: number; code: string }>,
  })

  async function loadOrders() {
    if (!token) return

    try {
      setLoading(true)
      setError("")

      const data = await getOrders(token, filters)

      setOrders(data)

      if (!filters.cityId && !filters.segmentId) {
        setFilterOptions({
          cities: Array.from(
            new Map(data.map((order) => [order.city_id, order.city_name])).entries(),
          ).map(([id, name]) => ({ id, name })),
          segments: Array.from(
            new Map(data.map((order) => [order.segment_id, order.segment_code])).entries(),
          ).map(([id, code]) => ({ id, code })),
        })
      }
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message)
      } else {
        setError("Gagal mengambil order")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOrders()
  }, [token, filters])

  useEffect(() => {
    if (!token) return

    const socket = io(API_BASE_URL, { auth: { token } })
    const refreshOrders = () => loadOrders()

    socket.on("orders:changed", refreshOrders)

    return () => {
      socket.disconnect()
    }
  }, [token, filters.cityId, filters.segmentId])

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

  const canFilter = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"
  const canFilterCity = user?.role === "SUPER_ADMIN"
  const visibleOrders = orders.filter((order) => order.status !== "DONE")
  const canQuickAction = (order: Order) => user?.role === "HD"
    && order.performance_owner_id === user.id
    && (order.status === "IN_PROGRESS" || order.status === "ESCALATED")

  if (loading) {
    return (
      <div className="p-6">
        Memuat order...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        <div className="sticky top-0 z-20 -mx-6 border-b bg-muted/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          <h1 className="text-3xl font-semibold">
            Orders
          </h1>

          <p className="text-muted-foreground">
            Daftar order yang dapat kamu akses
          </p>
        </div>

        {error && (
          <p className="text-destructive">
            {error}
          </p>
        )}

        {successMessage && (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            {successMessage}
          </p>
        )}

        {canFilter && (
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-4">
              {canFilterCity && (
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="city-filter">
                    Kota
                  </label>
                  <select
                    id="city-filter"
                    className="h-9 min-w-40 rounded-lg border bg-background px-3 text-sm"
                    value={filters.cityId}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, cityId: event.target.value }))
                    }
                  >
                    <option value="">Semua kota</option>
                    {filterOptions.cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="segment-filter">
                  Segment
                </label>
                <select
                  id="segment-filter"
                  className="h-9 min-w-40 rounded-lg border bg-background px-3 text-sm"
                  value={filters.segmentId}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, segmentId: event.target.value }))
                  }
                >
                  <option value="">Semua segment</option>
                  {filterOptions.segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.code}
                    </option>
                  ))}
                </select>
              </div>

              {(filters.cityId || filters.segmentId) && (
                <Button
                  variant="ghost"
                  onClick={() => setFilters({ cityId: "", segmentId: "" })}
                >
                  Reset Filter
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              Order List
            </CardTitle>
          </CardHeader>

          <CardContent>
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

                  {visibleOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b"
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
                        {order.performance_owner_name ||
                          "-"}
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
                            )
                          }
                        >
                          Detail
                        </Button>
                        </div>

                      </td>

                    </tr>
                  ))}

                </tbody>
              </table>

              {visibleOrders.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  Tidak ada order aktif
                </div>
              )}

            </div>
          </CardContent>
        </Card>

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

          <div className="mt-5 flex-1">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Raw message
            </p>
            <pre className="max-h-[calc(100svh-11rem)] overflow-auto rounded-lg border bg-muted p-4 font-mono text-sm whitespace-pre-wrap break-words">
              {selectedMessage?.raw_message || "Pesan asli tidak tersedia."}
            </pre>
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
