import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"

type Theme = "light" | "dark"

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  localStorage.setItem("theme", theme)
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme | null
    const initialTheme =
      savedTheme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")

    setTheme(initialTheme)
    applyTheme(initialTheme)
  }, [])

  function setAppTheme(nextTheme: Theme) {
    setTheme(nextTheme)
    applyTheme(nextTheme)
  }

  if (compact) {
    const nextTheme = theme === "light" ? "dark" : "light"
    const Icon = theme === "light" ? Moon : Sun

    return (
      <button
        type="button"
        onClick={() => setAppTheme(nextTheme)}
        title={`Gunakan mode ${nextTheme === "light" ? "pagi" : "malam"}`}
        aria-label={`Gunakan mode ${nextTheme === "light" ? "pagi" : "malam"}`}
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-4" />
      </button>
    )
  }

  return (
    <div className="mb-2 px-2">


      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <ThemeOption
          active={theme === "light"}
          icon={Sun}
          label="Pagi"
          onClick={() => setAppTheme("light")}
        />
        <ThemeOption
          active={theme === "dark"}
          icon={Moon}
          label="Malam"
          onClick={() => setAppTheme("dark")}
        />
      </div>
    </div>
  )
}

function ThemeOption({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof Sun
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-background text-foreground shadow-sm",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
