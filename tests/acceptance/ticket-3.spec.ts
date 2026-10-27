import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Same storage file the server uses (design note: playwright.config.js sets
// TODOS_FILE to <os.tmpdir()>/todo-app-test/todos.json when unset).
const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };

async function seedTodos(todos: Todo[]) {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(todos));
}

const SEED: Todo[] = [
  { id: 'a', text: 'Buy milk', done: false },
  { id: 'b', text: 'Walk dog', done: true },
  { id: 'c', text: 'Read book', done: false },
];

test.beforeEach(async () => {
  await seedTodos(SEED);
});

const todoList = (page) => page.getByRole('list', { name: 'Todos' });
const checkbox = (page, text: string) => todoList(page).getByRole('checkbox', { name: text });
const todoText = (page, text: string) => todoList(page).getByText(text, { exact: true });
const lineThrough = /line-through/;

async function storedTodos(request): Promise<Todo[]> {
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe('UI', () => {
  test('AC-3: checking a todo crosses out its text and saves done: true', async ({ page }) => {
    await page.goto('/');
    await expect(checkbox(page, 'Buy milk')).not.toBeChecked();
    await expect(todoText(page, 'Buy milk')).toHaveCSS('text-decoration-line', 'none');

    await checkbox(page, 'Buy milk').check();

    await expect(checkbox(page, 'Buy milk')).toBeChecked();
    await expect(todoText(page, 'Buy milk')).toHaveCSS('text-decoration-line', lineThrough);
    // Other todos are untouched.
    await expect(todoText(page, 'Read book')).toHaveCSS('text-decoration-line', 'none');
    await expect(checkbox(page, 'Read book')).not.toBeChecked();

    await expect
      .poll(async () => (await storedTodos(page.request)).find((t) => t.id === 'a')?.done)
      .toBe(true);
  });

  test('AC-3: a checked todo is still crossed out after a reload', async ({ page }) => {
    await page.goto('/');
    await checkbox(page, 'Buy milk').check();
    await expect
      .poll(async () => (await storedTodos(page.request)).find((t) => t.id === 'a')?.done)
      .toBe(true);

    await page.reload();

    await expect(checkbox(page, 'Buy milk')).toBeChecked();
    await expect(todoText(page, 'Buy milk')).toHaveCSS('text-decoration-line', lineThrough);
  });

  test('AC-3: a todo stored as done opens checked and crossed out', async ({ page }) => {
    await page.goto('/');
    await expect(checkbox(page, 'Walk dog')).toBeChecked();
    await expect(todoText(page, 'Walk dog')).toHaveCSS('text-decoration-line', lineThrough);
    await expect(checkbox(page, 'Buy milk')).not.toBeChecked();
    await expect(todoText(page, 'Buy milk')).toHaveCSS('text-decoration-line', 'none');
  });

  test('AC-3: if saving fails, the checkbox goes back and "Could not update todo" is shown', async ({ page }) => {
    await page.route('**/api/todos/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
        : route.continue(),
    );
    await page.goto('/');

    await checkbox(page, 'Buy milk').click();

    await expect(page.getByRole('alert')).toHaveText('Could not update todo');
    await expect(checkbox(page, 'Buy milk')).not.toBeChecked();
    await expect(todoText(page, 'Buy milk')).toHaveCSS('text-decoration-line', 'none');
    expect((await storedTodos(page.request)).find((t) => t.id === 'a')?.done).toBe(false);
  });

  test('AC-4: unchecking a done todo removes the strike-through and saves done: false', async ({ page }) => {
    await page.goto('/');
    await expect(checkbox(page, 'Walk dog')).toBeChecked();
    await expect(todoText(page, 'Walk dog')).toHaveCSS('text-decoration-line', lineThrough);

    await checkbox(page, 'Walk dog').uncheck();

    await expect(checkbox(page, 'Walk dog')).not.toBeChecked();
    await expect(todoText(page, 'Walk dog')).toHaveCSS('text-decoration-line', 'none');

    await expect
      .poll(async () => (await storedTodos(page.request)).find((t) => t.id === 'b')?.done)
      .toBe(false);
  });

  test('AC-4: an unchecked todo is still not crossed out after a reload', async ({ page }) => {
    await page.goto('/');
    await checkbox(page, 'Walk dog').uncheck();
    await expect
      .poll(async () => (await storedTodos(page.request)).find((t) => t.id === 'b')?.done)
      .toBe(false);

    await page.reload();

    await expect(checkbox(page, 'Walk dog')).not.toBeChecked();
    await expect(todoText(page, 'Walk dog')).toHaveCSS('text-decoration-line', 'none');
  });

  test('AC-4: checking then unchecking a todo leaves it not crossed out', async ({ page }) => {
    await page.goto('/');
    await checkbox(page, 'Read book').check();
    await expect(todoText(page, 'Read book')).toHaveCSS('text-decoration-line', lineThrough);

    await checkbox(page, 'Read book').uncheck();

    await expect(todoText(page, 'Read book')).toHaveCSS('text-decoration-line', 'none');
    await expect
      .poll(async () => (await storedTodos(page.request)).find((t) => t.id === 'c')?.done)
      .toBe(false);
  });

  test('AC-4: if saving fails, the checkbox goes back to checked and "Could not update todo" is shown', async ({ page }) => {
    await page.route('**/api/todos/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
        : route.continue(),
    );
    await page.goto('/');

    await checkbox(page, 'Walk dog').click();

    await expect(page.getByRole('alert')).toHaveText('Could not update todo');
    await expect(checkbox(page, 'Walk dog')).toBeChecked();
    await expect(todoText(page, 'Walk dog')).toHaveCSS('text-decoration-line', lineThrough);
    expect((await storedTodos(page.request)).find((t) => t.id === 'b')?.done).toBe(true);
  });
});

test.describe('API', () => {
  test('AC-3: PATCH /api/todos/:id with done: true returns the updated todo and stores it', async ({ request }) => {
    const res = await request.patch('/api/todos/a', { data: { done: true } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toEqual({ id: 'a', text: 'Buy milk', done: true });

    expect(await storedTodos(request)).toEqual([
      { id: 'a', text: 'Buy milk', done: true },
      { id: 'b', text: 'Walk dog', done: true },
      { id: 'c', text: 'Read book', done: false },
    ]);
  });

  test('AC-4: PATCH /api/todos/:id with done: false returns the updated todo and stores it', async ({ request }) => {
    const res = await request.patch('/api/todos/b', { data: { done: false } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ id: 'b', text: 'Walk dog', done: false });

    expect(await storedTodos(request)).toEqual([
      { id: 'a', text: 'Buy milk', done: false },
      { id: 'b', text: 'Walk dog', done: false },
      { id: 'c', text: 'Read book', done: false },
    ]);
  });

  test('AC-3: PATCH ignores extra fields and never changes the text', async ({ request }) => {
    const res = await request.patch('/api/todos/a', { data: { done: true, text: 'Hacked', id: 'z' } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ id: 'a', text: 'Buy milk', done: true });
    expect((await storedTodos(request))[0]).toEqual({ id: 'a', text: 'Buy milk', done: true });
  });

  test('AC-3: PATCH an unknown id returns 404 and writes nothing', async ({ request }) => {
    const res = await request.patch('/api/todos/nope', { data: { done: true } });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'Todo not found' });
    expect(await storedTodos(request)).toEqual(SEED);
  });

  for (const [label, raw] of [
    ['malformed JSON', '{not json'],
    ['a JSON array', '[true]'],
    ['a JSON string', '"done"'],
    ['JSON null', 'null'],
  ] as const) {
    test(`AC-3: PATCH with ${label} returns 400 "Invalid JSON" and writes nothing`, async ({ request }) => {
      const res = await request.patch('/api/todos/a', {
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(raw),
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON' });
      expect(await storedTodos(request)).toEqual(SEED);
    });
  }

  for (const [label, body] of [
    ['missing done', {}],
    ['done as a string', { done: 'true' }],
    ['done as a number', { done: 1 }],
    ['done as null', { done: null }],
  ] as const) {
    test(`AC-3: PATCH with ${label} returns 400 "done must be true or false" and writes nothing`, async ({ request }) => {
      const res = await request.patch('/api/todos/a', { data: body });
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: 'done must be true or false' });
      expect(await storedTodos(request)).toEqual(SEED);
    });
  }

  for (const method of ['GET', 'PUT', 'POST']) {
    test(`AC-3: ${method} /api/todos/:id returns 405 with allow: PATCH`, async ({ request }) => {
      const res = await request.fetch('/api/todos/a', method === 'GET' ? { method } : { method, data: { done: true } });
      expect(res.status()).toBe(405);
      expect(res.headers()['allow']).toContain('PATCH');
      expect(await res.json()).toEqual({ error: 'Method not allowed' });
      expect(await storedTodos(request)).toEqual(SEED);
    });
  }

  test('AC-3: an unknown path under /api/ returns 404 JSON "Not found"', async ({ request }) => {
    const res = await request.get('/api/nothing-here');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
