import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/contexts/AuthContext"
import {
  getDashboardCities,
  getTeamMembers,
  type DashboardCity,
  type TeamMember,
} from "@/services/dashboard.service"

const attendanceLabel = {
  ON_DESK: "On Desk",
  BREAK: "Break",
  NOT_CLOCKED_IN: "Belum Clock In",
  CLOCKED_OUT: "Clock Out",
} as const

function attendanceVariant(status: TeamMember["attendance_status"]) {
  if (status === "ON_DESK") return "default"
  if (status === "BREAK") return "secondary"
  return "outline"
}

export default function TeamPage() {
  const { token, user } = useAuth()
  const isSuperAdmin = user?.role === "SUPER_ADMIN"
  const [members, setMembers] = useState<TeamMember[]>([])
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
    getTeamMembers(token, cityId)
      .then(setMembers)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Gagal mengambil team HD"))
      .finally(() => setLoading(false))
  }, [token, cityId])

  if (user?.role !== "ADMIN" && user?.role !== "SUPER_ADMIN") {
    return <div className="p-6 text-muted-foreground">Halaman ini hanya untuk admin.</div>
  }

  const onDesk = members.filter((member) => member.attendance_status === "ON_DESK").length
  const needsRedistribution = members.filter((member) => member.active_orders >= 7).length

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-muted/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          <div><h1 className="text-3xl font-semibold">Team HD</h1><p className="text-muted-foreground">Kesiapan dan beban kerja tim</p></div>
          {isSuperAdmin && <select className="h-9 rounded-lg border bg-background px-3 text-sm" value={cityId} onChange={(event) => setCityId(event.target.value)}><option value="">Semua kota</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select>}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="HD aktif hari ini" value={`${onDesk} / ${members.length}`} detail="Status On Desk" />
          <Metric label="Rata-rata beban kerja" value={members.length ? (members.reduce((total, member) => total + member.active_orders, 0) / members.length).toFixed(1) : "0"} detail="Order aktif per HD" />
          <Metric label="Perlu redistribusi" value={needsRedistribution} detail="HD dengan 7+ order aktif" />
        </div>

        <Card>
          <CardHeader><CardTitle>Daftar HD</CardTitle></CardHeader>
          <CardContent>
            {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
            {loading ? <p className="text-muted-foreground">Memuat team HD...</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">HD</th><th className="p-3">Kota</th><th className="p-3">Coverage</th><th className="p-3">Kehadiran</th><th className="p-3">Order aktif</th></tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-b"><td className="p-3"><div className="font-medium">{member.name}</div><div className="text-muted-foreground">@{member.username}</div></td><td className="p-3">{member.city_name}</td><td className="p-3">{member.segments}</td><td className="p-3"><Badge variant={attendanceVariant(member.attendance_status)}>{attendanceLabel[member.attendance_status]}</Badge></td><td className="p-3 font-medium">{member.active_orders}</td></tr>)}</tbody></table>{members.length === 0 && <p className="py-8 text-center text-muted-foreground">Belum ada HD dalam scope ini.</p>}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <Card><CardHeader><CardTitle className="text-sm font-medium">{label}</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{value}</div><p className="mt-1 text-sm text-muted-foreground">{detail}</p></CardContent></Card>
}
