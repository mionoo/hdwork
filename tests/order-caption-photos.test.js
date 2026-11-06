const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(file, dependencies) {
  const sandbox = { module: { exports: {} }, console, setTimeout, AbortController, AbortSignal, process: { env: { TELEGRAM_BOT_TOKEN: "test-only" } }, require: (name) => dependencies[name] || {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
  return sandbox.module.exports;
}

async function fixture(category = "PENGAWALAN", active = true, conversation = { findParent: async () => null }) {
  const handlers = {}, created = [], photos = new Map(), downloads = [];
  let order = null;
  const service = load("src/services/telegram.service.js", {
    telegraf: { Telegraf: class {
      constructor() { this.telegram = { callApi: async () => ({}), sendMessage: async () => ({ message_id: 4 }) }; } command() {} action() {} catch() {}
      on(type, handler) { handlers[type] = handler; } async startPolling() {}
    } },
    "../repositories/telegram.repository": { getGroupByChatThread: async () => ({ id: 8, category, is_active: active }) },
    "../repositories/order.repository": { createIncomingOrder: async (payload) => {
      if (order) return null;
      created.push(payload); order = { id: 10 }; return order;
    } },
    "../repositories/order-source.repository": {
      record: async (group, message) => photos.set(message.message_id, { id: message.message_id, file_id: message.photo.at(-1).file_id }),
      link: async () => order?.id || null,
      pending: async () => [...photos.values()],
    },
    "../repositories/order-conversation.repository": conversation,
    "./order-source-photo.service": { ensurePhoto: async (photo) => downloads.push(photo) },
    "../services/realtime.service": { emitOrdersChanged() {} },
  });
  await service.startPolling();
  const send = async (caption, extras = {}) => handlers.photo({
    chat: { id: -100, type: "supergroup" },
    message: { chat: { id: -100 }, message_id: 1, photo: [{ file_id: "small" }, { file_id: "large" }], caption, ...extras },
    reply: async () => {},
  });
  const sendText = async (text) => handlers.text({
    chat: { id: -100, type: "supergroup" },
    message: { chat: { id: -100 }, message_id: 1, text },
    reply: async () => {},
  });
  const receive = (type, message) => handlers[type]({
    chat: { id: -100, type: "supergroup" },
    message: { chat: { id: -100 }, date: 1700000000, is_topic_message: true, message_thread_id: 7, ...message },
  });
  return { send, sendText, receive, service, created, downloads, photos };
}

test("caption #req creates an order and keeps highest resolution photo", async () => {
  const f = await fixture();
  await f.send("#req 1523XXX, embassy");
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].serviceNumber, "1523XXX");
  assert.equal(f.created[0].message.caption, "#req 1523XXX, embassy");
  assert.equal(f.downloads[0].file_id, "large");
});

test("multiline #req keeps the full description in group text and photo captions", async () => {
  const description = "Mohon unbind UseeTV\n\n/unbind_iptv\n\nNo Tiket Nossa : INC123";
  const request = `#req 1523XXX,\u00a0 ${description}`;

  for (const sendMethod of ["sendText", "send"]) {
    const f = await fixture();
    await f[sendMethod](request);
    assert.equal(f.created.length, 1);
    assert.equal(f.created[0].orderType, "REQ");
    assert.equal(f.created[0].serviceNumber, "1523XXX");
    assert.equal(f.created[0].description, description);
  }
});

test("album members before/after caption attach to one order, including duplicate delivery", async () => {
  const f = await fixture();
  await f.send(undefined, { message_id: 1, media_group_id: "album" });
  assert.equal(f.created.length, 0);
  assert.equal(f.downloads.length, 0);
  await f.send("#req 123, test", { message_id: 2, media_group_id: "album" });
  await f.send(undefined, { message_id: 3, media_group_id: "album" });
  await f.send("#req 123, test", { message_id: 2, media_group_id: "album" });
  assert.equal(f.created.length, 1);
  assert.equal(f.photos.size, 3);
  assert.ok(f.downloads.some((item) => item.id === 1));
  assert.ok(f.downloads.some((item) => item.id === 3));
});

test("plain photo without order caption is ignored", async () => {
  const f = await fixture();
  await f.send("Dokumentasi");
  assert.equal(f.photos.size, 0);
  assert.equal(f.created.length, 0);
});

test("Telegram reply chain links outgoing anchors and earlier album members to one order", async () => {
  const anchors = new Map([[1, { order_id: 10, reply_to_message_id: 1 }]]);
  const rows = [];
  const f = await fixture("PENGAWALAN", true, {
    findParent: async ({ chatId, threadId, replyId }) => {
      assert.equal(chatId, -100);
      assert.equal(threadId, 7);
      return anchors.get(replyId);
    },
    recordReply: async (entry) => {
      rows.push(entry);
      anchors.set(entry.message.message_id, {
        order_id: entry.parent.order_id, reply_to_message_id: entry.message.message_id,
      });
    },
    recordOutgoing: async ({ orderId, messageIds, kind }) => {
      assert.equal(kind, "claim");
      for (const id of messageIds) anchors.set(id, { order_id: orderId, reply_to_message_id: id });
    },
  });
  const claim = f.service.notifyOrderClaim({
    order_id: 10, telegram_chat_id: -100, telegram_thread_id: 7, telegram_message_id: 1, user_name: "HD",
  });
  const reply = f.receive("text", { message_id: 5, text: "ralat", reply_to_message: { message_id: 4, text: "On progress" } });
  await Promise.all([claim, reply]);
  await f.receive("message", { message_id: 6, video: { file_id: "video" }, media_group_id: "album" });
  await f.receive("photo", {
    message_id: 7, photo: [{ file_id: "photo" }], media_group_id: "album", caption: "bukti",
    reply_to_message: { message_id: 5, text: "ralat" },
  });
  await f.receive("text", { message_id: 8, text: "obrolan biasa" });
  await f.receive("text", { message_id: 9, text: "balasan lain", reply_to_message: { message_id: 99 } });
  assert.deepEqual(rows.map((row) => row.message.message_id), [5, 7, 6]);
  assert.ok(rows.every((row) => row.parent.order_id === 10));
  assert.equal(rows[1].content, "bukti");
  assert.equal(rows[2].media.kind, "video");
  assert.equal(rows[2].excerpt, "ralat");
});

test("conversation media refuses unauthorized requests before file lookup", async () => {
  let lookup = false;
  const controller = load("src/controllers/order.controller.js", {
    "../services/order.service": { getOrderById: async () => { throw Object.assign(new Error("Tidak diizinkan"), { statusCode: 403 }); } },
    "../repositories/order-conversation.repository": { findMedia: async () => { lookup = true; } },
  });
  let status;
  await controller.getConversationMedia({ params: { id: "1", messageId: "2" }, user: { id: 5 } }, {
    status(code) { status = code; return this; }, json() {},
  });
  assert.equal(status, 403);
  assert.equal(lookup, false);
});

test("config caption creates CONFIG only in Logic groups", async () => {
  const f = await fixture("LOGIC");
  await f.send("/config\nTIKET: IN1\nNO SERVICE: 123\nKETERANGAN: cek");
  assert.equal(f.created[0].orderType, "CONFIG");
  const wrong = await fixture("LOGIC");
  await wrong.send("#req 123, cek");
  assert.equal(wrong.created.length, 0);
});

test("inactive groups cannot ingest caption photos", async () => {
  const f = await fixture("PENGAWALAN", false);
  await f.send("#req 123, cek");
  assert.equal(f.photos.size, 0);
});

test("source photo authorization runs before file lookup or download", async () => {
  let lookup = false;
  const controller = load("src/controllers/order.controller.js", {
    "../services/order.service": { getOrderById: async () => { throw Object.assign(new Error("Tidak diizinkan"), { statusCode: 403 }); } },
    "../repositories/order-source.repository": { find: async () => { lookup = true; } },
  });
  let status;
  await controller.getSourcePhoto({ params: { id: "1", photoId: "2" }, user: { id: 5 } }, {
    status(code) { status = code; return this; }, json() {},
  });
  assert.equal(status, 403);
  assert.equal(lookup, false);
});

test("source photo endpoint refuses a photo belonging to another order", async () => {
  let downloaded = false, status;
  const controller = load("src/controllers/order.controller.js", {
    "../services/order.service": { getOrderById: async () => ({ id: 1 }) },
    "../repositories/order-source.repository": { find: async (orderId, photoId) => {
      assert.equal(orderId, "1"); assert.equal(photoId, "2"); return null;
    } },
    "../services/telegram.service": { getSourcePhoto: async () => { downloaded = true; } },
  });
  await controller.getSourcePhoto({ params: { id: "1", photoId: "2" }, user: {} }, {
    status(code) { status = code; return this; }, json() {},
  });
  assert.equal(status, 404);
  assert.equal(downloaded, false);
});
