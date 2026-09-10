const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTerminalSessionManager } = require("../src/services/terminal-session-manager");

test("limits five manual plus one quick across sockets and login tokens, including detached sessions", async (t) => {
  const f = setup(t);
  const manuals = [];
  for (let i = 0; i < 5; i++) {
    const socket = f.socket(1, `login-${i}`);
    const saved = await f.open(socket);
    assert.equal(saved.success, true);
    assert.equal(saved.kind, "manual");
    manuals.push({ socket, saved });
  }
  manuals[0].socket.disconnect();
  assert.equal((await f.open(f.socket())).code, "SESSION_LIMIT");
  const quick = f.socket();
  assert.equal((await quick.send("terminal:open", { host: "test", kind: "quick" })).success, true);
  assert.equal((await f.socket().send("terminal:open", { host: "test", kind: "quick" })).code, "SESSION_LIMIT");
  assert.equal((await f.open(f.socket(2))).success, true, "different HD has an independent quota");
  await manuals[1].socket.send("terminal:close", manuals[1].saved);
  assert.equal((await f.open(f.socket())).success, true, "closing one releases only its slot");
  assert.equal((await f.socket().send("terminal:open", { kind: "invalid" })).code, "INVALID_KIND");
});

test("each manual and quick session restores independent output, close and input routing", async (t) => {
  const f = setup(t);
  const saved = [];
  for (const kind of ["manual", "manual", "quick"]) {
    const socket = f.socket();
    const session = await socket.send("terminal:open", { host: "test", kind });
    f.output(session, `output-${saved.length}`);
    socket.disconnect();
    saved.push(session);
  }
  const clients = saved.map(() => f.socket());
  for (let i = 0; i < saved.length; i++) {
    const resumed = await clients[i].send("terminal:resume", saved[i]);
    assert.equal(resumed.output, `output-${i}`);
    assert.equal(resumed.kind, i === 2 ? "quick" : "manual");
  }
  await clients[0].send("terminal:input", { session_id: saved[1].session_id, data: "wrong target" });
  assert.equal(f.sent.length, 0);
  await clients[0].send("terminal:close", saved[0]);
  assert.equal(f.closes().length, 1);
  f.output(saved[1], "still active");
  assert.equal(clients[1].events.at(-1).payload.data, "still active");
  assert.equal(clients[2].events.some((event) => event.event === "terminal:closed"), false);
});

test("pending opens reserve quota before agent acknowledgment", async (t) => {
  let resolve;
  const f = setup(t, { agent: { requestAgentCommand: () => new Promise((done) => { resolve = done; }) } });
  const first = f.socket();
  const pending = first.send("terminal:open", { host: "test", kind: "quick" });
  assert.equal((await f.socket().send("terminal:open", { host: "test", kind: "quick" })).code, "SESSION_LIMIT");
  resolve({ success: true });
  assert.equal((await pending).success, true);
});

test("busy Quick Action does not block manual input or lose its result", async (t) => {
  let finish;
  const f = setup(t, { executeTool: () => new Promise((resolve) => { finish = resolve; }) });
  const manual = f.socket(), quick = f.socket();
  const m = await f.open(manual);
  const q = await quick.send("terminal:open", { host: "test", kind: "quick" });
  const running = quick.send("terminal:tool", { session_id: q.session_id, tool: "CHECK_ONT_STATUS" });
  await manual.send("terminal:input", { session_id: m.session_id, data: "show version\r" });
  assert.equal(f.sent.at(-1)[2].session_id, m.session_id);
  await quick.send("terminal:input", { session_id: q.session_id, data: "blocked" });
  assert.equal(f.sent.length, 1);
  finish({ success: true, rawOutput: "quick-only" });
  await running;
  assert.equal(manual.events.some((event) => event.event === "terminal:tool-result"), false);
  assert.equal(quick.events.at(-1).payload.result.rawOutput, "quick-only");
});

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  let handlers, connect;
  const sent = [];
  const agent = {
    setTerminalEventHandlers: (value) => { handlers = value; },
    emitToUserAgent: (...args) => sent.push(args),
    requestAgentCommand: async () => ({ success: true }),
    isUserAgentConnected: () => true,
    ...options.agent,
  };
  const manager = createTerminalSessionManager({ agent, executeTool: options.executeTool || (async () => ({ success: true })), outputBytes: options.outputBytes || 1024 });
  manager.initialize({ on: (_, callback) => { connect = callback; } });
  let count = 0;
  function socket(userId = 1, token = "login-1", expires = 4600) {
    const listeners = new Map();
    const value = {
      id: `socket-${++count}`, connected: true,
      data: { user: { id: userId, role: "HD", exp: expires } }, handshake: { auth: { token } },
      events: [],
      on: (event, callback) => listeners.set(event, callback),
      emit: (event, payload) => value.events.push({ event, payload }),
      send: async (event, payload) => {
        let response;
        await listeners.get(event)(payload, (data) => { response = data; });
        return response;
      },
      disconnect: () => { value.connected = false; listeners.get("disconnect")(); },
    };
    connect(value);
    return value;
  }
  const open = (client) => client.send("terminal:open", { host: "10.0.0.1", port: 22, username: "test", password: "not-stored" });
  const output = (saved, data, userId = 1) => handlers.data({ user_id: userId }, { session_id: saved.session_id, data });
  const closes = () => sent.filter((item) => item[1] === "terminal:close");
  return { socket, open, output, closes, manager, sent, handlers, agent };
}

test("refresh resumes the same SSH connection and replays ordered output", async (t) => {
  const f = setup(t);
  const first = f.socket();
  const saved = await f.open(first);
  f.output(saved, "before\r\n");
  first.disconnect();
  assert.equal(f.closes().length, 0);
  f.output(saved, "during refresh\r\n");
  t.mock.timers.tick(59_000);
  const second = f.socket();
  const resumed = await second.send("terminal:resume", saved);
  assert.equal(resumed.session_id, saved.session_id);
  assert.equal(resumed.output, "before\r\nduring refresh\r\n");
  assert.equal(resumed.username, "test");
  assert.equal(JSON.stringify(resumed).includes("not-stored"), false);
  f.output(saved, "after");
  assert.equal(second.events.at(-1).payload.data, "after");
  t.mock.timers.tick(2000);
  assert.equal(f.closes().length, 0, "grace timer must be canceled after resume");
});

test("grace timeout closes SSH and rejects stale credentials", async (t) => {
  const f = setup(t);
  const first = f.socket();
  const saved = await f.open(first);
  first.disconnect();
  t.mock.timers.tick(60_000);
  assert.equal(f.closes().length, 1);
  assert.equal((await f.socket().send("terminal:resume", saved)).success, false);
});

test("rejects another user, another login and incorrect resume capability", async (t) => {
  const f = setup(t);
  const first = f.socket();
  const saved = await f.open(first);
  first.disconnect();
  assert.equal((await f.socket(2).send("terminal:resume", saved)).success, false);
  assert.equal((await f.socket(1, "different-login").send("terminal:resume", saved)).success, false);
  assert.equal((await f.socket().send("terminal:resume", { ...saved, resume_token: "wrong" })).success, false);
  assert.equal((await f.socket().send("terminal:resume", saved)).success, true);
});

test("another tab cannot take over an attached terminal or send input", async (t) => {
  const f = setup(t);
  const first = f.socket(), other = f.socket();
  const saved = await f.open(first);
  assert.equal((await other.send("terminal:resume", saved)).code, "SESSION_ATTACHED");
  await other.send("terminal:input", { session_id: saved.session_id, data: "bad" });
  assert.equal(f.sent.length, 0);
  await other.send("terminal:close", saved);
  assert.equal(f.closes().length, 0);
});

test("expiry closes an attached session even with no browser activity", async (t) => {
  const f = setup(t);
  const first = f.socket(1, "login-1", 1005);
  await f.open(first);
  t.mock.timers.tick(5000);
  assert.equal(f.closes().length, 1);
  assert.equal(first.events.at(-1).event, "terminal:closed");
  assert.equal((await f.open(first)).code, "UNAUTHORIZED");
});

test("logout closes attached and detached sessions only for that login", async (t) => {
  const f = setup(t);
  const first = f.socket(), second = f.socket(), third = f.socket(2, "login-2");
  const saved = await f.open(first);
  await f.open(second);
  await f.open(third);
  first.disconnect();
  f.manager.closeLoginSessions("login-1");
  assert.equal(f.closes().length, 2);
  assert.equal((await f.socket().send("terminal:resume", saved)).success, false);
  assert.equal(third.events.filter((event) => event.event === "terminal:closed").length, 0);
});

test("output is bounded and untrusted agent output is ignored", async (t) => {
  const f = setup(t, { outputBytes: 64 });
  const first = f.socket();
  const saved = await f.open(first);
  first.disconnect();
  f.output(saved, "DO NOT ACCEPT", 2);
  f.output(saved, "long line\r\n".repeat(100) + "prompt#");
  const resumed = await f.socket().send("terminal:resume", saved);
  assert.ok(Buffer.byteLength(resumed.output) <= 64);
  assert.equal(resumed.output_truncated, true);
  assert.ok(resumed.output.endsWith("prompt#"));
  assert.equal(resumed.output.includes("DO NOT ACCEPT"), false);
});

test("Quick Action can finish while detached and is restored without rerunning", async (t) => {
  let finish;
  const f = setup(t, { executeTool: () => new Promise((resolve) => { finish = resolve; }) });
  const first = f.socket();
  const saved = await f.open(first);
  const pending = first.send("terminal:tool", { session_id: saved.session_id, tool: "CHECK_ONT_STATUS", input: { slot: "4" } });
  first.disconnect();
  finish({ success: true, summary: { status: "ONLINE" }, rawOutput: "done" });
  await pending;
  const resumed = await f.socket().send("terminal:resume", saved);
  assert.equal(resumed.busy, false);
  assert.equal(resumed.tool.id, "CHECK_ONT_STATUS");
  assert.equal(resumed.tool_result.summary.status, "ONLINE");
});

test("running Quick Action result reaches the resumed socket", async (t) => {
  let finish;
  const f = setup(t, { executeTool: () => new Promise((resolve) => { finish = resolve; }) });
  const first = f.socket();
  const saved = await f.open(first);
  const pending = first.send("terminal:tool", { session_id: saved.session_id, tool: "test" });
  first.disconnect();
  const second = f.socket();
  assert.equal((await second.send("terminal:resume", saved)).busy, true);
  finish({ success: true });
  await pending;
  assert.equal(second.events.at(-1).event, "terminal:tool-result");
});

test("agent loss or remote closure invalidates recovery", async (t) => {
  const f = setup(t);
  const first = f.socket();
  const saved = await f.open(first);
  first.disconnect();
  f.handlers.disconnected({ user_id: 1 });
  assert.equal((await f.socket().send("terminal:resume", saved)).success, false);
});

test("logout during open cannot leave a late successful SSH connection orphaned", async (t) => {
  let finish;
  const f = setup(t, { agent: { requestAgentCommand: () => new Promise((resolve) => { finish = resolve; }) } });
  const first = f.socket();
  const pending = f.open(first);
  f.manager.closeLoginSessions("login-1");
  finish({ success: true });
  await pending;
  assert.ok(f.closes().length >= 1);
});

test("remote closure while detached is terminal, and other agent cannot close it", async (t) => {
  const f = setup(t);
  const first = f.socket();
  const saved = await f.open(first);
  f.handlers.closed({ user_id: 2 }, saved);
  first.disconnect();
  const second = f.socket();
  assert.equal((await second.send("terminal:resume", saved)).success, true);
  second.disconnect();
  f.handlers.closed({ user_id: 1 }, { ...saved, reason: "Remote closed" });
  assert.equal((await f.socket().send("terminal:resume", saved)).success, false);
});

test("repeated refresh starts a fresh grace window but never extends login expiry", async (t) => {
  const f = setup(t);
  const first = f.socket(1, "login-1", 1090);
  const saved = await f.open(first);
  first.disconnect();
  t.mock.timers.tick(50_000);
  const second = f.socket(1, "login-1", 1090);
  assert.equal((await second.send("terminal:resume", saved)).success, true);
  second.disconnect();
  t.mock.timers.tick(39_000);
  assert.equal(f.closes().length, 0);
  t.mock.timers.tick(1000);
  assert.equal(f.closes().length, 1);
});

test("host confirmation leaves no ghost session and permits a trusted retry", async (t) => {
  let confirmed = false;
  const f = setup(t, { agent: { requestAgentCommand: async () => confirmed ? { success: true } : { success: false, requires_host_confirmation: true } } });
  const first = f.socket();
  assert.equal((await f.open(first)).requires_host_confirmation, true);
  confirmed = true;
  assert.equal((await f.open(first)).success, true);
});
