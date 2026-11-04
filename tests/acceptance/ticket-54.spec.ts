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

const MIXED: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
  { id: 'c', text: 'Charlie', done: false },
];

const json = { 'content-type': 'application/json' };

test.describe('ticket 54: bulk PATCH /api/todos', () => {
  test.beforeEach(async () => {
    await seed(MIXED);
  });

  test('AC-10: {"done": true} returns 200 with full list all done', async ({ request }) => {
    const res = await request.patch('/api/todos', { data: { done: true } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(MIXED.map((t) => ({ ...t, done: true })));
    const get = await request.get('/api/todos');
    expect((await get.json()).every((t: Todo) => t.done === true)).toBe(true);
  });

  test('AC-11: {"done": false} returns 200 with full list all not done', async ({ request }) => {
    const res = await request.patch('/api/todos', { data: { done: false } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(MIXED.map((t) => ({ ...t, done: false })));
    const get = await request.get('/api/todos');
    expect((await get.json()).every((t: Todo) => t.done === false)).toBe(true);
  });

  const bad: [string, Buffer][] = [
    ['missing done', Buffer.from('{}')],
    ['string "true"', Buffer.from('{"done":"true"}')],
    ['number 1', Buffer.from('{"done":1}')],
    ['null', Buffer.from('{"done":null}')],
    ['invalid JSON', Buffer.from('{not json')],
    ['non-object body', Buffer.from('[true]')],
  ];
  for (const [label, body] of bad) {
    test(`AC-12: ${label} gives 400 and changes nothing`, async ({ request }) => {
      const res = await request.patch('/api/todos', { data: body, headers: json });
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual(
        expect.objectContaining({ error: expect.any(String) }),
      );
      const get = await request.get('/api/todos');
      expect(await get.json()).toEqual(MIXED);
    });
  }

  test('AC-12: done missing error message', async ({ request }) => {
    const res = await request.patch('/api/todos', { data: Buffer.from('{}'), headers: json });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'done must be true or false' });
  });

  test('AC-13: no todos, {"done": true} gives 200 with empty list', async ({ request }) => {
    await seed([]);
    const res = await request.patch('/api/todos', { data: { done: true } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('AC-10: other methods answer 405 with allow listing PATCH', async ({ request }) => {
    const res = await request.put('/api/todos');
    expect(res.status()).toBe(405);
    expect(res.headers()['allow']).toBe('GET, POST, PATCH, DELETE');
  });
});
