import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useAuth } from "@/contexts/AuthContext"
import {
  clockIn,
  clockOut,
  getTodayAttendance,
  onDesk,
  startBreak,
  type TodayAttendance,
} from "@/services/attendance.service"

const statusLabel = {
  NOT_CLOCKED_IN: "Belum Clock In",
  ON_DESK: "On Desk",
  BREAK: "Break",
  CLOCKED_OUT: "Sudah Clock Out",
}

function formatDateTime(value: string | null) {
  if (!value) return "-"

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export default function AttendancePage() {
  const { token } = useAuth()
  const navigate = useNavigate()

  const [attendance, setAttendance] = useState<TodayAttendance | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")

  async function loadAttendance() {
    if (!token) return

    try {
      setLoading(true)
      setError("")
      setAttendance(await getTodayAttendance(token))
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Gagal mengambil attendance",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAttendance()
  }, [token])

  async function runAction(action: (token: string) => Promise<unknown>) {
    if (!token) return

    try {
      setActionLoading(true)
      setActionError("")
      await action(token)
      await loadAttendance()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal memproses attendance",
      )
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return <div className="p-6">Memuat attendance...</div>
  }

  if (error) {
    return <div className="p-6 text-destructive">{error}</div>
  }

  if (!attendance) {
    return <div className="p-6">Data attendance tidak ditemukan</div>
  }

  const { status } = attendance

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="sticky top-0 z-20 -mx-6 flex items-center justify-between border-b bg-muted/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          <div>
            <h1 className="text-3xl font-semibold">Attendance</h1>
            <p className="text-muted-foreground">Status kerja hari ini</p>
          </div>

          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Kembali
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Status: {statusLabel[status]}</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Info label="Clock In" value={formatDateTime(attendance.attendance?.clock_in_at ?? null)} />
              <Info label="Clock Out" value={formatDateTime(attendance.attendance?.clock_out_at ?? null)} />
            </div>

            {actionError && <p className="text-sm text-destructive">{actionError}</p>}

            <div className="flex flex-wrap gap-2">
              {status === "NOT_CLOCKED_IN" && (
                <Button disabled={actionLoading} onClick={() => runAction(clockIn)}>
                  {actionLoading ? "Memproses..." : "Clock In"}
                </Button>
              )}

              {status === "ON_DESK" && (
                <>
                  <Button disabled={actionLoading} onClick={() => runAction(startBreak)}>
                    Mulai Break
                  </Button>
                  <Button
                    variant="outline"
                    className="ml-auto border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={actionLoading}
                    onClick={() => runAction(clockOut)}
                  >
                    Clock Out
                  </Button>
                </>
              )}

              {status === "BREAK" && (
                <Button disabled={actionLoading} onClick={() => runAction(onDesk)}>
                  {actionLoading ? "Memproses..." : "Kembali On Desk"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat Break</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {attendance.breaks.map((item, index) => (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="font-medium">Break #{index + 1}</div>
                <div className="text-sm text-muted-foreground">
                  {formatDateTime(item.break_start_at)} — {item.break_end_at ? formatDateTime(item.break_end_at) : "Sedang berlangsung"}
                </div>
              </div>
            ))}

            {attendance.breaks.length === 0 && (
              <p className="text-muted-foreground">Belum ada riwayat break hari ini.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}
