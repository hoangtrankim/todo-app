import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Same storage file the server uses (design note: playwright.config.js sets
// TODOS_FILE to <os.tmpdir()>/todo-app-test/todos.json when unset).
const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

async function resetTodos() {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, '[]');
}

test.beforeEach(async () => {
  await resetTodos();
});

const input = (page) => page.getByLabel('New todo');
const addButton = (page) => page.getByRole('button', { name: 'Add' });
const todoList = (page) => page.getByRole('list', { name: 'Todos' });
const todoItems = (page) => todoList(page).getByRole('listitem');
// A list item's text is the todo text, plus "Delete" once #4 adds a Delete button to each item.
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const item = (text: string) => new RegExp(`^\\s*${escapeRegExp(text)}\\s*(Delete)?\\s*$`);
const items = (texts: string[]) => texts.map(item);

test.describe('UI', () => {
  test('AC-1: typing "Buy milk" and pressing Add appends it and clears the input', async ({ page }) => {
    await page.request.post('/api/todos', { data: { text: 'Walk dog' } });
    await page.goto('/');
    await expect(todoItems(page)).toHaveText(items(['Walk dog']));

    await input(page).fill('Buy milk');
    await addButton(page).click();

    await expect(todoItems(page)).toHaveText(items(['Walk dog', 'Buy milk']));
    await expect(todoItems(page).last()).toHaveText(item('Buy milk'));
    await expect(input(page)).toHaveValue('');
  });

  test('AC-1: typing "Buy milk" and pressing Enter appends it and clears the input', async ({ page }) => {
    await page.request.post('/api/todos', { data: { text: 'Walk dog' } });
    await page.goto('/');
    await expect(todoItems(page)).toHaveText(items(['Walk dog']));

    await input(page).fill('Buy milk');
    await input(page).press('Enter');

    await expect(todoItems(page)).toHaveText(items(['Walk dog', 'Buy milk']));
    await expect(input(page)).toHaveValue('');
  });

  test('AC-1: an added todo is stored on the server', async ({ page }) => {
    await page.goto('/');
    await input(page).fill('Buy milk');
    await addButton(page).click();
    await expect(todoItems(page)).toHaveText(items(['Buy milk']));

    const res = await page.request.get('/api/todos');
    const todos = await res.json();
    expect(todos.map((t) => t.text)).toEqual(['Buy milk']);
  });

  test('AC-2: empty input adds nothing and shows "Todo can\'t be empty"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No todos yet')).toBeVisible();

    await input(page).fill('');
    await addButton(page).click();

    await expect(page.getByRole('alert')).toHaveText("Todo can't be empty");
    await expect(page.getByText('No todos yet')).toBeVisible();
    await expect(todoItems(page)).toHaveCount(0);
    expect(await (await page.request.get('/api/todos')).json()).toEqual([]);
  });

  test('AC-2: spaces-only input adds nothing and shows "Todo can\'t be empty"', async ({ page }) => {
    await page.request.post('/api/todos', { data: { text: 'Walk dog' } });
    await page.goto('/');
    await expect(todoItems(page)).toHaveText(items(['Walk dog']));

    await input(page).fill('    ');
    await addButton(page).click();

    await expect(page.getByRole('alert')).toHaveText("Todo can't be empty");
    await expect(todoItems(page)).toHaveText(items(['Walk dog']));
    const todos = await (await page.request.get('/api/todos')).json();
    expect(todos.map((t) => t.text)).toEqual(['Walk dog']);
  });

  test('AC-2: the empty message goes away after the next successful add', async ({ page }) => {
    await page.goto('/');
    await addButton(page).click();
    await expect(page.getByText("Todo can't be empty")).toBeVisible();

    await input(page).fill('Buy milk');
    await addButton(page).click();

    await expect(todoItems(page)).toHaveText(items(['Buy milk']));
    await expect(page.getByText("Todo can't be empty")).toBeHidden();
  });

  test('AC-7: with no todos, opening the app shows "No todos yet"', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No todos yet')).toBeVisible();
    await expect(todoItems(page)).toHaveCount(0);
  });

  test('AC-7: "No todos yet" is not shown once a todo exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('No todos yet')).toBeVisible();

    await input(page).fill('Buy milk');
    await addButton(page).click();

    await expect(todoItems(page)).toHaveText(items(['Buy milk']));
    await expect(page.getByText('No todos yet')).toBeHidden();
  });

  test('AC-7: "No todos yet" is not shown when the app opens with stored todos', async ({ page }) => {
    await page.request.post('/api/todos', { data: { text: 'Walk dog' } });
    await page.goto('/');
    await expect(todoItems(page)).toHaveText(items(['Walk dog']));
    await expect(page.getByText('No todos yet')).toBeHidden();
  });
});

test.describe('API', () => {
  test('AC-7: GET /api/todos returns [] when nothing is stored', async ({ request }) => {
    const res = await request.get('/api/todos');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toEqual([]);
  });

  test('AC-1: POST /api/todos trims text, returns 201 and appends in order', async ({ request }) => {
    const first = await request.post('/api/todos', { data: { text: '  Buy milk ' } });
    expect(first.status()).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ text: 'Buy milk', done: false });
    expect(typeof created.id).toBe('string');

    const second = await request.post('/api/todos', { data: { text: 'Walk dog' } });
    expect(second.status()).toBe(201);
    const created2 = await second.json();
    expect(created2.id).not.toBe(created.id);

    const list = await request.get('/api/todos');
    expect(list.status()).toBe(200);
    expect(await list.json()).toEqual([
      { id: created.id, text: 'Buy milk', done: false },
      { id: created2.id, text: 'Walk dog', done: false },
    ]);
  });

  for (const [label, body] of [
    ['empty text', { text: '' }],
    ['whitespace-only text', { text: '   ' }],
    ['missing text', {}],
    ['non-string text', { text: 42 }],
  ] as const) {
    test(`AC-2: POST /api/todos rejects ${label} with 400 and stores nothing`, async ({ request }) => {
      const res = await request.post('/api/todos', { data: body });
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: "Todo can't be empty" });
      expect(await (await request.get('/api/todos')).json()).toEqual([]);
    });
  }

  test('AC-2: POST /api/todos rejects invalid JSON with 400 and stores nothing', async ({ request }) => {
    const res = await request.post('/api/todos', {
      headers: { 'content-type': 'application/json' },
      data: '{not json',
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
    expect(await (await request.get('/api/todos')).json()).toEqual([]);
  });
});
