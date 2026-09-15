const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config.cjs');
module.exports = defineConfig({
  ...base,
  testMatch: /ios-push-guide\.spec\.cjs/,
  projects: ['chromium', 'webkit'].map(browserName => ({
    name: browserName + '-iphone-layout',
    use: { browserName, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  }))
});
