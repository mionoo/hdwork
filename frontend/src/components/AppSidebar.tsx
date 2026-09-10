import {
  BarChart3, Clock3, LayoutDashboard, ListTodo, LogOut, Menu,
  MessagesSquare, PanelLeftClose, PanelLeftOpen, TerminalSquare,
  UserCog, Users, X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Dialog } from "@base-ui/react/dialog"

import { Button } from "@/components/ui/button"
import ThemeToggle from "@/components/ThemeToggle"
import { useAuth } from "@/contexts/AuthContext"
import { cn } from "@/lib/utils"
import WorkspaceOutlet from "@/components/WorkspaceOutlet"

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Orders", to: "/orders", icon: ListTodo },
  { label: "Attendance", to: "/attendance", icon: Clock3, hdOnly: true },
  { label: "Network Tools", to: "/network-tools", icon: TerminalSquare, hdOnly: true },
  { label: "Team HD", to: "/team", icon: Users, adminOnly: true },
  { label: "User Management", to: "/users", icon: UserCog, adminOnly: true },
  { label: "Konfigurasi Grup", to: "/groups", icon: MessagesSquare, adminOnly: true },
  { label: "Reports", to: "/reports", icon: BarChart3, adminOnly: true },
]

function useMobileLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches)
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)")
    const change = () => setMobile(query.matches)
    query.addEventListener("change", change)
    change()
    return () => query.removeEventListener("change", change)
  }, [])
  return mobile
}

export default function AppSidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const mobile = useMobileLayout()
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed")
    return saved === null ? window.innerWidth < 1024 : saved === "true"
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const visibleNavigation = navigation.filter((item) =>
    (!item.hdOnly || user?.role === "HD") &&
    (!item.adminOnly || user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"),
  )
  const currentPage = visibleNavigation.find((item) =>
    location.pathname === item.to || location.pathname.startsWith(item.to + "/"),
  )?.label || "HD Work"

  useEffect(() => { setMobileOpen(false) }, [location.pathname, mobile])

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous
      localStorage.setItem("sidebar-collapsed", String(next))
      return next
    })
  }

  function sidebarContent(compact: boolean, drawer = false) {
    return <>
      <div className={cn("hd-sidebar-heading", compact && "hd-sidebar-heading-compact")}>
        <Brand compact={compact} />
        {drawer ? (
          <Dialog.Close render={<Button variant="ghost" size="icon" className="hd-sidebar-toggle" aria-label="Tutup navigasi" />}>
            <X />
          </Dialog.Close>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="hd-sidebar-toggle"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="workspace-navigation"
            aria-label={collapsed ? "Perlebar sidebar" : "Ciutkan sidebar"}
            title={collapsed ? "Perlebar sidebar" : "Ciutkan sidebar"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        )}
      </div>
      <div className="hd-sidebar-navigation">
        <p className={cn("mb-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground", compact && "sr-only")}>Workspace</p>
        <nav id="workspace-navigation" aria-label="Navigasi utama" className="space-y-1">
          {visibleNavigation.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              aria-label={label}
              title={compact ? label : undefined}
              className={({ isActive }) => cn(
                "hd-sidebar-link group flex items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-primary/12 text-primary hover:bg-primary/15"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                compact && "hd-sidebar-link-compact",
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              {!compact && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className={cn("hd-sidebar-footer", compact && "hd-sidebar-footer-compact")}>
        <div className={cn("flex min-w-0 items-center gap-3 px-2 py-3", compact && "justify-center px-0")}>
          <div title={user?.name} className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {user?.name?.slice(0, 1).toUpperCase() || "U"}
          </div>
          {!compact && <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{user?.role === "SUPER_ADMIN" ? "Super Admin" : user?.role === "ADMIN" ? "Admin" : "Help Desk"}</p>
          </div>}
        </div>
        <ThemeToggle compact={compact} />
        <Button
          variant="ghost"
          className={cn("hd-sidebar-logout text-muted-foreground hover:text-destructive", compact && "hd-sidebar-logout-compact")}
          onClick={logout}
          title="Logout"
          aria-label="Logout"
        >
          <LogOut />
          {!compact && "Logout"}
        </Button>
      </div>
    </>
  }

  return <div className="hd-workspace bg-muted" data-mobile={mobile} data-collapsed={collapsed}>
    {!mobile && <aside className="hd-sidebar border-r bg-background" aria-label="Sidebar">
      {sidebarContent(collapsed)}
    </aside>}

    {mobile && <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
      <header className="hd-mobile-header border-b bg-background">
        <div className="flex min-w-0 items-center gap-3">
          <Dialog.Trigger render={<Button variant="ghost" size="icon" className="hd-sidebar-toggle" aria-label="Buka navigasi" />}>
            <Menu />
          </Dialog.Trigger>
          <span className="truncate text-sm font-semibold">{currentPage}</span>
        </div>
        <Brand compact />
      </header>
      <Dialog.Portal>
        <Dialog.Backdrop className="hd-sidebar-backdrop" />
        <Dialog.Popup className="hd-sidebar-drawer border-r bg-background text-foreground">
          <Dialog.Title className="sr-only">Navigasi HD Work</Dialog.Title>
          {sidebarContent(false, true)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>}

    <main className="hd-workspace-content"><WorkspaceOutlet /></main>
  </div>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex min-w-0 items-center gap-3">
    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">HD</div>
    {!compact && <div className="min-w-0">
      <p className="truncate text-sm font-semibold tracking-tight">HD Work</p>
      <p className="text-[11px] text-muted-foreground">Operations</p>
    </div>}
  </div>
}
