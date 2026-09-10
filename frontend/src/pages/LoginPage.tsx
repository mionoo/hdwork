import { useEffect, useRef, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle, ArrowRight, ChevronUp, Eye, EyeOff, LoaderCircle,
  LockKeyhole, UserRound,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import ThemeToggle from "@/components/ThemeToggle"
import { loginRequest } from "@/services/auth.service"
import { useAuth } from "@/contexts/AuthContext"

function LoginBrand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#6699ff] text-sm font-bold tracking-tight text-[#101c32]">
        HD
      </div>
      <div>
        <p className={`text-base font-semibold tracking-tight ${inverse ? "text-white" : "text-foreground"}`}>HD Work</p>
        <p className={`text-xs ${inverse ? "text-[#a9b8d2]" : "text-muted-foreground"}`}>Operations workspace</p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const submitting = useRef(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const previousTitle = document.title
    document.title = "Login | HD Work"
    return () => { document.title = previousTitle }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !username.trim() || !password) return
    submitting.current = true
    setLoading(true)
    setError("")

    try {
      const response = await loginRequest({ username: username.trim(), password })
      if (!response.success || !response.data?.token || !response.data?.user) {
        throw new Error("Login belum berhasil. Silakan coba kembali.")
      }
      login(response.data.token, response.data.user)
      setPassword("")
      navigate("/dashboard", { replace: true })
    } catch (error) {
      setError(error instanceof TypeError
        ? "Tidak dapat terhubung ke server. Periksa koneksi Anda dan coba kembali."
        : error instanceof Error ? error.message : "Login gagal. Silakan coba kembali.")
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-svh bg-card lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#101c32] px-12 py-10 text-white lg:flex xl:px-16 xl:py-12">
        <LoginBrand inverse />
        <div className="relative my-16 max-w-md">
          {/* <div className="mb-7 flex items-center gap-3">
            <span className="h-px w-8 bg-[#6699ff]" aria-hidden="true" />
            <p className="text-[11px] font-medium tracking-[0.2em] text-[#b4c5e0]">HD WORK MANAGEMENT SYSTEM</p>
          </div> */}
          {/* <h2 className="text-4xl leading-[1.15] font-semibold tracking-tight xl:text-5xl">
            Satu ruang kerja.<br />
            Operasional<br />
            <span className="text-[#8bb1ff]">lebih terarah.</span>
          </h2> */}
          {/* <p className="mt-6 max-w-sm text-base leading-relaxed text-[#b4c5e0]">
            Kelola order, pantau aktivitas tim, dan akses tools penunjang pekerjaan dalam satu tempat.
          </p> */}
        </div>
        {/* <div className="max-w-md border-t" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
          {[
            ["01", "Orders", "Pantau dan tindak lanjuti pekerjaan."],
            ["02", "Attendance", "Kelola waktu dan aktivitas kerja."],
            ["03", "Network Tools", "Akses perangkat melalui Local Agent."],
          ].map(([number, title, description]) => (
            <div key={number} className="flex items-start gap-5 border-b py-4" style={{ borderColor: "rgba(255,255,255,0.10)" }}>
              <span className="pt-0.5 font-mono text-xs text-[#8ba2c5]" aria-hidden="true">{number}</span>
              <div>
                <p className="text-sm font-medium text-[#edf3ff]">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#a9b8d2]">{description}</p>
              </div>
            </div>
          ))}
        </div> */}
      </aside>

      <section className="flex min-w-0 flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14 lg:py-10 xl:px-20" aria-labelledby="login-heading">
        <header className="flex min-h-10 items-center justify-between gap-4">
          <div className="lg:hidden"><LoginBrand /></div>
          <span className="hidden text-xs font-medium tracking-wide text-muted-foreground lg:block">WORKSPACE LOGIN</span>
          <ThemeToggle compact />
        </header>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-14 sm:py-20">
          <div className="mb-9">
            <p className="mb-3 text-xs font-semibold tracking-[0.15em] text-primary">SELAMAT DATANG KEMBALI</p>
            <h1 id="login-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">LOGIN</h1>
            {/* <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Gunakan akun Anda untuk melanjutkan pekerjaan.
            </p> */}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading} aria-describedby={error ? "login-error" : undefined}>
            <div className="space-y-2.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="username"
                  name="username"
                  value={username}
                  onChange={(event) => { setUsername(event.target.value); setError("") }}
                  placeholder="Masukkan username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  disabled={loading}
                  className="h-12 rounded-lg bg-background pl-11 text-base md:text-sm"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setError("") }}
                  onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                  onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                  onBlur={() => setCapsLock(false)}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  aria-describedby={capsLock ? "login-caps-lock" : undefined}
                  className="h-12 rounded-lg bg-background pr-12 pl-11 text-base md:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={loading}
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  aria-pressed={showPassword}
                  aria-controls="password"
                  className="absolute inset-y-0 right-0 z-10 grid w-12 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
              </div>
              {capsLock && <p id="login-caps-lock" className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><ChevronUp className="size-3.5" aria-hidden="true" />Caps Lock sedang aktif.</p>}
            </div>

            {error && (
              <div id="login-error" role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="min-w-0 break-words">{error}</p>
              </div>
            )}

            <Button type="submit" className="h-12 w-full gap-2 text-sm" disabled={loading || !username.trim() || !password}>
              {loading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              <span>{loading ? "Sedang masuk..." : "Masuk ke workspace"}</span>
              {!loading && <ArrowRight className="size-4" aria-hidden="true" />}
            </Button>
            <p className="sr-only" role="status">{loading ? "Sedang memproses login." : ""}</p>
          </form>

          <div className="mt-8 border-t pt-6 text-center">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Belum memiliki akun atau mengalami kendala?<br />
              Hubungi admin untuk bantuan akses.
            </p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          {/* <span>HD Work · Management System</span>
          <span>Akses internal</span> */}
        </footer>
      </section>
    </main>
  )
}
