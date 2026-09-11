import { API_URL } from "@/config/api"

export type AttendanceBreak = {
  id: number
  break_start_at: string
  break_end_at: string | null
}

export type TodayAttendance = {
  user_id: number
  status: "NOT_CLOCKED_IN" | "ON_DESK" | "BREAK" | "CLOCKED_OUT"
  attendance: {
    id: number
    user_id: number
    city_id: number
    work_date: string
    clock_in_at: string
    clock_out_at: string | null
  } | null
  breaks: AttendanceBreak[]
}

async function requestAttendance(
  token: string,
  path: string,
  method: "GET" | "POST" = "GET",
) {
  const response = await fetch(
    `${API_URL}/attendance${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal memproses attendance")
  }

  return result.data
}

export function getTodayAttendance(token: string): Promise<TodayAttendance> {
  return requestAttendance(token, "/today")
}

export function clockIn(token: string) {
  return requestAttendance(token, "/clock-in", "POST")
}

export function startBreak(token: string) {
  return requestAttendance(token, "/break", "POST")
}

export function onDesk(token: string) {
  return requestAttendance(token, "/on-desk", "POST")
}

export function clockOut(token: string) {
  return requestAttendance(token, "/clock-out", "POST")
}
