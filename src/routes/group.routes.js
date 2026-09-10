const router=require("express").Router(); const auth=require("../middlewares/auth.middleware"); const controller=require("../controllers/group.controller");
router.use(auth); router.get("/options",controller.options); router.get("/",controller.list); router.patch("/:id",controller.update); router.delete("/:id",controller.remove); module.exports=router;
