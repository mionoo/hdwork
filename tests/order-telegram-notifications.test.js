const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function load(relativePath, dependencies, env = {}) {
  const context = {
    module: { exports: {} }, console, setTimeout,
    process: { env },
    require: (name) => dependencies[name] || {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, relativePath), "utf8"), context);
  return context.module.exports;
}

function telegram() {
  const calls = [];
  const api = {};
  for (const method of ["sendMessage", "sendPhoto", "sendDocument", "sendMediaGroup"]) {
    api[method] = async (...args) => {
      calls.push({ method, args });
      return method === "sendMediaGroup" ? args[1].map((_, i) => ({ message_id: i + 1 })) : { message_id: 1 };
    };
  }
  const service = load("../src/services/telegram.service.js", {
    telegraf: { Telegraf: class { constructor() { this.telegram = api; } } },
  }, { TELEGRAM_BOT_TOKEN: "test-only" });
  return { service, calls, api };
}

const notification = { chat_id: -100, message_id: 12, thread_id: 7, user_name: "Fajar", content: "done" };
const photo = { local_path: "/test/photo.jpg", file_name: "photo.jpg", mime_type: "image/jpeg" };

test("text result contains only user content and replies to the original topic/order", async () => {
  const { service, calls } = telegram();
  assert.equal((await service.notifyOrderResult(notification)).delivered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[1], "done");
  assert.equal(calls[0].args[2].reply_to_message_id, 12);
  assert.equal(calls[0].args[2].message_thread_id, 7);
});

test("photo uses user content as caption with no extra text message", async () => {
  const { service, calls } = telegram();
  await service.notifyOrderResult({ ...notification, files: [photo] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendPhoto");
  assert.equal(calls[0].args[2].caption, "done");
});

test("multiple photos form one album with one user caption", async () => {
  const { service, calls } = telegram();
  await service.notifyOrderResult({ ...notification, files: [photo, photo] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendMediaGroup");
  assert.equal(calls[0].args[1][0].caption, "done");
  assert.equal(calls[0].args[1][1].caption, undefined);
});

test("file-only results add no automatic caption", async () => {
  const { service, calls } = telegram();
  await service.notifyOrderResult({ ...notification, content: "", files: [photo] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[2].caption, undefined);
});

test("long user content is preserved as text rather than an oversized caption", async () => {
  const { service, calls } = telegram();
  const content = "a".repeat(1025);
  await service.notifyOrderResult({ ...notification, content, files: [photo] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[1], content);
  assert.equal(calls[1].args[2].caption, undefined);
});

test("failed albums report failure without a duplicate fallback send", async () => {
  const { service, calls, api } = telegram();
  api.sendMediaGroup = async () => { throw new Error("delivery failed"); };
  const result = await service.notifyOrderResult({ ...notification, files: [photo, photo] });
  assert.equal(result.delivered, false);
  assert.match(result.error, /delivery failed/);
  assert.equal(calls.length, 0);
});

for (const hasResult of [true, false]) {
  test(`complete ${hasResult ? "with new" : "with previously sent"} result sends no status notification`, async () => {
    let resultCalls = 0;
    const controller = load("../src/controllers/order.controller.js", {
      "../services/order.service": {
        completeOrder: async () => ({ telegram: { ...notification, result: hasResult ? { result_id: 3, content: "done" } : null } }),
        markResultTelegramDelivery: async () => {},
      },
      "../services/telegram.service": {
        notifyOrderResult: async () => { resultCalls++; return { delivered: true, message_id: 8 }; },
        notifyOrderCompleted: async () => { assert.fail("must not send status message"); },
      },
      "../services/realtime.service": { emitOrdersChanged() {} },
    });
    let response;
    const res = { status(code) { assert.equal(code, 200); return this; }, json(body) { response = body; } };
    await controller.completeOrder({ params: { id: 1 }, user: { id: 2 }, body: {}, files: [] }, res);
    assert.equal(resultCalls, hasResult ? 1 : 0);
    assert.equal(response.success, true);
    assert.equal(response.data.telegram_delivery.completion.skipped, true);
  });
}
