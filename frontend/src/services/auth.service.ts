export type LoginPayload = {
  username: string
  password: string
}

export type LoginResponse = {
  success: boolean
  message?: string
  data?: {
    token: string
    user: {
      id: number
      name: string
      username: string
      role: string
      city_id: number | null
    }
  }
}

export async function loginRequest(
  payload: LoginPayload,
): Promise<LoginResponse> {
  const response = await fetch(
    "http://localhost:3090/api/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.message || "Login gagal",
    )
  }

  return data
}
