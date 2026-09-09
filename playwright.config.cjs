const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:41741', serviceWorkers: 'block', ...(process.env.SEVER_BROWSER_CHANNEL ? { channel: process.env.SEVER_BROWSER_CHANNEL } : {}) },
  webServer: { command: 'node tests/browser/server.cjs', port: 41741, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'phone-320', use: { viewport: { width: 320, height: 568 } } },
    { name: 'phone-360', use: { viewport: { width: 360, height: 800 } } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
