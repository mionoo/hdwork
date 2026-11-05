const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(file, dependencies) {
  const sandbox = { module: { exports: {} }, console, setTimeout, process: { env: { TELEGRAM_BOT_TOKEN: "test-only" } }, require: (name) => dependencies[name] || {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox);
  return sandbox.module.exports;
}

async function fixture(category = "PENGAWALAN", active = true) {
  const handlers = {}, created = [], photos = new Map(), downloads = [];
  let order = null;
  const service = load("src/services/telegram.service.js", {
    telegraf: { Telegraf: class {
      constructor() { this.telegram = {}; } command() {} action() {} catch() {}
      on(type, handler) { handlers[type] = handler; } async launch() {}
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
    "./order-source-photo.service": { ensurePhoto: async (photo) => downloads.push(photo) },
    "../services/realtime.service": { emitOrdersChanged() {} },
  });
  await service.startPolling();
  const send = async (caption, extras = {}) => handlers.photo({
    chat: { id: -100, type: "supergroup" },
    message: { chat: { id: -100 }, message_id: 1, photo: [{ file_id: "small" }, { file_id: "large" }], caption, ...extras },
    reply: async () => {},
  });
  return { send, created, downloads, photos };
}

test("caption #req creates an order and keeps highest resolution photo", async () => {
  const f = await fixture();
  await f.send("#req 1523XXX, embassy");
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].serviceNumber, "1523XXX");
  assert.equal(f.created[0].message.caption, "#req 1523XXX, embassy");
  assert.equal(f.downloads[0].file_id, "large");
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
