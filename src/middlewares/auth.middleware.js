const jwt = require("jsonwebtoken");

// function authMiddleware(req, res, next) {
//   try {
//     const authHeader = req.headers.authorization;

//     if (!authHeader) {
//       return res.status(401).json({
//         success: false,
//         message: "Token tidak ditemukan",
//       });
//     }

//     const parts = authHeader.split(" ");

//     if (parts.length !== 2 || parts[0] !== "Bearer") {
//       return res.status(401).json({
//         success: false,
//         message: "Format token tidak valid",
//       });
//     }

//     const token = parts[1];

//     const decoded = jwt.verify(
//       token,
//       process.env.JWT_SECRET,
//     );

//     req.user = decoded;

//     next();
//   } catch (error) {
//     return res.status(401).json({
//       success: false,
//       message: "Token tidak valid atau sudah expired",
//     });
//   }
// }



// const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  //console.log("🔥 AUTH MIDDLEWARE MASUK");
  //console.log("Authorization:", req.headers.authorization);

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      console.log("❌ TOKEN TIDAK ADA");

      return res.status(401).json({
        success: false,
        message: "Token tidak ditemukan",
      });
    }

    const parts = authHeader.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({
        success: false,
        message: "Format token tidak valid",
      });
    }

    const token = parts[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
    );

    //console.log("✅ TOKEN VALID:", decoded);

    req.user = decoded;

    next();
  } catch (error) {
    //console.log("❌ AUTH ERROR:", error.message);

    return res.status(401).json({
      success: false,
      message: "Token tidak valid atau sudah expired",
    });
  }
}

// module.exports = authMiddleware;

module.exports = authMiddleware;