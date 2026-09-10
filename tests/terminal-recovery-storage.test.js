const { test } = require("node:test");
const assert = require("node:assert/strict");

test("browser storage isolates recovery per workspace and migrates legacy single session", async () => {
  const values = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } });
  try {
    const storage = await import("../frontend/src/lib/terminal-session.ts");
    const first = { session_id: "one", resume_token: "secret-one", user_id: 1, grace_ms: 60000 };
    values.set(storage.TERMINAL_SESSION_KEY, JSON.stringify(first));
    assert.equal(storage.readTerminalRecovery("manual-1").session_id, "one");
    storage.saveTerminalRecovery({ ...first, session_id: "two" }, "manual-2");
    storage.saveTerminalRecovery({ ...first, session_id: "three" }, "quick");
    assert.equal(storage.readTerminalRecoveries().length, 3);
    storage.clearTerminalRecovery("manual-2");
    assert.equal(storage.readTerminalRecovery("manual-2"), null);
    assert.equal(storage.readTerminalRecovery("quick").session_id, "three");
    assert.equal(storage.readTerminalRecovery("manual-1").session_id, "one");
    storage.clearTerminalRecovery();
    assert.deepEqual(storage.readTerminalRecoveries(), []);
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete globalThis.sessionStorage;
  }
});
