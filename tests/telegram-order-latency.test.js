const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter, once } = require("node:events");
const { Telegraf } = require("telegraf");

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

test("real Telegraf polling accepts successive order batches while an outgoing file is pending", { timeout: 3000 }, async () => {
  const events = new EventEmitter();
  const outgoingStarted = deferred();
  const outgoing = deferred();
  const created = [];
  const photos = [];
  let waitingPoll;
  let downloadAttempts = 0;
  let outgoingFinished = false;
  let commitAttempts = 0;

  class LocalBot extends Telegraf {
    constructor(token, options) {
      super(token, options);
      this.telegram.callApi = async (method, payload, { signal } = {}) => {
        if (method === "getMe") return { id: 100, username: "hdwork_test", is_bot: true };
        if (method === "deleteWebhook") return true;
        if (method === "sendDocument") {
          outgoingStarted.resolve();
          const result = await outgoing.promise;
          outgoingFinished = true;
          return result;
        }
        if (method === "getUpdates") {
          if (payload.limit === 1) return [];
          assert.equal(payload.timeout, 10);
          assert.equal(this.telegram.options.agent.keepAlive, false);
          return new Promise((resolve, reject) => {
            waitingPoll = resolve;
            signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
            events.emit("poll");
          });
        }
        throw new Error(`Unexpected Telegram API call: ${method}`);
      };
    }
  }

  const dependencies = {
    telegraf: { Telegraf: LocalBot },
    "node:timers/promises": require("node:timers/promises"),
    "../repositories/telegram.repository": {
      getGroupByChatThread: async () => ({ id: 8, category: "PENGAWALAN", is_active: 1 }),
    },
    "../repositories/order.repository": {
      createIncomingOrder: async ({ message }) => {
        if (message.message_id === 3) {
          commitAttempts += 1;
          if (commitAttempts > 1) return null;
          created.push(message.message_id);
          throw Object.assign(new Error("connection lost after commit"), { code: "ECONNRESET" });
        }
        created.push(message.message_id);
        return { id: message.message_id };
      },
    },
    "../repositories/order-source.repository": {
      record: async (group, message) => photos.push(message.photo.at(-1).file_id),
      link: async () => 1,
      pending: async () => { downloadAttempts += 1; return []; },
    },
    "./order-source-photo.service": {
      ensurePhoto: async () => { downloadAttempts += 1; return new Promise(() => {}); },
    },
    "../services/realtime.service": { emitOrdersChanged() { events.emit("changed"); } },
    "../repositories/order-conversation.repository": { recordOutgoing: async () => {} },
  };
  const moduleObject = { exports: {} };
  new Function("require", "module", "process", fs.readFileSync(require.resolve("../src/services/telegram.service"), "utf8"))(
    (name) => dependencies[name] || (name.startsWith("node:") ? require(name) : {}), moduleObject, { env: { TELEGRAM_BOT_TOKEN: "test-only" } },
  );
  const service = moduleObject.exports;
  const polling = service.startPolling();

  async function sendBatch(message) {
    if (!waitingPoll) await once(events, "poll");
    const deliver = waitingPoll;
    waitingPoll = undefined;
    const changed = once(events, "changed");
    deliver([{ update_id: message.message_id, message: {
      chat: { id: -100, type: "supergroup" }, from: { id: 5, is_bot: false, first_name: "Pelapor" },
      date: Math.floor(Date.now() / 1000), is_topic_message: true, message_thread_id: 7, ...message,
    } }]);
    await changed;
  }

  let delivery;
  try {
    delivery = service.notifyOrderResult({
      chat_id: -100, thread_id: 7, message_id: 10, order_id: 10,
      files: [{ local_path: "/test/result.pdf", file_name: "result.pdf", mime_type: "application/pdf" }],
    });
    await outgoingStarted.promise;
    await sendBatch({ message_id: 1, caption: "#req 123, foto", photo: [{ file_id: "small" }, { file_id: "large" }] });
    await sendBatch({ message_id: 2, text: "#req 456, cek" });
    await sendBatch({ message_id: 3, text: "#req 789, cek" });
    assert.deepEqual(created, [1, 2, 3]);
    assert.equal(commitAttempts, 2);
    assert.deepEqual(photos, ["large"]);
    assert.equal(downloadAttempts, 0);
    assert.equal(outgoingFinished, false);
  } finally {
    outgoing.resolve({ message_id: 20 });
    await delivery;
    await service.stopPolling("test");
    await polling;
  }
});
