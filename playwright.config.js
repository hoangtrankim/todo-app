import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const port = Number(process.env.PORT ?? 3000);

// Tests use their own storage file, never the real data/todos.json. Setting it on
// process.env here also makes it visible to the test files, which reset it per test.
process.env.TODOS_FILE ??= path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

export default defineConfig({
  testDir: 'tests',
  // One server and one storage file are shared by all tests, so run them serially.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.js',
    port,
    env: { PORT: String(port), TODOS_FILE: process.env.TODOS_FILE },
    reuseExistingServer: !process.env.CI,
  },
});
