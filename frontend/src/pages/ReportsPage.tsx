import { useEffect, useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/AuthContext"
import {
  getAdminReport,
  getDashboardCities,
  type AdminReport,
  type DashboardCity,
} from "@/services/dashboard.service"

function formatMinutes(minutes: number) {
  if (!minutes) return "—"
  const roundedMinutes = Math.round(minutes)
  const hours = Math.floor(roundedMinutes / 60)
  const remainder = roundedMinutes % 60
  return hours ? `${hours}j ${remainder}m` : `${remainder}m`
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric" }).format(new Date(value))
}

export default function ReportsPage() {
  const { token, user } = useAuth()
  const isSuperAdmin = user?.role === "SUPER_ADMIN"
  const [report, setReport] = useState<AdminReport | null>(null)
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
    getAdminReport(token, cityId).then(setReport).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Gagal mengambil report")).finally(() => setLoading(false))
  }, [token, cityId])

  if (user?.role !== "ADMIN" && user?.role !== "SUPER_ADMIN") return <div className="p-6 text-muted-foreground">Halaman ini hanya untuk admin.</div>

  const completionRate = report?.total_orders ? Math.round((report.done_orders / report.total_orders) * 100) : 0
  const maxDaily = Math.max(...(report?.daily.map((day) => day.total) || [1]), 1)

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-muted/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          <div><h1 className="text-3xl font-semibold">Reports</h1><p className="text-muted-foreground">Ringkasan 7 hari terakhir</p></div>
          {isSuperAdmin && <select className="h-9 rounded-lg border bg-background px-3 text-sm" value={cityId} onChange={(event) => setCityId(event.target.value)}><option value="">Semua kota</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select>}
        </div>

        {error && <p className="text-destructive">{error}</p>}
        {loading ? <p className="text-muted-foreground">Memuat reports...</p> : report && <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><Metric label="Total order" value={report.total_orders} /><Metric label="Penyelesaian" value={`${completionRate}%`} /><Metric label="Rata-rata selesai" value={formatMinutes(report.average_resolution_minutes)} /></div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
            <Card><CardHeader><CardTitle>Volume order harian</CardTitle></CardHeader><CardContent><div className="space-y-4">{report.daily.map((day) => <div key={day.work_date} className="grid grid-cols-[56px_1fr_42px] items-center gap-3 text-sm"><span className="text-muted-foreground">{formatDay(day.work_date)}</span><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max((day.total / maxDaily) * 100, 3)}%` }} /></div><span className="text-right font-medium">{day.done}/{day.total}</span></div>)}{report.daily.length === 0 && <p className="text-sm text-muted-foreground">Belum ada data dalam 7 hari terakhir.</p>}</div></CardContent></Card>
            <Card><CardHeader><CardTitle>Top performer</CardTitle></CardHeader><CardContent className="space-y-3">{report.performers.map((performer, index) => <div key={performer.name} className="flex items-center justify-between rounded-lg border p-3"><div><span className="mr-2 text-muted-foreground">#{index + 1}</span><span className="font-medium">{performer.name}</span></div><span className="font-medium">{performer.completed_orders} selesai</span></div>)}{report.performers.length === 0 && <p className="text-sm text-muted-foreground">Belum ada order selesai.</p>}</CardContent></Card>
          </div>
        </>}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardHeader><CardTitle className="text-sm font-medium">{label}</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{value}</div></CardContent></Card>
}
