import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, TerminalSquare, Activity } from "lucide-react";
import NetworkTerminalPane, { type TerminalPaneState } from "@/components/NetworkTerminalPane";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readTerminalRecoveries } from "@/lib/terminal-session";
import { useNetworkHealth } from "@/lib/use-network-health";

export const MAX_MANUAL_TERMINALS = 5;
const WORKSPACE_KEY = "hd-work:terminal-workspaces";
type Tab = { id: string; name: string };
type Workspace = { tabs: Tab[]; selected: string; quickVisited: boolean };

function restore(userId?: number): Workspace {
  let tabs: Tab[] = [], selected = "manual-1", quickVisited = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(WORKSPACE_KEY) || "null");
    if (saved?.userId === userId && Array.isArray(saved.tabs)) {
      tabs = saved.tabs.filter((tab: Tab) => typeof tab?.id === "string" && tab.id.startsWith("manual-") && typeof tab.name === "string").slice(0, MAX_MANUAL_TERMINALS);
      tabs = tabs.filter((tab, i) => tabs.findIndex((item) => item.id === tab.id) === i);
      selected = saved.selected;
      quickVisited = !!saved.quickVisited;
    }
  } catch { /* Private browsing may disable storage. */ }
  for (const saved of readTerminalRecoveries().filter((item) => item.user_id === userId)) {
    if (saved.workspace_id === "quick") quickVisited = true;
    else if (saved.workspace_id?.startsWith("manual-") && !tabs.some((tab) => tab.id === saved.workspace_id) && tabs.length < MAX_MANUAL_TERMINALS) {
      tabs.push({ id: saved.workspace_id, name: `Terminal ${tabs.length + 1}` });
    }
  }
  if (!tabs.length) tabs.push({ id: "manual-1", name: "Terminal 1" });
  if (selected !== "quick" && !tabs.some((tab) => tab.id === selected)) selected = tabs[0].id;
  return { tabs, selected, quickVisited: quickVisited || selected === "quick" };
}

export default function NetworkToolsPage({ active = true }: { active?: boolean }) {
  const { user, token } = useAuth();
  const health = useNetworkHealth(token, active);
  const [workspace, setWorkspace] = useState(() => restore(user?.id));
  const [states, setStates] = useState<Record<string, TerminalPaneState>>({});
  const [closing, setClosing] = useState<Tab | null>(null);
  const closers = useRef(new Map<string, () => void>());
  const onState = useCallback((id: string, state: TerminalPaneState) => setStates((old) => ({ ...old, [id]: state })), []);
  const registerClose = useCallback((id: string, close: (() => void) | null) => {
    if (close) closers.current.set(id, close); else closers.current.delete(id);
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...workspace, userId: user?.id })); } catch { /* Storage may be blocked. */ }
  }, [workspace, user?.id]);
  useEffect(() => { if (!active) setClosing(null); }, [active]);
  const manual = workspace.selected !== "quick";
  function addTab() {
    setWorkspace((old) => {
      if (old.tabs.length >= MAX_MANUAL_TERMINALS) return old;
      const id = `manual-${crypto.randomUUID()}`;
      return { ...old, selected: id, tabs: [...old.tabs, { id, name: `Terminal ${old.tabs.length + 1}` }] };
    });
  }
  function removeTab() {
    if (!closing) return;
    closers.current.get(closing.id)?.();
    setWorkspace((old) => {
      const tabs = old.tabs.filter((tab) => tab.id !== closing.id);
      return { ...old, tabs, selected: old.selected === closing.id ? tabs[0]?.id || "quick" : old.selected, quickVisited: old.quickVisited || tabs.length === 0 };
    });
    setStates((old) => { const next = { ...old }; delete next[closing.id]; return next; });
    setClosing(null);
  }
  const navigation = (
    <section className="min-w-0 space-y-3" aria-label="Pilihan terminal">
      <div className="flex flex-wrap gap-2">
        <Button variant={!manual ? "default" : "outline"} aria-pressed={!manual} onClick={() => setWorkspace((old) => ({ ...old, selected: "quick", quickVisited: true }))}><Activity className="size-4" />01 · Quick Action</Button>
        <Button variant={manual ? "default" : "outline"} aria-pressed={manual} onClick={() => workspace.tabs.length ? setWorkspace((old) => ({ ...old, selected: old.tabs[0].id })) : addTab()}><TerminalSquare className="size-4" />02 · Terminal Manual</Button>
        <span className="self-center text-xs text-muted-foreground">{Object.values(states).filter((state) => state.connected).length} sesi SSH aktif</span>
      </div>
      {manual && <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2" aria-label="Tab terminal manual">
        {workspace.tabs.map((tab) => {
          const state = states[tab.id];
          const status = state?.connected ? "Terhubung" : state?.recovering ? "Memulihkan" : state?.connecting ? "Menghubungkan" : "Belum terhubung";
          return <div key={tab.id} className={`flex max-w-full items-center rounded-lg border ${workspace.selected === tab.id ? "border-primary/50 bg-primary/10" : "bg-background"}`}>
            <Button variant="ghost" className="min-w-0" aria-pressed={workspace.selected === tab.id} aria-label={`${tab.name}, ${status}`} onClick={() => setWorkspace((old) => ({ ...old, selected: tab.id }))}>
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${state?.connected ? "bg-emerald-500" : state?.recovering || state?.connecting ? "bg-amber-400" : "bg-muted-foreground"}`} />
              <span className="max-w-40 truncate">{tab.name}</span>
            </Button>
            <Button variant="ghost" size="icon" aria-label={`Tutup ${tab.name}`} disabled={state?.connecting || state?.recovering} onClick={() => setClosing(tab)}><X className="size-4" /></Button>
          </div>;
        })}
        <Button variant="ghost" disabled={workspace.tabs.length >= MAX_MANUAL_TERMINALS} onClick={addTab}><Plus className="size-4" />Tab baru</Button>
        <span className="px-2 text-xs text-muted-foreground">{workspace.tabs.length}/{MAX_MANUAL_TERMINALS}</span>
      </div>}
      {manual && <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Nama tab
        <input className="h-9 w-56 max-w-full rounded-lg border bg-background px-3 text-sm text-foreground" maxLength={40} value={workspace.tabs.find((tab) => tab.id === workspace.selected)?.name || ""} onChange={(event) => {
          const name = event.target.value;
          setWorkspace((old) => ({ ...old, tabs: old.tabs.map((tab) => tab.id === old.selected ? { ...tab, name } : tab) }));
        }} />
      </label>}
    </section>
  );
  const panes = [...workspace.tabs.map((tab) => ({ id: tab.id, kind: "manual" as const })), ...(workspace.quickVisited ? [{ id: "quick", kind: "quick" as const }] : [])];
  return <>
    {panes.map((pane) => <div key={pane.id} hidden={workspace.selected !== pane.id}>
      <NetworkTerminalPane workspaceId={pane.id} kind={pane.kind} active={active && workspace.selected === pane.id} navigation={navigation} onState={onState} registerClose={registerClose} health={health} />
    </div>)}
    <Dialog open={active && !!closing} onOpenChange={(open) => !open && setClosing(null)}>
      <DialogContent><DialogHeader><DialogTitle>Tutup {closing?.name || "terminal"}?</DialogTitle><DialogDescription>Koneksi SSH dan riwayat terminal ini akan ditutup. Tab lain dan Quick Action tetap berjalan.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setClosing(null)}>Batal</Button><Button variant="destructive" onClick={removeTab}>Tutup sesi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
