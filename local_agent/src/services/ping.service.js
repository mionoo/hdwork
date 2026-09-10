const { execFile } = require("child_process");

function pingHost(host) {
  return new Promise((resolve) => {
    execFile(
      "ping",
      ["-c", "1", host],
      { timeout: 5000 },
      (error, stdout, stderr) => {
        if (error) {
          return resolve({
            success: false,
            reachable: false,
            host,
            message: stderr || error.message,
          });
        }

        resolve({
          success: true,
          reachable: true,
          host,
          output: stdout,
        });
      }
    );
  });
}

module.exports = {
  pingHost,
};