import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

async function seedRaw(content: string) {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, content);
}

test.beforeEach(async () => {
  await seedRaw('[]');
});

const fileTodos = async () => JSON.parse(await readFile(TODOS_FILE, 'utf8'));

test('AC-1: text/plain POST is refused with 415 and writes nothing', async ({ request }) => {
  const res = await request.post('/api/todos', {
    headers: { 'content-type': 'text/plain' },
    data: Buffer.from('{"text":"x"}'),
  });
  expect(res.status()).toBe(415);
  expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
  expect(await fileTodos()).toEqual([]);
  expect(await (await request.get('/api/todos')).json()).toEqual([]);
});

test('AC-1: form-encoded POST is refused with 415', async ({ request }) => {
  const res = await request.post('/api/todos', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: Buffer.from('text=x'),
  });
  expect(res.status()).toBe(415);
  expect(await fileTodos()).toEqual([]);
});

test('AC-1: POST with no content type is refused with 415', async ({ request }) => {
  const res = await request.post('/api/todos', { data: Buffer.from('{"text":"x"}') });
  // Playwright may default to octet-stream for a Buffer; either way it is not JSON.
  expect(res.status()).toBe(415);
  expect(await fileTodos()).toEqual([]);
});

test('AC-1: 415 wins over bad JSON', async ({ request }) => {
  const res = await request.post('/api/todos', {
    headers: { 'content-type': 'text/plain' },
    data: Buffer.from('{not json'),
  });
  expect(res.status()).toBe(415);
});

test('AC-1: JSON content type with charset and odd case is accepted', async ({ request }) => {
  const res = await request.post('/api/todos', {
    headers: { 'content-type': 'Application/JSON; charset=utf-8' },
    data: Buffer.from('{"text":"Buy milk"}'),
  });
  expect(res.status()).toBe(201);
  const todos = await fileTodos();
  expect(todos).toHaveLength(1);
  expect(todos[0].text).toBe('Buy milk');
});

test('AC-1: PATCH with text/plain is refused and changes nothing', async ({ request }) => {
  await seedRaw(JSON.stringify([{ id: 'a', text: 'Buy milk', done: false }]));
  const res = await request.patch('/api/todos/a', {
    headers: { 'content-type': 'text/plain' },
    data: Buffer.from('{"done":true}'),
  });
  expect(res.status()).toBe(415);
  expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' });
  expect((await fileTodos())[0].done).toBe(false);
});

test('AC-1: PATCH with JSON content type still works', async ({ request }) => {
  await seedRaw(JSON.stringify([{ id: 'a', text: 'Buy milk', done: false }]));
  const res = await request.patch('/api/todos/a', {
    headers: { 'content-type': 'application/json' },
    data: Buffer.from('{"done":true}'),
  });
  expect(res.status()).toBe(200);
  expect((await fileTodos())[0].done).toBe(true);
});

test('AC-1: DELETE needs no content type', async ({ request }) => {
  await seedRaw(JSON.stringify([{ id: 'a', text: 'Buy milk', done: false }]));
  const res = await request.delete('/api/todos/a');
  expect(res.status()).toBeLessThan(300);
  expect(await fileTodos()).toEqual([]);
});

test('AC-1: GET skips malformed entries and keeps order', async ({ request }) => {
  await seedRaw(
    '[{"id":"1","text":"ok","done":false},{"id":2,"text":"bad","done":false},{"id":"3","text":"x"},null,{"id":"4","text":"two","done":true,"extra":1}]',
  );
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.map((t) => t.id)).toEqual(['1', '4']);
});

test('AC-1: corrupt file still gives 500', async ({ request }) => {
  await seedRaw('{not json');
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(500);
});

test('AC-1: adding a todo from the page still works', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New todo').fill('Buy milk');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('list', { name: 'Todos' }).getByText('Buy milk')).toBeVisible();
  await expect(page.getByLabel('New todo')).toHaveValue('');
});
