import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };

async function seed(todos: Todo[]) {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(todos));
}

const SEED: Todo[] = [
  { id: 'a', text: 'one', done: false },
  { id: 'b', text: 'two', done: true },
];

test.beforeEach(async () => {
  await seed(SEED);
});

test('AC-14: editing an unknown id answers 404 and changes nothing', async ({ request }) => {
  const res = await request.patch('/api/todos/nope', { data: { text: 'valid' } });
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toBe('Todo not found');
  const list = await (await request.get('/api/todos')).json();
  expect(list).toEqual(SEED);
});

test('AC-14: a successful edit changes only that todo, trimmed, done untouched', async ({ request }) => {
  const res = await request.patch('/api/todos/b', { data: { text: '  New  ' } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ id: 'b', text: 'New', done: true });
  const list = await (await request.get('/api/todos')).json();
  expect(list).toEqual([SEED[0], { id: 'b', text: 'New', done: true }]);
});

for (const text of ['', '   ']) {
  test(`AC-15: empty text ${JSON.stringify(text)} answers 400 and text is unchanged`, async ({ request }) => {
    const add = await request.post('/api/todos', { data: { text: '' } });
    const expected = (await add.json()).error;
    const res = await request.patch('/api/todos/a', { data: { text } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe(expected);
    const list = await (await request.get('/api/todos')).json();
    expect(list).toEqual(SEED);
  });
}

test('AC-15: non-string text answers 400 and text is unchanged', async ({ request }) => {
  const res = await request.patch('/api/todos/a', { data: { text: 5 } });
  expect(res.status()).toBe(400);
  const list = await (await request.get('/api/todos')).json();
  expect(list).toEqual(SEED);
});

test('AC-15: empty text with done also sent changes nothing', async ({ request }) => {
  const res = await request.patch('/api/todos/a', { data: { text: ' ', done: true } });
  expect(res.status()).toBe(400);
  const list = await (await request.get('/api/todos')).json();
  expect(list).toEqual(SEED);
});
