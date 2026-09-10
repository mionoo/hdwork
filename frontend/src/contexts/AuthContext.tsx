import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"
import { clearTerminalRecovery, TERMINAL_LOGOUT_EVENT } from "@/lib/terminal-session"

type User = {
  id: number
  name: string
  username: string
  role: string
  city_id: number | null
}

type AuthContextType = {
  user: User | null
  token: string | null
  login: (token: string, user: User) => void
  logout: () => void
}

const AuthContext =
  createContext<AuthContextType | undefined>(
    undefined,
  )

function getTokenExpiry(token: string) {
  try {
    const payload = token.split(".")[1]
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null
  } catch {
    return null
  }
}

export function AuthProvider({
  children,
}: {
  children: ReactNode
}) {
  const navigate = useNavigate()
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem("token"),
  )

  const [user, setUser] = useState<User | null>(() => {
    const savedUser =
      localStorage.getItem("user")

    if (!savedUser) {
      return null
    }

    try {
      return JSON.parse(savedUser)
    } catch {
      return null
    }
  })

  function login(
    newToken: string,
    newUser: User,
  ) {
    localStorage.setItem(
      "token",
      newToken,
    )

    localStorage.setItem(
      "user",
      JSON.stringify(newUser),
    )

    setToken(newToken)
    setUser(newUser)
  }

  function logout() {
    const closingToken = localStorage.getItem("token")
    window.dispatchEvent(new Event(TERMINAL_LOGOUT_EVENT))
    clearTerminalRecovery()
    // Also close detached sessions if the terminal socket is reconnecting.
    if (closingToken) void fetch("http://localhost:3090/api/network/terminal/logout", {
      method: "POST",
      headers: { Authorization: "Bearer " + closingToken },
      keepalive: true,
    }).catch(() => {})
    localStorage.removeItem("token")
    localStorage.removeItem("user")

    setToken(null)
    setUser(null)
  }

  function endExpiredSession() {
    logout()
    navigate("/login", { replace: true })
  }

  useEffect(() => {
    if (!token) return

    const expiry = getTokenExpiry(token)
    if (!expiry) return

    const remaining = expiry - Date.now()
    if (remaining <= 0) {
      endExpiredSession()
      return
    }

    const timeoutId = window.setTimeout(endExpiredSession, remaining)
    return () => window.clearTimeout(timeoutId)
  }, [token])

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      const request = args[0]
      const url = typeof request === "string" ? request : request instanceof Request ? request.url : String(request)

      if (response.status === 401 && url.includes("/api/") && localStorage.getItem("token")) {
        endExpiredSession()
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context =
    useContext(AuthContext)

  if (!context) {
    throw new Error(
      "useAuth harus digunakan di dalam AuthProvider",
    )
  }

  return context
}
