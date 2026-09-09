// Keep standalone scripts, persistent contexts and Playwright on the same origin.
const port = Number(process.env.SEVER_E2E_PORT || 41741);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SEVER_E2E_PORT must be an integer between 1 and 65535');
}
module.exports = { port, baseURL: `http://127.0.0.1:${port}` };
