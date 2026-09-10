export type DashboardSummary = {
  waiting: number
  in_progress: number
  escalated: number
  done_today: number
  active_orders?: number
  active_order_limit?: number
  point_today?: number
  active_hds?: number
  total_hds?: number
  not_clocked_in?: number
  city_id?: number | null
  city_name?: string
}

export type DashboardCity = { id: number; name: string }

export type TeamMember = {
  id: number
  name: string
  username: string
  city_name: string
  segments: string
  attendance_status: "NOT_CLOCKED_IN" | "CLOCKED_OUT" | "BREAK" | "ON_DESK"
  active_orders: number
}

export type AdminReport = {
  total_orders: number
  done_orders: number
  escalated_orders: number
  average_resolution_minutes: number
  daily: Array<{ work_date: string; total: number; done: number; escalated: number }>
  performers: Array<{ name: string; completed_orders: number }>
}

async function dashboardRequest<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`http://localhost:3090/api/dashboard/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal mengambil data dashboard")
  }

  return result.data as T
}

export function getDashboardSummary(
  token: string,
  cityId = "",
): Promise<DashboardSummary> {
  return dashboardRequest(
    token,
    `summary${cityId ? `?city_id=${cityId}` : ""}`,
  )
}

export function getDashboardCities(token: string): Promise<DashboardCity[]> {
  return dashboardRequest(token, "cities")
}

export function getTeamMembers(token: string, cityId = ""): Promise<TeamMember[]> {
  return dashboardRequest(token, `team${cityId ? `?city_id=${cityId}` : ""}`)
}

export function getAdminReport(token: string, cityId = ""): Promise<AdminReport> {
  return dashboardRequest(token, `reports${cityId ? `?city_id=${cityId}` : ""}`)
}
