import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

async function seedRaw(raw: string) {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, raw);
}

const A = { id: 'a', text: 'Buy milk', done: false };
const B = { id: 'b', text: 'Walk dog', done: true };
const C = { id: 'c', text: 'Read book', done: false };

const todoList = (page) => page.getByRole('list', { name: 'Todos' });
const todoItems = (page) => todoList(page).getByRole('listitem');

async function expectList(page, todos: { text: string; done: boolean }[]) {
  await expect(todoList(page).getByRole('checkbox')).toHaveCount(todos.length);
  for (const [i, { text, done }] of todos.entries()) {
    const box = todoItems(page).nth(i).getByRole('checkbox');
    await expect(box).toHaveAccessibleName(text);
    if (done) await expect(box).toBeChecked();
    else await expect(box).not.toBeChecked();
  }
  await expect(page.getByText('Could not load todos')).toHaveCount(0);
}

test('AC-6: null entry between real todos is hidden, real todos shown in order after load and reload', async ({
  page,
}) => {
  await seedRaw(JSON.stringify([A, null, B, null, C]));
  await page.goto('/');
  const expected = [
    { text: 'Buy milk', done: false },
    { text: 'Walk dog', done: true },
    { text: 'Read book', done: false },
  ];
  await expectList(page, expected);
  await page.reload();
  await expectList(page, expected);
});

test('AC-6: GET /api/todos returns only object entries in file order', async ({ request }) => {
  await seedRaw(JSON.stringify([A, null, B]));
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([A, B]);
});

test('AC-6: a file holding only null entries gives an empty list', async ({ page, request }) => {
  await seedRaw(JSON.stringify([null]));
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([]);
  await page.goto('/');
  await expect(page.getByText('No todos yet')).toBeVisible();
  await expect(page.getByText('Could not load todos')).toHaveCount(0);
});

test('AC-6: a file that is not an array still gives 500 and is not modified', async ({ request }) => {
  const raw = '{"id":"a"}';
  await seedRaw(raw);
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(500);
  expect(await res.json()).toEqual({ error: 'Internal server error' });
  expect(await readFile(TODOS_FILE, 'utf8')).toBe(raw);
});

test('AC-6: a file with invalid JSON still gives 500 and is not modified', async ({ request }) => {
  const raw = '[{"id":"a"';
  await seedRaw(raw);
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(500);
  expect(await res.json()).toEqual({ error: 'Internal server error' });
  expect(await readFile(TODOS_FILE, 'utf8')).toBe(raw);
});
