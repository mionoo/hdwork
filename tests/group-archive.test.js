const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function repository(name, pool) {
  const sandbox = { module: { exports: {} }, require: () => pool };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/repositories", name + ".repository.js"), "utf8"), sandbox);
  return sandbox.module.exports;
}

test("ordinary admin cannot list the archive, archive or restore a group", async () => {
  let queries = 0;
  const groups = repository("group", {
    query: async () => { queries++; return [[{ role: "ADMIN", is_active: 1, city_id: 3 }]]; },
  });
  await assert.rejects(groups.list(4, null, true), { statusCode: 403 });
  await assert.rejects(groups.setArchived(4, 8, true), { statusCode: 403 });
  await assert.rejects(groups.setArchived(4, 8, false), { statusCode: 403 });
  assert.equal(queries, 3);
});

test("default group list keeps inactive groups and filters out only archives", async () => {
  const row = { id: 8, is_active: 0, order_count: 3 };
  const groups = repository("group", {
    query: async (sql) => {
      if (sql.includes("FROM users")) return [[{ role: "SUPER_ADMIN", is_active: 1 }]];
      assert.match(sql, /WHERE tg\.archived_at IS NULL/);
      assert.doesNotMatch(sql, /tg\.is_active\s*=\s*1/);
      return [[row]];
    },
  });
  const [result] = await groups.list(1);
  assert.equal(result.id, 8);
  assert.equal(result.is_active, false);
  assert.equal(result.order_count, 3);
});

test("archive and restore update only group state and restore as inactive", async () => {
  const writes = [];
  const groups = repository("group", {
    query: async (sql, args) => {
      if (sql.includes("FROM users")) return [[{ role: "SUPER_ADMIN", is_active: 1 }]];
      writes.push({ sql, id: args[0] });
      return [{ affectedRows: 1 }];
    },
  });
  await groups.setArchived(1, 8, true);
  await groups.setArchived(1, 8, false);
  assert.match(writes[0].sql, /archived_at = COALESCE\(archived_at, CURRENT_TIMESTAMP\)/);
  assert.match(writes[1].sql, /archived_at = NULL/);
  for (const { sql, id } of writes) {
    assert.match(sql, /^UPDATE telegram_groups/);
    assert.match(sql, /is_active = 0/);
    assert.equal(id, 8);
  }
});

test("Telegram setup cannot reactivate an archived group", async () => {
  let rollback = false;
  let queries = 0;
  const groups = repository("telegram", { getConnection: async () => ({
    beginTransaction: async () => {},
    query: async () => { queries++; return [[{ id: 8, category: "LOGIC", archived_at: "2026-11-05" }]]; },
    rollback: async () => { rollback = true; },
    release() {},
  }) });
  await assert.rejects(groups.saveGroup({ chatId: -100, threadId: 1, workflow: "ASSURANCE" }), { statusCode: 409 });
  assert.equal(rollback, true);
  assert.equal(queries, 1);
});
