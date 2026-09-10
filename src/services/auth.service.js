const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authRepository = require("../repositories/auth.repository");

async function login(username, password) {
  const user = await authRepository.findUserByUsername(username);

  if (!user) {
    const error = new Error("Username atau password salah");
    error.statusCode = 401;
    throw error;
  }

  if (!user.is_active) {
    const error = new Error("User tidak aktif");
    error.statusCode = 403;
    throw error;
  }

  const passwordValid = await bcrypt.compare(
    password,
    user.password_hash,
  );

  if (!passwordValid) {
    const error = new Error("Username atau password salah");
    error.statusCode = 401;
    throw error;
  }

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      city_id: user.city_id,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "8h",
    },
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      city_id: user.city_id,
    },
  };
}

module.exports = {
  login,
};