import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function fileTodos(): Promise<Todo[]> {
  return JSON.parse(await readFile(TODOS_FILE, 'utf8'));
}

const SEED: Todo[] = [
  { id: 'a', text: 'Buy milk', done: false },
  { id: 'b', text: 'Walk dog', done: true },
  { id: 'c', text: 'Read book', done: false },
];

test.beforeEach(async () => {
  await seedTodos(SEED);
});

const input = (page) => page.getByLabel('New todo');
const addButton = (page) => page.getByRole('button', { name: 'Add' });
const todoList = (page) => page.getByRole('list', { name: 'Todos' });
const todoItems = (page) => todoList(page).getByRole('listitem');
const checkbox = (page, text: string) => todoList(page).getByRole('checkbox', { name: text });
const todoText = (page, text: string) => todoList(page).getByText(text, { exact: true });
const deleteButton = (page, text: string) => page.getByRole('button', { name: `Delete ${text}` });
const lineThrough = /line-through/;

async function storedTodos(request): Promise<Todo[]> {
  const res = await request.get('/api/todos');
  expect(res.status()).toBe(200);
  return res.json();
}

// Checks the visible list: the todo texts in order and each one's done state.
async function expectList(page, todos: { text: string; done: boolean }[]) {
  await expect(todoList(page).getByRole('checkbox')).toHaveCount(todos.length);
  for (const [i, { text, done }] of todos.entries()) {
    await expect(todoItems(page).nth(i).getByRole('checkbox')).toHaveAccessibleName(text);
    if (done) {
      await expect(checkbox(page, text)).toBeChecked();
      await expect(todoText(page, text)).toHaveCSS('text-decoration-line', lineThrough);
    } else {
      await expect(checkbox(page, text)).not.toBeChecked();
      await expect(todoText(page, text)).toHaveCSS('text-decoration-line', 'none');
    }
  }
}

// Fails the test if the page opens any dialog (confirm, alert, prompt).
function failOnDialog(page) {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  return dialogs;
}

test.describe('UI', () => {
  test('AC-5: clicking Delete removes the todo at once, with no confirmation', async ({ page }) => {
    const dialogs = failOnDialog(page);
    await page.goto('/');
    await expectList(page, [
      { text: 'Buy milk', done: false },
      { text: 'Walk dog', done: true },
      { text: 'Read book', done: false },
    ]);

    await deleteButton(page, 'Walk dog').click();

    await expect(todoText(page, 'Walk dog')).toHaveCount(0);
    await expect(todoItems(page)).toHaveCount(2);
    // The others keep their order, text and done state.
    await expectList(page, [
      { text: 'Buy milk', done: false },
      { text: 'Read book', done: false },
    ]);
    expect(dialogs).toEqual([]);
    await expect
      .poll(async () => storedTodos(page.request))
      .toEqual([
        { id: 'a', text: 'Buy milk', done: false },
        { id: 'c', text: 'Read book', done: false },
      ]);
  });

  test('AC-5: each todo has a "Delete" button inside its list item', async ({ page }) => {
    await page.goto('/');
    for (const text of ['Buy milk', 'Walk dog', 'Read book']) {
      const button = todoItems(page).filter({ hasText: text }).getByRole('button', { name: 'Delete' });
      await expect(button).toHaveCount(1);
      await expect(button).toHaveText('Delete');
    }

    await todoItems(page).filter({ hasText: 'Buy milk' }).getByRole('button', { name: 'Delete' }).click();

    await expect(todoText(page, 'Buy milk')).toHaveCount(0);
    await expectList(page, [
      { text: 'Walk dog', done: true },
      { text: 'Read book', done: false },
    ]);
  });

  test('AC-5: clicking Delete does not toggle the todo\'s checkbox', async ({ page }) => {
    const patches: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH') patches.push(req.url());
    });
    await page.goto('/');

    await deleteButton(page, 'Buy milk').click();

    await expect(todoText(page, 'Buy milk')).toHaveCount(0);
    expect(patches).toEqual([]);
    await expect
      .poll(async () => storedTodos(page.request))
      .toEqual([
        { id: 'b', text: 'Walk dog', done: true },
        { id: 'c', text: 'Read book', done: false },
      ]);
  });

  test('AC-5: deleting the last todo shows "No todos yet" again', async ({ page }) => {
    await seedTodos([{ id: 'only', text: 'Buy milk', done: false }]);
    await page.goto('/');
    await expect(page.getByText('No todos yet')).toBeHidden();

    await deleteButton(page, 'Buy milk').click();

    await expect(page.getByText('No todos yet')).toBeVisible();
    await expect(todoItems(page)).toHaveCount(0);
    await expect(todoList(page)).toBeHidden();
    await expect.poll(async () => storedTodos(page.request)).toEqual([]);
  });

  test('AC-5: if the server fails, the todo stays and "Could not delete todo" is shown', async ({ page }) => {
    await page.route('**/api/todos/*', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
        : route.continue(),
    );
    await page.goto('/');

    await deleteButton(page, 'Walk dog').click();

    await expect(page.getByRole('alert')).toHaveText('Could not delete todo');
    await expectList(page, [
      { text: 'Buy milk', done: false },
      { text: 'Walk dog', done: true },
      { text: 'Read book', done: false },
    ]);
    expect(await storedTodos(page.request)).toEqual(SEED);
  });

  test('AC-5: if the network fails, the todo stays and "Could not delete todo" is shown', async ({ page }) => {
    await page.route('**/api/todos/*', (route) =>
      route.request().method() === 'DELETE' ? route.abort('failed') : route.continue(),
    );
    await page.goto('/');

    await deleteButton(page, 'Buy milk').click();

    await expect(page.getByRole('alert')).toHaveText('Could not delete todo');
    await expectList(page, [
      { text: 'Buy milk', done: false },
      { text: 'Walk dog', done: true },
      { text: 'Read book', done: false },
    ]);
    expect(await storedTodos(page.request)).toEqual(SEED);
  });

  test('AC-5: deleting a todo that is already gone on the server removes it with no error', async ({ page }) => {
    await page.goto('/');
    await expect(todoText(page, 'Walk dog')).toBeVisible();
    // Someone else deleted it after the page loaded, so the page's DELETE gets a 404.
    expect((await page.request.delete('/api/todos/b')).status()).toBe(204);
    const deleteResponse = page.waitForResponse(
      (res) => res.request().method() === 'DELETE' && res.url().endsWith('/api/todos/b'),
    );

    await deleteButton(page, 'Walk dog').click();

    expect((await deleteResponse).status()).toBe(404);
    await expect(todoText(page, 'Walk dog')).toHaveCount(0);
    await expectList(page, [
      { text: 'Buy milk', done: false },
      { text: 'Read book', done: false },
    ]);
    await expect(page.getByText('Could not delete todo')).toHaveCount(0);
  });
});

test.describe('Reload', () => {
  test('AC-6: after adding, checking and deleting, a reload shows the same todos, order and done states', async ({ page }) => {
    await seedTodos([]);
    await page.goto('/');
    for (const text of ['Buy milk', 'Walk dog', 'Read book', 'Pay rent', 'Call mum']) {
      await input(page).fill(text);
      await addButton(page).click();
      await expect(todoText(page, text)).toBeVisible();
    }
    await checkbox(page, 'Walk dog').check();
    await checkbox(page, 'Pay rent').check();
    await checkbox(page, 'Call mum').check();
    await expect
      .poll(async () => (await storedTodos(page.request)).find((t) => t.text === 'Call mum')?.done)
      .toBe(true);
    await checkbox(page, 'Call mum').uncheck();
    await deleteButton(page, 'Buy milk').click();
    await expect(todoText(page, 'Buy milk')).toHaveCount(0);
    await deleteButton(page, 'Pay rent').click();
    await expect(todoText(page, 'Pay rent')).toHaveCount(0);

    const expected = [
      { text: 'Walk dog', done: true },
      { text: 'Read book', done: false },
      { text: 'Call mum', done: false },
    ];
    await expectList(page, expected);
    // Wait until the server holds the same list, so the reload cannot race a save.
    await expect
      .poll(async () => (await storedTodos(page.request)).map(({ text, done }) => ({ text, done })))
      .toEqual(expected);

    await page.reload();

    await expectList(page, expected);
    await expect(page.getByText('No todos yet')).toBeHidden();
  });

  test('AC-6: a deleted todo does not come back after a reload', async ({ page }) => {
    await page.goto('/');
    await deleteButton(page, 'Read book').click();
    await expect(todoText(page, 'Read book')).toHaveCount(0);
    await expect.poll(async () => (await storedTodos(page.request)).length).toBe(2);

    await page.reload();

    await expectList(page, [
      { text: 'Buy milk', done: false },
      { text: 'Walk dog', done: true },
    ]);
    await expect(todoText(page, 'Read book')).toHaveCount(0);
  });

  test('AC-6: deleting every todo then reloading shows "No todos yet"', async ({ page }) => {
    await page.goto('/');
    for (const text of ['Walk dog', 'Buy milk', 'Read book']) {
      await deleteButton(page, text).click();
      await expect(todoText(page, text)).toHaveCount(0);
    }
    await expect.poll(async () => storedTodos(page.request)).toEqual([]);

    await page.reload();

    await expect(page.getByText('No todos yet')).toBeVisible();
    await expect(todoItems(page)).toHaveCount(0);
  });

  test('AC-6: the list comes from the server, so a fresh browser shows the same todos', async ({ page, browser }) => {
    await page.goto('/');
    await checkbox(page, 'Buy milk').check();
    await deleteButton(page, 'Walk dog').click();
    await expect(todoText(page, 'Walk dog')).toHaveCount(0);
    await expect
      .poll(async () => storedTodos(page.request))
      .toEqual([
        { id: 'a', text: 'Buy milk', done: true },
        { id: 'c', text: 'Read book', done: false },
      ]);

    // A new context has no cookies or browser storage from the first one.
    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      await fresh.goto('/');
      await expectList(fresh, [
        { text: 'Buy milk', done: true },
        { text: 'Read book', done: false },
      ]);
    } finally {
      await context.close();
    }
  });
});

test.describe('API', () => {
  test('AC-5: DELETE /api/todos/:id returns 204 with an empty body and removes the todo from storage', async ({ request }) => {
    const res = await request.delete('/api/todos/b');
    expect(res.status()).toBe(204);
    expect((await res.body()).length).toBe(0);

    const remaining = [
      { id: 'a', text: 'Buy milk', done: false },
      { id: 'c', text: 'Read book', done: false },
    ];
    expect(await storedTodos(request)).toEqual(remaining);
    expect(await fileTodos()).toEqual(remaining);
  });

  test('AC-5: DELETE keeps the other todos, their order and done states', async ({ request }) => {
    expect((await request.delete('/api/todos/a')).status()).toBe(204);
    expect(await storedTodos(request)).toEqual([
      { id: 'b', text: 'Walk dog', done: true },
      { id: 'c', text: 'Read book', done: false },
    ]);

    expect((await request.delete('/api/todos/c')).status()).toBe(204);
    expect(await storedTodos(request)).toEqual([{ id: 'b', text: 'Walk dog', done: true }]);

    expect((await request.delete('/api/todos/b')).status()).toBe(204);
    expect(await storedTodos(request)).toEqual([]);
  });

  test('AC-5: DELETE ignores a request body', async ({ request }) => {
    const res = await request.delete('/api/todos/a', { data: { id: 'b', done: true } });
    expect(res.status()).toBe(204);
    expect(await storedTodos(request)).toEqual([
      { id: 'b', text: 'Walk dog', done: true },
      { id: 'c', text: 'Read book', done: false },
    ]);
  });

  test('AC-5: DELETE an unknown id returns 404 "Todo not found" and writes nothing', async ({ request }) => {
    const res = await request.delete('/api/todos/nope');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Todo not found' });
    expect(await storedTodos(request)).toEqual(SEED);
    expect(await fileTodos()).toEqual(SEED);
  });

  test('AC-5: a second DELETE of the same id returns 404 "Todo not found"', async ({ request }) => {
    expect((await request.delete('/api/todos/a')).status()).toBe(204);

    const res = await request.delete('/api/todos/a');
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'Todo not found' });
    expect(await storedTodos(request)).toEqual([
      { id: 'b', text: 'Walk dog', done: true },
      { id: 'c', text: 'Read book', done: false },
    ]);
  });

  test('AC-5: PATCH on a deleted id returns 404 "Todo not found"', async ({ request }) => {
    expect((await request.delete('/api/todos/a')).status()).toBe(204);

    const res = await request.patch('/api/todos/a', { data: { done: true } });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'Todo not found' });
    expect(await storedTodos(request)).toEqual([
      { id: 'b', text: 'Walk dog', done: true },
      { id: 'c', text: 'Read book', done: false },
    ]);
  });

  for (const method of ['GET', 'PUT', 'POST']) {
    test(`AC-5: ${method} /api/todos/:id returns 405 with allow: PATCH, DELETE`, async ({ request }) => {
      const res = await request.fetch('/api/todos/a', method === 'GET' ? { method } : { method, data: { done: true } });
      expect(res.status()).toBe(405);
      const allow = (res.headers()['allow'] ?? '').split(',').map((m) => m.trim());
      expect(allow).toEqual(expect.arrayContaining(['PATCH', 'DELETE']));
      expect(await res.json()).toEqual({ error: 'Method not allowed' });
      expect(await storedTodos(request)).toEqual(SEED);
    });
  }
});
