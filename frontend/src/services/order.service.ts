export type Order = {
  id: number
  ticket_number: string | null
  service_number: string | null
  sto: string | null
  description: string | null
  telegram_username: string | null

  telegram_group_id: number
  telegram_group: string
  telegram_group_category: "LOGIC" | "PENGAWALAN"

  city_id: number
  city_name: string

  segment_id: number
  segment_code: string

  order_type: string
  point_value: number

  status:
    | "WAITING"
    | "IN_PROGRESS"
    | "ESCALATED"
    | "DONE"

  performance_owner_id: number | null
  performance_owner_name: string | null

  created_at: string
  completed_at: string | null
}

export type OrderRawMessage = {
  id: number
  telegram_group: string
  raw_message: string | null
}

type OrdersResponse = {
  success: boolean
  total: number
  data: Order[]
}

export async function getOrders(
  token: string,
  filters: {
    cityId?: string
    segmentId?: string
  } = {},
): Promise<Order[]> {
  const query = new URLSearchParams()

  if (filters.cityId) query.set("city_id", filters.cityId)
  if (filters.segmentId) query.set("segment_id", filters.segmentId)

  const queryString = query.toString()

  const response = await fetch(
    `http://localhost:3090/api/orders${queryString ? `?${queryString}` : ""}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  const result: OrdersResponse =
    await response.json()

  if (!response.ok) {
    throw new Error(
      "Gagal mengambil data order",
    )
  }

  return result.data
}

export async function getOrderRawMessage(
  token: string,
  orderId: number,
): Promise<OrderRawMessage> {
  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal mengambil pesan asli")
  }

  return result.data
}

export type OrderAssignment = {
  id: number
  user_id: number
  user_name: string
  assigned_at: string
  released_at: string | null
  release_reason: string | null
}

export type OrderEvent = {
  id: number
  event_type: string
  actor_type: string
  actor_user_id: number | null
  actor_name: string | null
  target_user_id: number | null
  target_name: string | null
  created_at: string
}

export type OrderNote = {
  id: number
  event_id: number | null
  user_id: number
  user_name: string
  note_type: string
  content: string
  created_at: string
}

export type OrderResultFile = {
  id: number
  file_name: string
  file_url: string
  mime_type: string | null
  file_size: number | null
  telegram_file_id: string | null
  created_at: string
}

export type OrderResult = {
  id: number
  user_id: number
  user_name: string
  content: string | null
  telegram_chat_id: number | null
  telegram_message_id: number | null
  created_at: string
  files: OrderResultFile[]
}

export type OrderDetail = {
  order: Order & {
    old_ont_serial?: string | null
    new_ont_serial?: string | null
    valin_id?: string | null
    raw_message?: string
  }

  assignments: OrderAssignment[]
  events: OrderEvent[]
  notes: OrderNote[]
  results: OrderResult[]
}

export type ReassignTarget = {
  id: number
  name: string
  username: string
  active_orders: number
}

export async function getOrderDetail(
  token: string,
  orderId: number,
): Promise<OrderDetail> {
  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/detail`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(
      result.message ||
        "Gagal mengambil detail order",
    )
  }

  return result.data
}

export async function claimOrder(
  token: string,
  orderId: number,
) {
  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/claim`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(
      result.message || "Gagal claim order",
    )
  }

  return result.data
}

export async function getReassignTargets(
  token: string,
  orderId: number,
): Promise<ReassignTarget[]> {
  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/reassign-targets`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(
      result.message || "Gagal mengambil daftar HD tujuan",
    )
  }

  return result.data
}

export async function reassignOrder(
  token: string,
  orderId: number,
  targetUserId: number,
  reason: string,
) {
  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/reassign`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_user_id: targetUserId,
        reason,
      }),
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal reassign order")
  }

  return result.data
}

export async function escalateOrder(
  token: string,
  orderId: number,
  reason: string,
) {
  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/escalate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal escalate order")
  }

  return result.data
}

export async function sendResult(
  token: string,
  orderId: number,
  content: string,
  files: File[],
) {
  const formData = new FormData()

  if (content) formData.append("content", content)
  files.forEach((file) => formData.append("files", file))

  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/results`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal menyimpan result")
  }

  return result.data
}

export async function completeOrder(
  token: string,
  orderId: number,
  content = "",
  files: File[] = [],
) {
  const formData = new FormData()

  if (content) formData.append("content", content)
  files.forEach((file) => formData.append("files", file))

  const response = await fetch(
    `http://localhost:3090/api/orders/${orderId}/complete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
  )

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.message || "Gagal menyelesaikan order")
  }

  return result.data
}
