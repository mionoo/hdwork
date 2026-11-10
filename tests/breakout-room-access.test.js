const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function load(file, dependencies) {
  const context = { module: { exports: {} }, require: (name) => dependencies[name] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  return context.module.exports;
}

for (const role of ["HD", "ADMIN", "SUPER_ADMIN"]) {
  test(`room catalog enforces ${role} scope and excludes inactive, alarm and unmapped groups`, async () => {
    const calls = [];
    const repo = load("src/repositories/breakout.repository.js", {
      "../config/database": { query: async (sql, params) => {
        calls.push({ sql, params });
        return calls.length === 1 ? [[{ role, city_id: 4, is_active: 1 }]] : [[]];
      } },
    });
    await repo.list(18);
    const [, segments, rooms] = calls;
    assert.equal(segments.sql.includes("user_segments"), role === "HD");
    assert.equal(rooms.sql.includes("user_segments"), role === "HD");
    assert.equal(rooms.sql.includes("tg.city_id = ?"), role !== "SUPER_ADMIN");
    assert.equal(JSON.stringify(rooms.params), JSON.stringify(role === "HD" ? [18, 4] : role === "ADMIN" ? [4] : []));
    assert.match(rooms.sql, /tg\.is_active = 1/);
    assert.match(rooms.sql, /tg\.workflow IS NOT NULL/);
    assert.match(rooms.sql, /IN \('PENGAWALAN', 'LOGIC'\)/);
  });
}

test("room list validates group IDs and refuses inaccessible rooms before querying orders", async () => {
  const seen = [];
  const service = load("src/services/order.service.js", {
    "../repositories/breakout.repository": { list: async () => ({ rooms: [{ id: 12 }] }) },
    "../repositories/order.repository": {
      getUserSegmentIds: async () => [2],
      getAllOrders: async (filters) => { seen.push(filters); return []; },
    },
  });
  const user = { id: 18, role: "HD", city_id: 4 };
  await assert.rejects(service.getAllOrders({ telegram_group_id: ["12"] }, user), { statusCode: 400 });
  await assert.rejects(service.getAllOrders({ telegram_group_id: "13" }, user), { statusCode: 403 });
  assert.equal(seen.length, 0);
  await service.getAllOrders({ telegram_group_id: "12", city_id: 9 }, user);
  assert.equal(seen[0].telegram_group_id, 12);
  assert.equal(seen[0].city_id, 4);
  assert.deepEqual(seen[0].allowed_segment_ids, [2]);
});

test("multi-room orders require access to every selected group", async () => {
  const seen = [];
  const service = load("src/services/order.service.js", {
    "../repositories/breakout.repository": { list: async () => ({ rooms: [{ id: 12 }, { id: "14" }] }) },
    "../repositories/order.repository": {
      getUserSegmentIds: async () => [2],
      getAllOrders: async (filters) => { seen.push(filters); return []; },
    },
  });
  const user = { id: 18, role: "HD", city_id: 4 };

  for (const filter of ["", "12,", "0", "12,9007199254740992", ["12", "14"]]) {
    await assert.rejects(service.getAllOrders({ telegram_group_ids: filter }, user), { statusCode: 400 });
  }
  await assert.rejects(service.getAllOrders({ telegram_group_id: "12", telegram_group_ids: "14" }, user), { statusCode: 400 });
  await assert.rejects(service.getAllOrders({ telegram_group_ids: "12,13" }, user), { statusCode: 403 });
  assert.equal(seen.length, 0);

  await service.getAllOrders({ telegram_group_ids: "12,14,12", city_id: 9 }, user);
  assert.equal(JSON.stringify(seen[0].telegram_group_ids), "[12,14]");
  assert.equal(seen[0].city_id, 4);
  assert.deepEqual(seen[0].allowed_segment_ids, [2]);
});

test("multi-room query binds group IDs and excludes unavailable groups", async () => {
  const repo = load("src/repositories/order.repository.js", {
    "../config/telegram": require("../src/config/telegram"),
    "../config/database": { query: async (sql, params) => {
      assert.match(sql, /tg\.id IN \(\?,\?\) AND tg\.is_active = 1 AND tg\.archived_at IS NULL/);
      assert.equal(JSON.stringify(params), "[12,14,4,2]");
      return [[]];
    } },
  });
  await repo.getAllOrders({ telegram_group_ids: [12, 14], city_id: 4, allowed_segment_ids: [2] });
});
