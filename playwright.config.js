// Автотести Playwright на емуляції планшетів.
//
//   npx playwright test                       усі тести (iPad-WebKit і Android-Chromium)
//   npx playwright test --project=iPad-WebKit лише iPad
//   PQ_BASE_URL=https://boikoschool.github.io/python-quest/ npx playwright test
//                                             ті самі тести проти живого сайту

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const liveURL = process.env.PQ_BASE_URL;

export default defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: liveURL ?? `http://localhost:${PORT}/python-quest/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iPad-WebKit', use: { ...devices['iPad (gen 7)'] } },
    { name: 'Android-Chromium', use: { ...devices['Galaxy Tab S4'] } },
  ],
  webServer: liveURL
    ? undefined
    : {
        command: `node tests/server.mjs ${PORT}`,
        url: `http://localhost:${PORT}/python-quest/`,
        reuseExistingServer: !process.env.CI,
      },
});
