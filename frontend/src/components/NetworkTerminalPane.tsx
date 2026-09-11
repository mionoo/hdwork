import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL, API_URL } from "@/config/api";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  PlugZap,
  Power,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NetworkHealth } from "@/lib/use-network-health";
import { useAuth } from "@/contexts/AuthContext";
import { clearTerminalRecovery, lockTerminalSession, readTerminalRecovery, saveTerminalRecovery, TERMINAL_LOGOUT_EVENT } from "@/lib/terminal-session";

type Field = "slot" | "port" | "onu_id" | "serial_number";
type Tool = { id: string; label: string; description: string; fields: Field[] };
type Result = {
  success: boolean;
  summary?: Record<string, unknown>;
  rawOutput?: string;
  message?: string;
};
const TOOLS: Tool[] = [
  {
    id: "CHECK_ONT_STATUS",
    label: "Cek Status ONT",
    description: "Status, phase, SN, jarak, dan durasi ONT.",
    fields: ["slot", "port", "onu_id"],
  },
  {
    id: "CHECK_ONT_OPTICAL",
    label: "Cek Redaman ONT",
    description: "Nilai optical upstream dan downstream.",
    fields: ["slot", "port", "onu_id"],
  },
  {
    id: "CHECK_ONTS_IN_PORT",
    label: "Cek ONT Dalam Port",
    description: "Daftar dan jumlah ONT pada port.",
    fields: ["slot", "port"],
  },
  {
    id: "CHECK_PORT_OPTICAL",
    label: "Cek Redaman 1 Port",
    description: "ONU Rx dan OLT Rx satu port.",
    fields: ["slot", "port"],
  },
  {
    id: "CHECK_OLT_PORT",
    label: "Cek Interface Port",
    description: "Status dan statistik dasar port.",
    fields: ["slot", "port"],
  },
  {
    id: "SEARCH_ONT",
    label: "Cari ONT",
    description: "Cari ONT terdaftar atau unregistered menurut SN.",
    fields: ["serial_number"],
  },
  {
    id: "GET_UNCONFIGURED_ONTS",
    label: "Cek Unregistered ONT",
    description: "Daftar ONT belum terkonfigurasi.",
    fields: [],
  },
];
const label: Record<Field, string> = {
  slot: "Slot",
  port: "Port",
  onu_id: "ONU ID",
  serial_number: "Serial Number",
};
const readable = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (x) => x.toUpperCase());
const value = (item: unknown) =>
  item === null || item === undefined || item === ""
    ? "-"
    : typeof item === "object"
      ? Array.isArray(item)
        ? item.length + " data"
        : "Tersedia"
      : String(item);
function Indicator({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs">
      <i
        className={
          "size-2 rounded-full " +
          (ok === true
            ? "bg-emerald-500"
            : ok === false
              ? "bg-rose-500"
              : "bg-amber-400")
        }
      />
      {label}{" "}
      <b>{ok === true ? "Online" : ok === false ? "Offline" : "Memeriksa"}</b>
    </span>
  );
}

export type TerminalPaneState = { connected: boolean; recovering: boolean; connecting: boolean; host: string };
type TerminalPaneProps = {
  health: NetworkHealth; active: boolean; workspaceId: string; kind: "manual" | "quick"; navigation: ReactNode;
  onState: (id: string, state: TerminalPaneState) => void;
  registerClose: (id: string, close: (() => void) | null) => void;
};
export default function NetworkTerminalPane({ active, workspaceId, kind, navigation, onState, registerClose, health }: TerminalPaneProps) {
  const { token, user } = useAuth();
  const terminalNode = useRef<HTMLDivElement>(null),
    terminalRef = useRef<Terminal | null>(null),
    socketRef = useRef<Socket | null>(null);
  const [host, setHost] = useState(""),
    [port, setPort] = useState("22"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null),
    [status, setStatus] = useState(
      "Siap membuat koneksi SSH melalui Local Agent.",
    ),
    [connecting, setConnecting] = useState(false);
  const [connectionCollapsed, setConnectionCollapsed] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const currentSession = useRef<string | null>(null);
  const pendingOutput = useRef("");
  const replaying = useRef(false);
  const initialSize = useRef({ cols: 120, rows: 30 });
  const heldLock = useRef<{ id: string; release: () => void } | null>(null);
  const headerSentinel = useRef<HTMLDivElement>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  const [confirmation, setConfirmation] = useState<{
      fingerprint: string;
      message: string;
    } | null>(null),
    [pairOpen, setPairOpen] = useState(false),
    [pairCode, setPairCode] = useState(""),
    [pairError, setPairError] = useState("");
  const { agent, vpn, vpnHost } = health;
  const [toolId, setToolId] = useState(TOOLS[0].id),
    [input, setInput] = useState<Record<Field, string>>({
      slot: "",
      port: "",
      onu_id: "",
      serial_number: "",
    }),
    [result, setResult] = useState<Result | null>(null),
    [toolError, setToolError] = useState(""),
    [running, setRunning] = useState(false);
  const tool = useMemo(
    () => TOOLS.find((item) => item.id === toolId) || TOOLS[0],
    [toolId],
  );

  const closeRef = useRef<() => void>(() => {});
  closeRef.current = close;
  useEffect(() => {
    registerClose(workspaceId, () => closeRef.current());
    return () => registerClose(workspaceId, null);
  }, [workspaceId, registerClose]);
  useEffect(() => {
    onState(workspaceId, { connected: !!sessionId, recovering, connecting, host });
  }, [workspaceId, sessionId, recovering, connecting, host, onState]);

  function releaseSessionLock() {
    heldLock.current?.release();
    heldLock.current = null;
  }

  function acceptSession(response: any) {
    currentSession.current = response.session_id;
    initialSize.current = { cols: response.cols || 120, rows: response.rows || 30 };
    pendingOutput.current = (response.output_truncated ? "[HD Work] Riwayat lama dipangkas karena batas buffer.\r\n" : "") + (response.output || "");
    setHost(response.host);
    setPort(String(response.port));
    setUsername(response.username);
    setPassword("");
    setSessionId(response.session_id);
    setConnectionCollapsed(true);
    setConnecting(false);
    setRecovering(false);
    setRunning(Boolean(response.busy));
    if (response.tool && TOOLS.some((item) => item.id === response.tool.id)) {
      setToolId(response.tool.id);
      setInput({ slot: "", port: "", onu_id: "", serial_number: "", ...response.tool.input });
    }
    setResult(response.tool_result || null);
    setToolError(response.tool_result?.success === false ? response.tool_result.message : "");
    setStatus("Terminal SSH aktif.");
  }

  useEffect(() => {
    if (!active) {
      setPassword("");
      setPairOpen(false);
      setPairCode("");
      setConfirmation(null);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const sentinel = headerSentinel.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCompactHeader(!entry.isIntersecting),
      { rootMargin: "48px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [active, user?.role]);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let deadline = 0;
    let retryTimer = 0;
    let expiryTimer = 0;
    const socket = io(API_BASE_URL, { auth: { token } });
    socketRef.current = socket;
    const stopRecovery = (message: string) => {
      window.clearTimeout(retryTimer);
      window.clearTimeout(expiryTimer);
      deadline = 0;
      const closingId = currentSession.current || readTerminalRecovery(workspaceId)?.session_id;
      if (closingId && socket.connected) socket.emit("terminal:close", { session_id: closingId });
      clearTerminalRecovery(workspaceId);
      releaseSessionLock();
      currentSession.current = null;
      pendingOutput.current = "";
      setSessionId(null);
      setRecovering(false);
      setConnecting(false);
      setRunning(false);
      setConnectionCollapsed(false);
      setStatus(message);
    };
    const startDeadline = () => {
      if (deadline) return;
      const saved = readTerminalRecovery(workspaceId);
      deadline = Date.now() + (saved?.grace_ms || 60_000);
      expiryTimer = window.setTimeout(() => stopRecovery("Waktu pemulihan SSH habis. Silakan hubungkan ulang."), Math.max(0, deadline - Date.now()));
    };
    const resume = async () => {
      const saved = readTerminalRecovery(workspaceId);
      if (!saved || stopped || !socket.connected) return;
      if (saved.user_id !== user?.id) return stopRecovery("Sesi sebelumnya bukan milik akun ini.");
      setRecovering(true);
      setStatus("Menghubungkan kembali sesi SSH…");
      startDeadline();
      if (heldLock.current?.id !== saved.session_id) {
        const release = await lockTerminalSession(saved.session_id);
        if (stopped || !readTerminalRecovery(workspaceId)) { release?.(); return; }
        if (!release) return stopRecovery("Sesi SSH sedang digunakan tab lain. Kembali ke tab tersebut.");
        heldLock.current = { id: saved.session_id, release };
      }
      if (stopped || !socket.connected) return;
      socket.timeout(10_000).emit("terminal:resume", saved, (error: Error | null, response: any) => {
        if (stopped || readTerminalRecovery(workspaceId)?.session_id !== saved.session_id) return;
        if (error || response?.code === "SESSION_ATTACHED") {
          if (Date.now() < deadline) retryTimer = window.setTimeout(() => void resume(), 1500);
          return;
        }
        if (!response?.success) return stopRecovery(response?.message || "Sesi SSH tidak dapat dipulihkan.");
        window.clearTimeout(retryTimer);
        window.clearTimeout(expiryTimer);
        deadline = 0;
        acceptSession(response);
      });
    };
    socket.on("connect", () => void resume());
    if (readTerminalRecovery(workspaceId)) {
      setRecovering(true);
      setStatus("Menghubungkan kembali sesi SSH…");
      startDeadline();
    }
    socket.on("terminal:data", ({ session_id, data }) => {
      if (session_id !== currentSession.current || typeof data !== "string") return;
      if (terminalRef.current) terminalRef.current.write(data);
      else pendingOutput.current = (pendingOutput.current + data).slice(-512 * 1024);
    });
    socket.on("terminal:tool-result", ({ session_id, result: toolResult }) => {
      if (session_id !== currentSession.current) return;
      setRunning(false);
      setResult(toolResult);
      setToolError(toolResult?.success === false ? toolResult.message : "");
    });
    socket.on("terminal:closed", ({ session_id, reason }) => {
      if (session_id !== currentSession.current && session_id !== readTerminalRecovery(workspaceId)?.session_id) return;
      stopRecovery(reason);
    });
    socket.on("disconnect", () => {
      currentSession.current = null;
      setSessionId(null);
      setConnecting(false);
      setConfirmation(null);
      setPassword("");
      setRunning(false);
      if (readTerminalRecovery(workspaceId)) {
        setRecovering(true);
        setStatus("Menghubungkan kembali sesi SSH…");
        startDeadline();
      } else setStatus("Koneksi server terputus. Tunggu jaringan pulih.");
    });
    const logout = () => {
      socket.emit("terminal:logout");
      stopRecovery("Sesi login berakhir.");
    };
    window.addEventListener(TERMINAL_LOGOUT_EVENT, logout);
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(expiryTimer);
      window.removeEventListener(TERMINAL_LOGOUT_EVENT, logout);
      releaseSessionLock();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);
  useEffect(() => {
    if (!sessionId || !terminalNode.current) return;
    const terminal = new Terminal({
        ...initialSize.current,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        scrollback: 5000,
        theme: {
          background: "#070a0f",
          foreground: "#d9e2ef",
          cursor: "#7aa2f7",
        },
      }),
      fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(terminalNode.current);
    terminalRef.current = terminal;
    let disposed = false;
    replaying.current = true;
    terminal.write(pendingOutput.current, () => {
      if (disposed) return;
      replaying.current = false;
      scheduleResize();
    });
    pendingOutput.current = "";
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        if (replaying.current || currentSession.current !== sessionId || !socketRef.current?.connected) return false;
        socketRef.current?.emit("terminal:input", {
          session_id: sessionId,
          data: "\x08",
        });
        return false;
      }
      return true;
    });
    const data = terminal.onData((chunk) => {
      if (replaying.current || currentSession.current !== sessionId || !socketRef.current?.connected) return;
      socketRef.current.emit("terminal:input", {
        session_id: sessionId,
        data: chunk,
      });
    });
    let resizeFrame = 0;
    let lastSize = "";
    const resize = () => {
      if (replaying.current) return;
      if (!terminalNode.current?.clientWidth || !terminalNode.current?.clientHeight) return;
      fit.fit();
      const size = `${terminal.cols}:${terminal.rows}`;
      if (size === lastSize) return;
      lastSize = size;
      socketRef.current?.emit("terminal:resize", {
        session_id: sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };
    const scheduleResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(terminalNode.current);
    window.addEventListener("resize", scheduleResize);
    resize();
    terminalRef.current = terminal;
    return () => {
      disposed = true;
      data.dispose();
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", scheduleResize);
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [sessionId]);
  function open(trust = false) {
    if (!host.trim() || !socketRef.current?.connected || recovering || connecting || sessionId) return;
    const openingSocket = socketRef.current;
    setConnecting(true);
    setStatus("Menghubungkan melalui Local Agent...");
    socketRef.current.emit(
      "terminal:open",
      {
        host: host.trim(),
        port: Number(port) || 22,
        username,
        password,
        trust_host: trust,
        kind,
      },
      (response: any) => {
        if (socketRef.current !== openingSocket || !openingSocket.connected) return;
        setConnecting(false);
        if (response.requires_host_confirmation) {
          setConfirmation({
            fingerprint: response.fingerprint,
            message: response.message,
          });
          return setStatus("Konfirmasi fingerprint host diperlukan.");
        }
        if (!response.success)
          return setStatus(response.message || "Koneksi SSH gagal.");
        setConfirmation(null);
        if (user) saveTerminalRecovery({ session_id: response.session_id, resume_token: response.resume_token, user_id: user.id, grace_ms: response.grace_ms }, workspaceId);
        acceptSession(response);
        void lockTerminalSession(response.session_id).then((release) => {
          if (currentSession.current !== response.session_id || socketRef.current !== openingSocket) { release?.(); return; }
          if (release) heldLock.current = { id: response.session_id, release };
        });
      },
    );
  }
  function close() {
    if (sessionId)
      socketRef.current?.emit("terminal:close", { session_id: sessionId });
    clearTerminalRecovery(workspaceId);
    releaseSessionLock();
    currentSession.current = null;
    setSessionId(null);
    setConnectionCollapsed(false);
    setRunning(false);
    setStatus("Sesi terminal ditutup.");
  }
  async function pair() {
    if (!token || !pairCode.trim()) return;
    try {
      setPairError("");
      const response = await fetch(`${API_URL}/agents/pair`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pairing_code: pairCode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setPairOpen(false);
      setPairCode("");
      setStatus("Pairing berhasil. Local Agent sedang tersambung otomatis...");
    } catch (error) {
      setPairError(error instanceof Error ? error.message : "Pairing gagal");
    }
  }
  function run() {
    if (kind !== "quick" || running || !sessionId || !socketRef.current?.connected || recovering) return;
    setRunning(true);
    setToolError("");
    setResult(null);
    const args = Object.fromEntries(
      tool.fields.map((field) => [field, input[field]]),
    );
    socketRef.current.emit(
      "terminal:tool",
      { session_id: sessionId, tool: tool.id, input: args },
      (response: Result) => {
        if (currentSession.current !== sessionId) return;
        setRunning(false);
        if (!response?.success) {
          setToolError(response?.message || "Pemeriksaan OLT gagal");
          return;
        }
        setResult(response);
      },
    );
  }
  if (user?.role !== "HD")
    return (
      <div className="p-6 text-muted-foreground">
        Network Tools hanya tersedia untuk HD.
      </div>
    );
  return (
    <div className="relative min-h-screen bg-muted p-6 [overflow-anchor:none]">
      <div ref={headerSentinel} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="sticky top-0 z-20 -mx-6 border-b bg-muted/95 px-6 py-3 backdrop-blur">
          <div hidden={compactHeader}>
          <h1 className="text-3xl font-semibold">Network Tools</h1>
          <p className="text-muted-foreground">
            Terminal SSH dan pemeriksaan cepat OLT ZTE melalui Local Agent.
          </p>
          </div>
          <div className={`flex flex-wrap gap-2 ${compactHeader ? "" : "mt-3"}`}>
            <Indicator label="Local Agent" ok={agent} />
            <Indicator label="Jalur VPN" ok={vpn} />
            <Indicator label="Sesi SSH" ok={sessionId ? true : connecting || recovering ? null : false} />
          </div>
          <p hidden={compactHeader} className="mt-2 text-xs text-muted-foreground">
            Target Jalur VPN: {vpnHost} · diperiksa setiap 15 detik
          </p>
        </header>
        {navigation}
        <p className="text-sm text-muted-foreground">{kind === "quick" ? "Sesi khusus pemeriksaan otomatis. Login ke OLT melalui terminal ini terlebih dahulu; sesi manual tidak ikut berpindah." : "Setiap tab memiliki koneksi dan output sendiri. Tab baru memulai login SSH baru."}</p>
        <div className={`grid items-start gap-4 ${connectionCollapsed ? "grid-cols-1" : "lg:grid-cols-[340px_minmax(0,1fr)]"}`}>
          <Card className="min-w-0">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PlugZap className="size-4" />
                Koneksi SSH
              </CardTitle>
              {connectionCollapsed && (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
                  <span className="break-all text-muted-foreground">{host ? `${host}:${port}` : "Belum ada koneksi"}</span>
                  {sessionId && <Indicator label="SSH" ok={true} />}
                </div>
              )}
              <div className="flex items-center gap-2">
                {connectionCollapsed && sessionId && (
                  <Button variant="destructive" size="sm" onClick={close}>
                    <Power className="size-4" /> Disconnect
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={!connectionCollapsed}
                  aria-controls={`ssh-connection-form-${workspaceId}`}
                  onClick={() => setConnectionCollapsed((value) => !value)}
                >
                  {connectionCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                  {connectionCollapsed ? "Maximize" : "Minimize"}
                </Button>
              </div>
            </CardHeader>
            <CardContent id={`ssh-connection-form-${workspaceId}`} hidden={connectionCollapsed} className="space-y-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setPairOpen(true)}
              >
                Hubungkan Local Agent
              </Button>
              <label className="grid gap-1 text-sm font-medium">
                Host / IP
                <input
                  className="h-9 rounded-lg border bg-background px-3"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={!!sessionId || connecting || recovering}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Port
                <input
                  className="h-9 rounded-lg border bg-background px-3"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={!!sessionId || connecting || recovering}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Username
                <input
                  className="h-9 rounded-lg border bg-background px-3"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={!!sessionId || connecting || recovering}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Password
                <input
                  type="password"
                  className="h-9 rounded-lg border bg-background px-3"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!!sessionId || connecting || recovering}
                />
              </label>
              {sessionId ? (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={close}
                >
                  <Power />
                  Disconnect
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={recovering || connecting || !host.trim()}
                  onClick={() => open()}
                >
                  {recovering ? "Memulihkan sesi..." : connecting ? "Menghubungkan..." : "Connect SSH"}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Password hanya digunakan saat membuat sesi dan tidak disimpan.
              </p>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="border-b">
              <CardTitle className="flex gap-2 text-base">
                <ShieldCheck className="size-4" />
                {sessionId
                  ? host + ":" + port + " · Connected"
                  : "Terminal SSH"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={terminalNode} className="h-[clamp(460px,75svh,800px)] min-w-0 overflow-hidden bg-[#070a0f] p-3 lg:h-[clamp(700px,85svh,1100px)]" />
              {!sessionId && (
                <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                  {status}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        {kind === "quick" && <Card>
          <CardHeader>
            <CardTitle className="flex gap-2 text-base">
              <Activity className="size-4" />
              Quick Actions ZTE
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {TOOLS.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={item.id === tool.id ? "default" : "outline"}
                  disabled={running}
                  onClick={() => {
                    setToolId(item.id);
                    setResult(null);
                    setToolError("");
                  }}
                >
                  {item.id === "SEARCH_ONT" && <Search className="size-3.5" />}
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <section className="rounded-xl border bg-background p-4">
                <h2 className="font-semibold">{tool.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tool.description}
                </p>
                <div className="mt-4 grid gap-3">
                  {tool.fields.map((field) => (
                    <label
                      key={field}
                      className="grid gap-1 text-sm font-medium"
                    >
                      {label[field]}
                      <input
                        className="h-9 rounded-lg border bg-background px-3"
                        value={input[field]}
                        onChange={(e) =>
                          setInput((old) => ({
                            ...old,
                            [field]: e.target.value,
                          }))
                        }
                        disabled={running}
                        placeholder={
                          field === "serial_number"
                            ? "ZTEG..."
                            : "Masukkan angka"
                        }
                      />
                    </label>
                  ))}
                </div>
                <Button
                  className="mt-4 w-full"
                  disabled={!sessionId || running}
                  onClick={run}
                >
                  {running && <LoaderCircle className="animate-spin" />}
                  {running ? "Mengambil output OLT..." : "Jalankan pemeriksaan"}
                </Button>
                {!sessionId && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Hubungkan sesi SSH terlebih dahulu.
                  </p>
                )}
              </section>
              <section className="rounded-xl border bg-background p-4">
                <h2 className="font-semibold">Hasil pemeriksaan</h2>
                {toolError && (
                  <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {toolError}
                  </p>
                )}
                {!result && !toolError && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Hasil ringkas muncul di sini setelah pemeriksaan selesai.
                  </p>
                )}
                {result && (
                  <>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {Object.entries(result.summary || {}).map(
                        ([key, item]) => (
                          <div key={key} className="rounded-lg border p-3">
                            <p className="text-xs text-muted-foreground">
                              {readable(key)}
                            </p>
                            <p className="mt-1 break-words text-sm font-semibold">
                              {value(item)}
                            </p>
                          </div>
                        ),
                      )}
                    </div>
                    {result.rawOutput && (
                      <details className="mt-4 rounded-lg border bg-muted/30 p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                          Lihat raw output pemeriksaan
                        </summary>
                        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs">
                          {result.rawOutput}
                        </pre>
                      </details>
                    )}
                  </>
                )}
              </section>
            </div>
            {running && (
              <p className="text-sm text-muted-foreground">
                Command dikirim ke Local Agent. Input terminal sementara dikunci
                hingga output selesai.
              </p>
            )}
          </CardContent>
        </Card>}
        <Dialog open={active && pairOpen} onOpenChange={setPairOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hubungkan Local Agent</DialogTitle>
              <DialogDescription>
                Masukkan kode yang tampil pada terminal Local Agent.
              </DialogDescription>
            </DialogHeader>
            <input
              autoFocus
              className="h-11 rounded-lg border bg-background px-3 font-mono text-center text-lg tracking-widest uppercase"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.toUpperCase())}
              placeholder="AB12-CD34"
            />
            {pairError && (
              <p className="text-sm text-destructive">{pairError}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPairOpen(false)}>
                Batal
              </Button>
              <Button disabled={!pairCode.trim()} onClick={pair}>
                Hubungkan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={active && !!confirmation}
          onOpenChange={(open) => !open && setConfirmation(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Host baru terdeteksi</DialogTitle>
              <DialogDescription>{confirmation?.message}</DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border bg-muted p-3 font-mono text-sm break-all">
              {confirmation?.fingerprint}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmation(null)}>
                Batal
              </Button>
              <Button
                disabled={!username || !password || connecting}
                onClick={() => open(true)}
              >
                Percayai & Lanjutkan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
