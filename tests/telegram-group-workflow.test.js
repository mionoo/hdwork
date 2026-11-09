const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function load(file, dependencies, env = {}) {
  const context = { module: { exports: {} }, require: (name) => dependencies[name] || (name === "./telegram-transport" ? require("../src/services/telegram-transport") : name.startsWith("node:") ? require(name) : {}), process: { env }, console, setTimeout, clearTimeout, AbortController, AbortSignal };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  return context.module.exports;
}

async function botFixture(admin = true) {
  const actions = [], saves = [], edits = [];
  const service = load("src/services/telegram.service.js", {
    telegraf: {
      Markup: { inlineKeyboard: (rows) => ({ rows }), button: { callback: (text, data) => ({ text, data }) } },
      Telegraf: class {
        constructor() {
          this.telegram = { callApi: async () => ({}), getChatMember: async () => ({ status: admin ? "administrator" : "member" }) };
        }
        action(pattern, handler) { actions.push({ pattern, handler }); }
        command() {} on() {} catch() {} use() {} async startPolling() {}
      },
    },
    "../repositories/telegram.repository": {
      saveGroup: async (data) => saves.push(data),
      getCities: async () => [{ id: 1, name: "Surabaya" }],
      getSegments: async () => [{ id: 3, code: "REPLACE_ONT" }],
    },
  }, { TELEGRAM_BOT_TOKEN: "test-only" });
  await service.startPolling();
  return { saves, edits, click: async (data) => {
    const action = actions.find(({ pattern }) => pattern.test(data));
    assert.ok(action, data);
    await action.handler({
      match: data.match(action.pattern),
      from: { id: 7 },
      callbackQuery: { message: { chat: { id: -100, title: "Replacement", type: "supergroup" }, is_topic_message: true, message_thread_id: 9 } },
      editMessageText: async (text, markup) => edits.push({ text, markup }),
      answerCbQuery: async () => {},
    });
  } };
}

test("setgrup walks segment → workflow → type, and preserves chat/topic with selected flow", async () => {
  const f = await botFixture();
  await f.click("setgroup:segment:1:3");
  assert.match(f.edits.at(-1).text, /3\/4/);
  const button = f.edits.at(-1).markup.rows[0][1];
  assert.equal(button.text, "Provisioning");
  await f.click(button.data);
  assert.match(f.edits.at(-1).text, /4\/4/);
  const type = f.edits.at(-1).markup.rows[0][0];
  assert.ok(Buffer.byteLength(type.data) <= 64);
  await f.click(type.data);
  assert.equal(f.saves[0].workflow, "PROVISIONING");
  assert.equal(f.saves[0].category, "PENGAWALAN");
  assert.equal(f.saves[0].threadId, 9);
  assert.equal(f.saves[0].chatId, -100);
  assert.match(f.edits.at(-1).text, /Alur kerja: Provisioning/);
});

test("legacy keyboard asks for workflow rather than saving incomplete data", async () => {
  const f = await botFixture();
  await f.click("setgroup:category:1:3:LOGIC");
  assert.equal(f.saves.length, 0);
  assert.match(f.edits.at(-1).text, /Pilih alur kerja/);
});

test("non-admin cannot save a group through callback", async () => {
  const f = await botFixture(false);
  await f.click("setgroup:type:1:3:A:LOGIC");
  assert.equal(f.saves.length, 0);
});

for (const existing of [null, { id: 8, category: "LOGIC" }]) {
  test(`repository persists workflow for ${existing ? "existing" : "new"} group`, async () => {
    const calls = [];
    const connection = {
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
      query: async (sql, params) => {
        calls.push({ sql, params });
        return calls.length === 1 ? [[...(existing ? [existing] : [])]] : [{ affectedRows: 1 }];
      },
    };
    const repo = load("src/repositories/telegram.repository.js", {
      "../config/database": { getConnection: async () => connection },
    });
    const data = { chatId: -100, threadId: 9, name: "Group", cityId: 1, segmentId: 3, category: "LOGIC", workflow: "ASSURANCE" };
    await repo.saveGroup(data);
    assert.match(calls[1].sql, /workflow/);
    assert.ok(calls[1].params.includes("ASSURANCE"));
    await assert.rejects(repo.saveGroup({ ...data, workflow: null }), { statusCode: 400 });
  });
}
