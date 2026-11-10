const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/services/telegram.service.js"), "utf8");

function fixture({ date = Date, callApi, wait = async () => {}, poll = async () => {}, stop = () => {}, timers = { setTimeout, clearTimeout } }) {
  const state = { registrations: 0, starts: 0, stops: 0, delays: [], logs: [] };
  const dependencies = {
    telegraf: {
      Telegraf: class {
        telegram = { callApi };
        constructor() { state.client = this.telegram; }
        command() { state.registrations += 1; }
        on() {}
        action() {}
        catch() {}
        use() {}
        startPolling() { state.starts += 1; return poll(); }
        stop() { state.stops += 1; stop(); }
      },
    },
    "node:timers/promises": {
      setTimeout: (ms, value, { signal }) => {
        state.delays.push(ms);
        return wait(signal);
      },
    },
  };
  const log = (message) => state.logs.push(message);
  const context = {
    module: { exports: {} },
    require: (name) => dependencies[name] || (name === "./telegram-transport" ? require("../src/services/telegram-transport") : name.startsWith("node:") ? require(name) : {}),
    process: { env: { TELEGRAM_BOT_TOKEN: "test-only" } },
    AbortController, AbortSignal, Date: date,
    ...timers,
    console: { log, warn: log, error: log },
  };
  vm.runInNewContext(source, context);
  return { service: context.module.exports, state };
}

test("transient startup failures use five retries and concurrent calls share one task", async () => {
  let calls = 0;
  const { service, state } = fixture({
    callApi: async () => {
      calls += 1;
      throw Object.assign(new Error("network down"), { name: "FetchError" });
    },
  });

  const task = service.startPolling();
  assert.equal(service.startPolling(), task);
  await task;
  assert.equal(calls, 6);
  assert.deepEqual(state.delays, [2000, 4000, 8000, 16000, 30000]);
  assert.equal(state.starts, 0);
  assert.match(state.logs.at(-1), /6 percobaan/);
});

test("startup retries a temporary error and stops the single active polling loop", async () => {
  let failOnce = true;
  let finishPoll;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const { service, state } = fixture({
    callApi: async (method) => {
      if (method === "deleteWebhook" && failOnce) {
        failOnce = false;
        throw Object.assign(new Error("rate limited"), { code: 429, parameters: { retry_after: 3 } });
      }
      return {};
    },
    poll: () => new Promise((resolve) => {
      finishPoll = resolve;
      markStarted();
    }),
    stop: () => finishPoll(),
  });

  const task = service.startPolling();
  const registrations = state.registrations;
  await started;
  assert.deepEqual(state.delays, [3000]);
  assert.equal(state.registrations, registrations);
  assert.equal(service.startPolling(), task);
  await Promise.all([service.stopPolling("SIGINT"), service.stopPolling("SIGTERM")]);
  assert.equal(state.starts, 1);
  assert.equal(state.stops, 1);
});

test("shutdown cancels either an in-flight setup request or a scheduled retry", async () => {
  for (const stage of ["setup", "retry"]) {
    let markPending;
    const pending = new Promise((resolve) => { markPending = resolve; });
    const untilAborted = (signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      markPending();
    });
    const { service, state } = fixture({
      callApi: async (method, payload, { signal }) => {
        if (stage === "setup") return untilAborted(signal);
        throw Object.assign(new Error("network down"), { name: "FetchError" });
      },
      wait: untilAborted,
    });

    const task = service.startPolling();
    await pending;
    assert.equal(service.stopPolling("SIGTERM"), task);
    await task;
    assert.equal(state.starts, 0);
    assert.equal(state.stops, 0);
    assert.equal(state.delays.length, stage === "retry" ? 1 : 0);
  }
});

test("a polling conflict reports 409 and does not retry", async () => {
  const { service, state } = fixture({
    callApi: async () => ({}),
    poll: async () => { throw Object.assign(new Error("conflict"), { code: 409 }); },
  });
  await service.startPolling();
  assert.equal(state.starts, 1);
  assert.deepEqual(state.delays, []);
  assert.match(state.logs.at(-1), /409/);
});

test("Telegram deadlines abort real requests and remain retryable for polling", async () => {
  const pending = new Map();
  let nextTimer = 0;
  const { state } = fixture({
    callApi: async (method, payload, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
    timers: {
      setTimeout(callback, milliseconds) { const id = ++nextTimer; pending.set(id, { callback, milliseconds }); return id; },
      clearTimeout(id) { pending.delete(id); },
    },
  });

  for (const [method, timeout] of [["sendDocument", 20000], ["getUpdates", 25000], ["getMe", 10000], ["deleteWebhook", 10000]]) {
    const request = state.client.callApi(method, method === "getUpdates" ? { timeout: 50 } : {});
    const timer = [...pending.values()][0];
    assert.equal(timer.milliseconds, timeout);
    timer.callback();
    await assert.rejects(request, { name: "FetchError", code: "ETIMEDOUT" });
    assert.equal(pending.size, 0);
  }
});

test("Telegram polling preserves cancellation from Telegraf's AbortController shim", async () => {
  const { AbortController: ShimController } = require("abort-controller");
  const { state } = fixture({
    callApi: async (method, payload, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  });
  const controller = new ShimController();
  const request = state.client.callApi("getUpdates", {}, controller);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});

test("shorter long polling preserves offsets and leaves shutdown synchronization unchanged", async () => {
  const calls = [];
  const { state } = fixture({
    callApi: async (method, payload) => { calls.push(payload); return []; },
  });
  await state.client.callApi("getUpdates", { offset: 123, timeout: 50, allowed_updates: ["message"] });
  assert.equal(calls[0].timeout, 10);
  assert.equal(calls[0].offset, 123);
  assert.deepEqual(calls[0].allowed_updates, ["message"]);
  await state.client.callApi("getUpdates", { offset: 124, limit: 1 });
  assert.equal(calls[1].timeout, undefined);
  assert.equal(calls[1].offset, 124);
});

test("409 following a request timeout gets bounded recovery with a cooldown", async () => {
  for (const permanent of [false, true]) {
    let fireTimeout;
    let starts = 0;
    const { service, state } = fixture({
      callApi: async (method, payload, { signal }) => {
        if (method !== "getUpdates") return {};
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        });
      },
      poll: async () => {
        starts += 1;
        if (permanent || starts === 1) throw Object.assign(new Error("conflict"), { code: 409 });
      },
      timers: {
        setTimeout(callback, milliseconds) { if (milliseconds === 25000) fireTimeout = callback; return 1; },
        clearTimeout() {},
      },
    });
    const expired = state.client.callApi("getUpdates", { timeout: 50 });
    fireTimeout();
    await assert.rejects(expired, { code: "ETIMEDOUT" });
    await service.startPolling();
    assert.equal(state.starts, permanent ? 6 : 2);
    assert.equal(state.delays.length, permanent ? 5 : 1);
    assert.equal(state.delays[0], 15000);
  }
});

test("polling errors redact bot credentials and routine batches stay quiet by default", async () => {
  const { service, state } = fixture({
    callApi: async () => { throw new Error('request to https://api.telegram.org/bot123456:fake_test_credential/getMe failed'); },
  });
  await service.startPolling();
  assert.match(state.logs.at(-1), /bot\[REDACTED\]/);
  assert.ok(!state.logs.join('\n').includes('fake_test_credential'));

  const quiet = fixture({ callApi: async () => [{ update_id: 1 }] });
  await quiet.state.client.callApi('getUpdates', { timeout: 50 });
  assert.equal(quiet.state.logs.length, 0);
});


test("a successful batch after a network reset retains bounded conflict recovery; old failures do not mask another poller", async () => {
  for (const expired of [false, true]) {
    let now = 1000000;
    class Clock extends Date { static now() { return now; } }
    let failNetwork = true;
    const { service, state } = fixture({
      date: Clock,
      callApi: async (method) => {
        if (method !== "getUpdates") return {};
        if (failNetwork) {
          failNetwork = false;
          throw Object.assign(new Error("reset"), { name: "FetchError", code: "ECONNRESET" });
        }
        return [{ update_id: 42 }];
      },
      poll: async () => {
        if (state.starts === 1) {
          // A batch arrives successfully, then the following request sees a conflict.
          await state.client.callApi("getUpdates", { timeout: 50, offset: 42 });
          if (expired) now += 120001;
          throw Object.assign(new Error("conflict"), { code: 409 });
        }
      },
    });
    await assert.rejects(state.client.callApi("getUpdates", { timeout: 50 }), { code: "ECONNRESET" });
    await service.startPolling();
    assert.equal(state.starts, expired ? 1 : 2);
    assert.deepEqual(state.delays, expired ? [] : [15000]);
    if (expired) assert.match(state.logs.at(-1), /konflik 409/);
  }
});

test("four failed setup attempts leave the first polling recovery at retry one", async () => {
  let setups = 0;
  const { service, state } = fixture({
    callApi: async method => {
      if (method === "getMe" && setups++ < 4) {
        throw Object.assign(new Error("setup down"), { name: "FetchError" });
      }
      return {};
    },
    poll: async () => {
      if (state.starts === 1) throw Object.assign(new Error("poll down"), { name: "FetchError" });
    },
  });
  await service.startPolling();
  assert.equal(state.starts, 2);
  assert.deepEqual(state.delays, [2000, 4000, 8000, 16000, 2000]);
  assert.equal(service.getPollingStatus().startup_retries, 0);
  assert.equal(service.getPollingStatus().recovery_retries, 1);
  assert.ok(state.logs.some(line => /fase recovery:.*Retry 1\/5/.test(line)));
});

test("sustained healthy polling replenishes recovery without starting an overlapping loop", async () => {
  let now = 1000000;
  class Clock extends Date { static now() { return now; } }
  let activeLoops = 0;
  const { service, state } = fixture({
    date: Clock,
    callApi: async method => {
      if (method === "getUpdates") { now += 10000; return []; }
      return {};
    },
    poll: async () => {
      assert.equal(++activeLoops, 1);
      try {
        if (state.starts === 6) {
          for (let count = 0; count < 3; count++) {
            await state.client.callApi("getUpdates", { timeout: 50 });
          }
          assert.equal(service.getPollingStatus().state, "running");
          assert.equal(service.getPollingStatus().recovery_retries, 0);
        }
        if (state.starts <= 6) throw Object.assign(new Error("poll failed"), { name: "FetchError" });
      } finally { activeLoops--; }
    },
  });
  await service.startPolling();
  assert.equal(state.starts, 7);
  assert.deepEqual(state.delays, [2000, 4000, 8000, 16000, 30000, 2000]);
  assert.ok(state.logs.some(line => /anggaran retry pemulihan direset/.test(line)));
  assert.equal(service.getPollingStatus().state, "stopped");
  assert.equal(service.getPollingStatus().reason, "polling_ended");
});

test("quick successful polls do not reset persistent failure budgets and stopped status is explicit", async () => {
  let now = 1000000;
  class Clock extends Date { static now() { return now; } }
  const { service, state } = fixture({
    date: Clock,
    callApi: async method => {
      if (method === "getUpdates") { now += 1; return []; }
      return {};
    },
    poll: async () => {
      for (let count = 0; count < 3; count++) await state.client.callApi("getUpdates", { timeout: 50 });
      throw Object.assign(new Error("poll failed"), { name: "FetchError" });
    },
  });
  await service.startPolling();
  assert.equal(state.starts, 6);
  assert.equal(state.delays.length, 5);
  const status = service.getPollingStatus();
  assert.equal(status.state, "stopped");
  assert.equal(status.reason, "retry_exhausted");
  assert.equal(status.phase, "recovery");
  assert.match(state.logs.at(-1), /API tetap berjalan, tetapi polling tidak aktif/);
  status.state = "tampered";
  assert.equal(service.getPollingStatus().state, "stopped");
});
