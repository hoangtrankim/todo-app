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
  await expect(list.locator('.todo-text')).toHaveText(['<img src=x onerror="window.pwned=1">']);
  // The Delete button's accessible name carries the text too, as an attribute.
  await expect(list.getByRole('button', { name: 'Delete <img src=x onerror="window.pwned=1">' })).toHaveCount(1);
  await expect(list.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => /** @type {any} */ (globalThis).pwned)).toBeUndefined();
});

test('a storage file that is not an array returns 500 and is not overwritten', async ({ request }) => {
  await writeFile(TODOS_FILE, '{"a":1}');
  expect((await request.get('/api/todos')).status()).toBe(500);
  expect((await request.patch('/api/todos/a', { data: { done: true } })).status()).toBe(500);
  expect(await readFile(TODOS_FILE, 'utf8')).toBe('{"a":1}');
});

test('PATCH finds an id that needs URL encoding', async ({ request }) => {
  await writeFile(TODOS_FILE, JSON.stringify([{ id: 'a b/c', text: 'Buy milk', done: false }]));
  const res = await request.patch(`/api/todos/${encodeURIComponent('a b/c')}`, { data: { done: true } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ id: 'a b/c', text: 'Buy milk', done: true });
});

test('PATCH with a malformed percent-encoded id returns 404 and writes nothing', async ({ request }) => {
  await writeFile(TODOS_FILE, '[]');
  const res = await request.patch('/api/todos/%E0%A4%A', { data: { done: true } });
  expect(res.status()).toBe(404);
  expect(await readFile(TODOS_FILE, 'utf8')).toBe('[]');
});

test('a PATCH body over 10 KB returns 413 and writes nothing', async ({ request }) => {
  const seed = JSON.stringify([{ id: 'a', text: 'Buy milk', done: false }]);
  await writeFile(TODOS_FILE, seed);
  const res = await request.patch('/api/todos/a', { data: { done: true, pad: 'x'.repeat(11 * 1024) } });
  expect(res.status()).toBe(413);
  expect(await readFile(TODOS_FILE, 'utf8')).toBe(seed);
});

test('concurrent PATCHes on different todos keep every change', async ({ request }) => {
  const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
  await writeFile(TODOS_FILE, JSON.stringify(ids.map((id) => ({ id, text: id, done: false }))));
  const results = await Promise.all(ids.map((id) => request.patch(`/api/todos/${id}`, { data: { done: true } })));
  expect(results.map((r) => r.status())).toEqual(ids.map(() => 200));
  const stored = await (await request.get('/api/todos')).json();
  expect(stored.map((t) => t.done)).toEqual(ids.map(() => true));
});

test('/api itself and nested unknown API paths return 404 JSON', async ({ request }) => {
  for (const url of ['/api', '/api/', '/api/todos/a/extra']) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(404);
    expect(await res.json(), url).toEqual({ error: 'Not found' });
  }
});

test('a rejected PATCH fetch puts the checkbox back and shows the error', async ({ page }) => {
  await writeFile(TODOS_FILE, JSON.stringify([{ id: 'a', text: 'Buy milk', done: false }]));
  await page.route('**/api/todos/*', (route) =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Buy milk' }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not update todo');
  await expect(page.getByRole('checkbox', { name: 'Buy milk' })).not.toBeChecked();
});

test('a rejected add fetch shows "Could not add todo" and keeps the input', async ({ page }) => {
  await page.route('**/api/todos', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await page.goto('/');
  await page.getByLabel('New todo').fill('Buy milk');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not add todo');
  await expect(page.getByLabel('New todo')).toHaveValue('Buy milk');
});

test('DELETE finds an id that needs URL encoding', async ({ request }) => {
  await writeFile(TODOS_FILE, JSON.stringify([{ id: 'a b/c', text: 'Buy milk', done: false }]));
  const res = await request.delete(`/api/todos/${encodeURIComponent('a b/c')}`);
  expect(res.status()).toBe(204);
  expect(JSON.parse(await readFile(TODOS_FILE, 'utf8'))).toEqual([]);
});

test('DELETE with a malformed percent-encoded id returns 404 and writes nothing', async ({ request }) => {
  await writeFile(TODOS_FILE, '[]');
  const res = await request.delete('/api/todos/%E0%A4%A');
  expect(res.status()).toBe(404);
  expect(await readFile(TODOS_FILE, 'utf8')).toBe('[]');
});

test('PATCH and DELETE skip null entries in the storage file', async ({ request }) => {
  await writeFile(TODOS_FILE, JSON.stringify([null, { id: 'a', text: 'Buy milk', done: false }]));
  expect((await request.patch('/api/todos/a', { data: { done: true } })).status()).toBe(200);
  expect((await request.delete('/api/todos/a')).status()).toBe(204);
  expect(JSON.parse(await readFile(TODOS_FILE, 'utf8'))).toEqual([null]);
});

test('concurrent DELETEs and a POST keep every other change', async ({ request }) => {
  const ids = Array.from({ length: 6 }, (_, i) => `t${i}`);
  await writeFile(TODOS_FILE, JSON.stringify(ids.map((id) => ({ id, text: id, done: false }))));
  const results = await Promise.all([
    ...['t1', 't3', 't5'].map((id) => request.delete(`/api/todos/${id}`)),
    request.post('/api/todos', { data: { text: 'new' } }),
  ]);
  expect(results.map((r) => r.status())).toEqual([204, 204, 204, 201]);
  const stored = await (await request.get('/api/todos')).json();
  expect(stored.map((t) => t.text)).toEqual(['t0', 't2', 't4', 'new']);
});

test('after a delete, focus moves to the next Delete button, or the input when none remain', async ({ page }) => {
  await writeFile(
    TODOS_FILE,
    JSON.stringify([
      { id: 'a', text: 'Buy milk', done: false },
      { id: 'b', text: 'Walk dog', done: false },
    ]),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Delete Buy milk' }).click();
  await expect(page.getByRole('button', { name: 'Delete Walk dog' })).toBeFocused();
  await page.getByRole('button', { name: 'Delete Walk dog' }).click();
  await expect(page.getByLabel('New todo')).toBeFocused();
});

test("after toggling, focus stays on the todo's checkbox", async ({ page }) => {
  await writeFile(TODOS_FILE, JSON.stringify([{ id: 'a', text: 'Buy milk', done: false }]));
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Buy milk' }).click();
  await expect(page.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Buy milk' })).toBeFocused();
});

test('an array entry in the storage file is hidden from GET and kept by PATCH and DELETE', async ({ request }) => {
  const a = { id: 'a', text: 'A', done: false };
  const b = { id: 'b', text: 'B', done: false };
  await writeFile(TODOS_FILE, JSON.stringify([a, [1], b]));
  expect(await (await request.get('/api/todos')).json()).toEqual([a, b]);
  expect(JSON.parse(await readFile(TODOS_FILE, 'utf8'))).toEqual([a, [1], b]);

  expect((await request.patch('/api/todos/b', { data: { done: true } })).status()).toBe(200);
  expect(JSON.parse(await readFile(TODOS_FILE, 'utf8'))).toEqual([a, [1], { ...b, done: true }]);

  expect((await request.delete('/api/todos/b')).status()).toBe(204);
  expect(JSON.parse(await readFile(TODOS_FILE, 'utf8'))).toEqual([a, [1]]);
});
