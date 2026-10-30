import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };

const SEED: Todo[] = [{ id: 'a', text: 'Buy milk', done: false }];

test.beforeEach(async () => {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(SEED));
});

test('AC-15: bad done plus good text answers 400 and changes nothing', async ({ request }) => {
  const res = await request.patch('/api/todos/a', { data: { text: 'x', done: 'yes' } });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: 'done must be true or false' });
  expect(await (await request.get('/api/todos')).json()).toEqual(SEED);
});

test('AC-15: text and done together change both fields in one request', async ({ request }) => {
  const res = await request.patch('/api/todos/a', { data: { text: 'x', done: true } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ id: 'a', text: 'x', done: true });
  expect(await (await request.get('/api/todos')).json()).toEqual([
    { id: 'a', text: 'x', done: true },
  ]);
});
