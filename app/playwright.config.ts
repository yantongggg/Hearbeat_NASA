import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build (what gets deployed), served by `vite preview`.
 * GitHub's shared runners draw the WebGL globe in software on two cores and are about eight times slower
 * than a laptop, so on CI the time limits are longer and a failed test is retried once. Tests that measure
 * real-time audio levels are skipped there (see `realtimeAudio` in e2e/helpers.ts) and run locally.
 * A test run is silent: nothing is spoken or played on the machine it runs on.
 */
const CI = !!process.env.CI;
export default defineConfig({
  testDir: 'e2e',
  timeout: CI ? 240_000 : 60_000,
  expect: { timeout: CI ? 40_000 : 10_000 },
  retries: CI ? 1 : 0,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // --mute-audio: the app's audio is rendered but not played on this machine (speech is silenced in e2e/helpers.ts)
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] }
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 700 } }, testMatch: /layout\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /layout\.spec|mobile\.spec/ }
  ]
});
