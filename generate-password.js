const bcrypt = require("bcrypt");

async function generate() {
  const password = "budi";

  const hash = await bcrypt.hash(password, 10);

  console.log(hash);
}

generate();