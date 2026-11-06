const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/services/telegram.service.js"), "utf8");

function fixture({ callApi, wait = async () => {}, poll = async () => {}, stop = () => {} }) {
  const state = { registrations: 0, starts: 0, stops: 0, delays: [], logs: [] };
  const dependencies = {
    telegraf: {
      Telegraf: class {
        telegram = { callApi };
        command() { state.registrations += 1; }
        on() {}
        action() {}
        catch() {}
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
    require: (name) => dependencies[name] || {},
    process: { env: { TELEGRAM_BOT_TOKEN: "test-only" } },
    AbortController, AbortSignal,
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
