import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Load playwright.config.js in a fresh process with a controlled environment and
// return the storage file the web server is told to use.
function configuredFile(env: Record<string, string>): string {
  const clean = { ...process.env };
  delete clean.TODOS_FILE;
  delete clean.PORT;
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      "import('./playwright.config.js').then(m=>console.log(JSON.stringify({server:m.default.webServer.env.TODOS_FILE,proc:process.env.TODOS_FILE})))",
    ],
    { env: { ...clean, ...env }, cwd: process.cwd(), encoding: 'utf8' },
  );
  const parsed = JSON.parse(out.trim().split('\n').pop()!);
  expect(parsed.proc).toBe(parsed.server);
  return parsed.server;
}

test('AC-6: default storage file differs per PORT', () => {
  const a = configuredFile({ PORT: '3101' });
  const b = configuredFile({ PORT: '3102' });
  expect(a).toBe(path.join(os.tmpdir(), 'todo-app-test-3101', 'todos.json'));
  expect(b).toBe(path.join(os.tmpdir(), 'todo-app-test-3102', 'todos.json'));
  expect(a).not.toBe(b);
});

test('AC-6: default storage file uses port 3000 when PORT is unset', () => {
  expect(configuredFile({})).toBe(
    path.join(os.tmpdir(), 'todo-app-test-3000', 'todos.json'),
  );
});

test('AC-6: an explicit TODOS_FILE still wins', () => {
  const custom = path.join(os.tmpdir(), 'custom-x', 'my.json');
  expect(configuredFile({ PORT: '3101', TODOS_FILE: custom })).toBe(custom);
});
