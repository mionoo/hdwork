const router=require("express").Router(); const auth=require("../middlewares/auth.middleware"); const controller=require("../controllers/group.controller");
router.use(auth);
router.get("/rooms", controller.rooms);
router.get("/options", controller.options);
router.get("/", controller.list);
router.patch("/:id/archive", controller.archive);
router.patch("/:id/restore", controller.restore);
router.patch("/:id", controller.update);
module.exports = router;
