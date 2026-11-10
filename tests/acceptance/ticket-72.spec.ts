import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };

const SEED: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
];
const MSG = 'Todo text must be 200 characters or fewer';
const E200 = '\u{1F600}'.repeat(200);
const E201 = '\u{1F600}'.repeat(201);

test.beforeEach(async () => {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(SEED));
});

test('AC-5: POST with 200 emoji is stored in full', async ({ request }) => {
  const res = await request.post('/api/todos', { data: { text: E200 } });
  expect(res.status()).toBe(201);
  expect((await res.json()).text).toBe(E200);
  const list: Todo[] = await (await request.get('/api/todos')).json();
  expect(list).toHaveLength(3);
  expect(list.some((t) => t.text === E200)).toBe(true);
});

test('AC-5: POST with 201 emoji is refused and nothing is added', async ({ request }) => {
  const res = await request.post('/api/todos', { data: { text: E201 } });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: MSG });
  expect(await (await request.get('/api/todos')).json()).toHaveLength(2);
});

test('AC-5: POST counts emoji after trimming', async ({ request }) => {
  const ok = await request.post('/api/todos', { data: { text: '  ' + E200 + '  ' } });
  expect(ok.status()).toBe(201);
  expect((await ok.json()).text).toBe(E200);
});

test('AC-5: PATCH with 200 emoji is accepted, 201 emoji is refused', async ({ request }) => {
  const bad = await request.patch('/api/todos/a', { data: { text: E201 } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: MSG });
  let list: Todo[] = await (await request.get('/api/todos')).json();
  expect(list.find((t) => t.id === 'a')?.text).toBe('Alpha');
  const ok = await request.patch('/api/todos/a', { data: { text: E200 } });
  expect(ok.status()).toBe(200);
  list = await (await request.get('/api/todos')).json();
  expect(list.find((t) => t.id === 'a')?.text).toBe(E200);
});

test('AC-5: plain ASCII still allows 200 and refuses 201', async ({ request }) => {
  const ok = await request.post('/api/todos', { data: { text: 'x'.repeat(200) } });
  expect(ok.status()).toBe(201);
  const bad = await request.post('/api/todos', { data: { text: 'x'.repeat(201) } });
  expect(bad.status()).toBe(400);
});

test('AC-5: the page adds 200 emoji and refuses 201 emoji with the message', async ({ page }) => {
  await page.goto('/');
  const items = page.getByRole('list', { name: 'Todos' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  const input = page.getByRole('textbox', { name: 'New todo' });
  await input.fill(E201);
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(MSG);
  await expect(items).toHaveCount(2);
  await input.fill(E200);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(items).toHaveCount(3);
  await expect(page.getByText(E200, { exact: true })).toBeVisible();
});
