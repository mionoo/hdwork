const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "")

if (!apiBaseUrl) {
  throw new Error("VITE_API_BASE_URL belum dikonfigurasi")
}

export const API_BASE_URL = apiBaseUrl
export const API_URL = `${API_BASE_URL}/api`
