const storageKey = "hdwork:active-order-room"
const monitoredKey = "hdwork:monitored-order-groups"

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

export function readMonitoredOrderGroups(userId: number): number[] {
  try {
    const entry = JSON.parse(sessionStorage.getItem(monitoredKey) || "null")
    if (entry?.userId === userId && Array.isArray(entry.groupIds)) {
      return entry.groupIds.filter((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)
    }
  } catch { /* Storage may be unavailable. */ }
  return []
}

export function rememberMonitoredOrderGroups(userId: number, groupIds: number[]) {
  try { sessionStorage.setItem(monitoredKey, JSON.stringify({ userId, groupIds })) }
  catch { /* The current selection remains usable. */ }
}

export function clearMonitoredOrderGroups() {
  try { sessionStorage.removeItem(monitoredKey) }
  catch { /* No stored selection to clear. */ }
}
