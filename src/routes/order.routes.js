const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const orderController = require("../controllers/order.controller");
const authMiddleware = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

const router = express.Router();
const replyUploadDirectory = path.resolve(__dirname, "../../storage/order-source/reply-upload");
fs.mkdirSync(replyUploadDirectory, { recursive: true, mode: 0o700 });
const replyUpload = multer({
  dest: replyUploadDirectory,
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16 * 1024 },
});

router.use(authMiddleware);

router.get("/", orderController.getAllOrders);
router.get("/:id/source-photos/:photoId", orderController.getSourcePhoto);
router.get("/:id/conversation-media/:messageId", orderController.getConversationMedia);
router.get("/:id/conversation-deliveries/:deliveryId", orderController.getConversationReplyDelivery);
router.get("/:id/detail", orderController.getOrderDetail);
router.get("/:id/reassign-targets", orderController.getReassignTargets);
router.get("/:id", orderController.getOrderById);

router.post("/:id/claim", orderController.claimOrder);
router.post("/:id/conversation/:messageId/reply", replyUpload.single("file"), orderController.replyToConversation);
router.post("/:id/conversation/read", orderController.markConversationRead);
router.post("/:id/reassign", orderController.reassignOrder);
router.post("/:id/escalate", orderController.escalateOrder);
router.post("/:id/results", upload.array("files", 10), orderController.sendResult);
router.post("/:id/complete", upload.array("files", 10), orderController.completeOrder);

module.exports = router;
