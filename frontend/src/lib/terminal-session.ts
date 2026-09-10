export const TERMINAL_SESSION_KEY = "hd-work:ssh-session";
export const TERMINAL_LOGOUT_EVENT = "hd-work:terminal-logout";

export type TerminalRecovery = {
  workspace_id?: string;
  session_id: string;
  resume_token: string;
  user_id: number;
  grace_ms: number;
};

export function readTerminalRecoveries(): TerminalRecovery[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TERMINAL_SESSION_KEY) || "null");
    return (Array.isArray(saved) ? saved : saved ? [saved] : []).filter((item) =>
      item && typeof item.session_id === "string" && typeof item.resume_token === "string" &&
      typeof item.user_id === "number" && Number.isFinite(item.grace_ms) && item.grace_ms > 0
    ).map((item) => ({ ...item, workspace_id: item.workspace_id || "manual-1" }));
  } catch { return []; }
}

export function readTerminalRecovery(workspaceId?: string): TerminalRecovery | null {
  return readTerminalRecoveries().find((item) => !workspaceId || item.workspace_id === workspaceId) || null;
}

export function saveTerminalRecovery(saved: TerminalRecovery, workspaceId = "manual-1") {
  // Per-tab recovery capability only. Never store SSH password or terminal output.
  try { sessionStorage.setItem(TERMINAL_SESSION_KEY, JSON.stringify([
    ...readTerminalRecoveries().filter((item) => item.workspace_id !== workspaceId),
    { ...saved, workspace_id: workspaceId },
  ])); } catch { /* Storage may be blocked. */ }
}

export function clearTerminalRecovery(workspaceId?: string) {
  try {
    if (workspaceId) sessionStorage.setItem(TERMINAL_SESSION_KEY, JSON.stringify(readTerminalRecoveries().filter((item) => item.workspace_id !== workspaceId)));
    else {
      sessionStorage.removeItem(TERMINAL_SESSION_KEY);
      sessionStorage.removeItem("hd-work:terminal-workspaces");
    }
  } catch { /* Storage may be blocked. */ }
}

// Duplicated tabs can inherit sessionStorage. Only one live tab may own recovery.
export async function lockTerminalSession(id: string): Promise<(() => void) | null> {
  if (!navigator.locks) return () => {};
  return new Promise((resolve) => {
    navigator.locks.request(`hd-work:ssh:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return; }
      return new Promise<void>((release) => resolve(release));
    }).catch(() => resolve(null));
  });
}
