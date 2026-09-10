import { useEffect, useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/AuthContext"
import {
  getDashboardCities,
  getDashboardSummary,
  type DashboardCity,
  type DashboardSummary,
} from "@/services/dashboard.service"

export default function DashboardPage() {
  const { user, token } = useAuth()
  const isAdminView = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"
  const isSuperAdmin = user?.role === "SUPER_ADMIN"
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [cities, setCities] = useState<DashboardCity[]>([])
  const [cityId, setCityId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!token || !isSuperAdmin) return
    getDashboardCities(token).then(setCities).catch(() => setCities([]))
  }, [token, isSuperAdmin])

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError("")
    getDashboardSummary(token, cityId)
      .then(setSummary)
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : "Gagal mengambil data dashboard"),
      )
      .finally(() => setLoading(false))
  }, [token, cityId])

  if (loading) return <div className="p-6">Memuat dashboard...</div>
  if (error) return <div className="p-6 text-destructive">{error}</div>

  const metrics = isAdminView
    ? [
        ["Waiting", summary?.waiting ?? 0, "Order belum ditangani"],
        ["In Progress", summary?.in_progress ?? 0, "Sedang dikerjakan HD"],
        ["Escalated", summary?.escalated ?? 0, "Perlu perhatian"],
        ["Done Today", summary?.done_today ?? 0, "Selesai hari ini"],
        ["HD Aktif", `${summary?.active_hds ?? 0} / ${summary?.total_hds ?? 0}`, "Clock in hari ini"],
        ["Belum Clock In", summary?.not_clocked_in ?? 0, "Perlu ditindaklanjuti"],
      ]
    : [
        ["Waiting", summary?.waiting ?? 0, "Order tersedia"],
        ["In Progress", summary?.in_progress ?? 0, "Order yang berjalan"],
        ["Escalated", summary?.escalated ?? 0, "Membutuhkan bantuan"],
        ["Done Today", summary?.done_today ?? 0, "Order selesai hari ini"],
        ["Point Today", summary?.point_today ?? 0, "Poin hari ini"],
        ["Active Orders", `${summary?.active_orders ?? 0} / ${summary?.active_order_limit ?? 10}`, "Batas order aktif"],
      ]

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="sticky top-0 z-20 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b bg-muted/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          <div>
            <h1 className="text-3xl font-semibold">{isAdminView ? "Dashboard Operasional" : "Dashboard"}</h1>
            <p className="text-muted-foreground">
              {isAdminView ? `Ringkasan ${summary?.city_name || "operasional"}` : `Selamat datang, ${user?.name}`}
            </p>
          </div>
          {isSuperAdmin && (
            <select
              className="h-9 rounded-lg border bg-background px-3 text-sm"
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              aria-label="Pilih kota"
            >
              <option value="">Semua kota</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {metrics.map(([label, value, description]) => (
            <Card key={label}>
              <CardHeader><CardTitle className="text-sm font-medium">{label}</CardTitle></CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{value}</div>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
