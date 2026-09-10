const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const userController = require("../controllers/user.controller");

const router = express.Router();
router.use(authMiddleware);
router.get("/options", userController.getOptions);
router.get("/", userController.listUsers);
router.post("/", userController.createUser);
router.patch("/:id", userController.updateUser);
router.post("/:id/reset-password", userController.resetPassword);

module.exports = router;
