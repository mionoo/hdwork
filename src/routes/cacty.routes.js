const express = require("express");

const {
  receiveCacti
} = require("../controllers/cacti.controller");
const verifyCactiCollector = require("../middlewares/cactiCollector.middleware");

const router = express.Router();

router.post("/cacti", verifyCactiCollector, receiveCacti);

module.exports = router;
