import { defineConfig } from '@playwright/test'
import { PANEL, AUTH_STATE } from './env.js'

// UI tests for a running dev instance (start-puffer-upstream.py ... --watch): every section, tab and action.
// Console problems are collected per section (global-teardown.js prints the report); a test only fails when the flow
// itself breaks. The files run in order (01-..., 02-...) because later sections use what earlier ones created.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.js',
  globalTeardown: './global-teardown.js',
  outputDir: './test-results/artifacts',
  reporter: [['list']],
  use: {
    baseURL: PANEL,
    storageState: AUTH_STATE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // milliseconds between browser actions, so a headed run can be followed (yarn test:headed sets it)
    launchOptions: { slowMo: Number(process.env.SLOWMO || 0) }
  }
})
