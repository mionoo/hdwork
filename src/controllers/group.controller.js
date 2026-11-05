const groups=require("../repositories/group.repository");
const breakout=require("../repositories/breakout.repository");
const fail=(res,error)=>res.status(error.statusCode||500).json({success:false,message:error.message||"Gagal memproses grup"});
exports.list=async(req,res)=>{try{res.json({success:true,data:await groups.list(req.user.id,req.query.city_id,req.query.archived==="1")})}catch(error){fail(res,error)}};
exports.rooms=async(req,res)=>{try{res.json({success:true,data:await breakout.list(req.user.id)})}catch(error){fail(res,error)}};
exports.options=async(req,res)=>{try{res.json({success:true,data:await groups.options(req.user.id)})}catch(error){fail(res,error)}};
exports.update=async(req,res)=>{try{await groups.update(req.user.id,req.params.id,req.body);res.json({success:true})}catch(error){fail(res,error)}};
exports.archive=async(req,res)=>{try{await groups.setArchived(req.user.id,req.params.id,true);res.json({success:true})}catch(error){fail(res,error)}};
exports.restore=async(req,res)=>{try{await groups.setArchived(req.user.id,req.params.id,false);res.json({success:true})}catch(error){fail(res,error)}};
