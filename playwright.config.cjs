const { defineConfig } = require('@playwright/test');
const { port, baseURL } = require('./tests/browser/test-server-config.cjs');
module.exports = defineConfig({
  testDir: './tests/browser', timeout: 30000,
  use: { baseURL, serviceWorkers: 'block', ...(process.env.SEVER_BROWSER_CHANNEL ? { channel: process.env.SEVER_BROWSER_CHANNEL } : {}) },
  // Never silently test an unrelated checkout already listening on this port.
  webServer: { command: 'node tests/browser/server.cjs', port, reuseExistingServer: false },
  projects: [
    { name: 'phone-320', use: { viewport: { width: 320, height: 568 } } },
    { name: 'phone-360', use: { viewport: { width: 360, height: 800 } } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
