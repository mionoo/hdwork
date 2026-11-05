const storageKey = "hdwork:active-order-room"

export function readActiveOrderRoom(userId: number): string | null {
  try {
    const entry = JSON.parse(sessionStorage.getItem(storageKey) || "null")
    if (entry?.userId === userId && typeof entry.roomId === "string" && /^\d+$/.test(entry.roomId)) {
      return entry.roomId
    }
  } catch { /* Storage may be unavailable; the URL still works. */ }
  return null
}

export function rememberActiveOrderRoom(userId: number, roomId: string) {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ userId, roomId })) }
  catch { /* The room remains available through its current URL. */ }
}

export function clearActiveOrderRoom() {
  try { sessionStorage.removeItem(storageKey) }
  catch { /* No stored room to clear. */ }
}
