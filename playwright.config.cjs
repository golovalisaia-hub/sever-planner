const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', timeout: 30000,
  // Opt-in escape hatch for sandboxes that ship a preinstalled Chromium of a
  // different build than this Playwright version downloads. Unset in CI.
  use: {
    baseURL: 'http://127.0.0.1:41741', serviceWorkers: 'block',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {})
  },
  webServer: { command: 'node tests/browser/server.cjs', port: 41741, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'phone-320', use: { viewport: { width: 320, height: 568 } } },
    { name: 'phone-360', use: { viewport: { width: 360, height: 800 } } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
