const groups=require("../repositories/group.repository");
const fail=(res,error)=>res.status(error.statusCode||500).json({success:false,message:error.message||"Gagal memproses grup"});
exports.list=async(req,res)=>{try{res.json({success:true,data:await groups.list(req.user.id,req.query.city_id)})}catch(error){fail(res,error)}};
exports.options=async(req,res)=>{try{res.json({success:true,data:await groups.options(req.user.id)})}catch(error){fail(res,error)}};
exports.update=async(req,res)=>{try{await groups.update(req.user.id,req.params.id,req.body);res.json({success:true})}catch(error){fail(res,error)}};
exports.remove=async(req,res)=>{try{await groups.remove(req.user.id,req.params.id);res.json({success:true})}catch(error){fail(res,error)}};
