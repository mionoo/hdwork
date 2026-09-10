const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const TEST_KEY = "test-cacti-collector-key";

test("Cacti collector route rejects missing and invalid keys, then passes a valid key to its controller", async (t) => {
  const previousKey = process.env.CACTI_COLLECTOR_API_KEY;
  process.env.CACTI_COLLECTOR_API_KEY = TEST_KEY;

  const cactiController = require("../src/controllers/cacti.controller");
  const originalReceiveCacti = cactiController.receiveCacti;
  let controllerCalls = 0;
  cactiController.receiveCacti = (req, res) => {
    controllerCalls += 1;
    res.status(200).json({ success: true, controller_reached: true });
  };

  delete require.cache[require.resolve("../src/routes/cacty.routes")];
  const cactiRoutes = require("../src/routes/cacty.routes");
  const app = express();
  app.use(express.json());
  app.use("/api/cactys", cactiRoutes);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    cactiController.receiveCacti = originalReceiveCacti;
    delete require.cache[require.resolve("../src/routes/cacty.routes")];
    if (previousKey === undefined) delete process.env.CACTI_COLLECTOR_API_KEY;
    else process.env.CACTI_COLLECTOR_API_KEY = previousKey;
  });

  const url = `http://127.0.0.1:${server.address().port}/api/cactys/cacti`;

  const missingKey = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(missingKey.status, 401);

  const invalidKey = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Collector-Key": "wrong-key" }, body: "{}" });
  assert.equal(invalidKey.status, 403);

  const validKey = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Collector-Key": TEST_KEY }, body: "{}" });
  assert.equal(validKey.status, 200);
  assert.deepEqual(await validKey.json(), { success: true, controller_reached: true });
  assert.equal(controllerCalls, 1);
});
