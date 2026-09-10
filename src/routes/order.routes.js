const express = require("express");
const orderController = require("../controllers/order.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", orderController.getAllOrders);
router.get("/:id/detail", orderController.getOrderDetail);
router.get("/:id/reassign-targets", orderController.getReassignTargets);
router.get("/:id", orderController.getOrderById);

router.post("/:id/claim", orderController.claimOrder);
router.post("/:id/reassign", orderController.reassignOrder);
router.post("/:id/escalate", orderController.escalateOrder);
router.post("/:id/results", upload.array("files", 10), orderController.sendResult);
router.post("/:id/complete", upload.array("files", 10), orderController.completeOrder);

module.exports = router;
