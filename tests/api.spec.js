// Builder tests for the todos API edges the acceptance tests do not cover.
import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TODOS_FILE = process.env.TODOS_FILE;

test.beforeEach(async () => {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, '[]');
});

test('unsupported method returns 405 with an allow header', async ({ request }) => {
  const res = await request.delete('/api/todos');
  expect(res.status()).toBe(405);
  expect(res.headers()['allow']).toBe('GET, POST');
});

// A Buffer is sent as-is; a string with a JSON content-type would be re-encoded by Playwright.
for (const [label, raw] of [
  ['malformed JSON', '{not json'],
  ['a bare JSON string', '"Buy milk"'],
  ['a JSON array', '["Buy milk"]'],
  ['JSON null', 'null'],
]) {
  test(`POST with ${label} returns 400 Invalid JSON and stores nothing`, async ({ request }) => {
    const res = await request.post('/api/todos', {
      headers: { 'content-type': 'application/json' },
      data: Buffer.from(raw),
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
    expect(await (await request.get('/api/todos')).json()).toEqual([]);
  });
}

test('a body over 10 KB returns 413 and stores nothing', async ({ request }) => {
  const res = await request.post('/api/todos', { data: { text: 'x'.repeat(11 * 1024) } });
  expect(res.status()).toBe(413);
  expect(await (await request.get('/api/todos')).json()).toEqual([]);
});

test('a corrupt storage file returns 500 and is not overwritten', async ({ request }) => {
  await writeFile(TODOS_FILE, '{corrupt');
  expect((await request.get('/api/todos')).status()).toBe(500);
  expect((await request.post('/api/todos', { data: { text: 'Buy milk' } })).status()).toBe(500);
  expect(await readFile(TODOS_FILE, 'utf8')).toBe('{corrupt');
});

test('concurrent POSTs keep every todo', async ({ request }) => {
  const texts = Array.from({ length: 10 }, (_, i) => `Todo ${i}`);
  const results = await Promise.all(texts.map((text) => request.post('/api/todos', { data: { text } })));
  expect(results.map((r) => r.status())).toEqual(texts.map(() => 201));
  const stored = await (await request.get('/api/todos')).json();
  expect(stored.map((t) => t.text).sort()).toEqual([...texts].sort());
});

test('a missing storage file is an empty list and is created on first add', async ({ request }) => {
  const { rm } = await import('node:fs/promises');
  await rm(TODOS_FILE, { force: true });
  expect(await (await request.get('/api/todos')).json()).toEqual([]);
  await request.post('/api/todos', { data: { text: 'Buy milk' } });
  expect(JSON.parse(await readFile(TODOS_FILE, 'utf8')).map((t) => t.text)).toEqual(['Buy milk']);
});

test('todo text is rendered as text, not HTML', async ({ page }) => {
  await page.request.post('/api/todos', { data: { text: '<img src=x onerror="window.pwned=1">' } });
  await page.goto('/');
  const list = page.getByRole('list', { name: 'Todos' });
  await expect(list.getByRole('listitem')).toHaveText(['<img src=x onerror="window.pwned=1">']);
  await expect(list.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});
