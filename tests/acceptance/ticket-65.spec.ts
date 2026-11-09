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
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
];
const MSG = 'Todo text must be 200 characters or fewer';

test.beforeEach(async () => {
  await seed(SEED);
});

test('AC-3: POST with 201 characters is refused and nothing is added', async ({ request }) => {
  const res = await request.post('/api/todos', { data: { text: 'x'.repeat(201) } });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: MSG });
  const list = await (await request.get('/api/todos')).json();
  expect(list).toHaveLength(2);
});

test('AC-3: POST counts characters after trimming', async ({ request }) => {
  const over = await request.post('/api/todos', { data: { text: '  ' + 'x'.repeat(201) + '  ' } });
  expect(over.status()).toBe(400);
  const ok = await request.post('/api/todos', { data: { text: '  ' + 'y'.repeat(200) + '  ' } });
  expect(ok.status()).toBe(201);
  expect((await ok.json()).text).toBe('y'.repeat(200));
});

test('AC-4: PATCH with 201 characters is refused and the todo is unchanged', async ({ request }) => {
  const res = await request.patch('/api/todos/a', { data: { text: 'z'.repeat(201) } });
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: MSG });
  const list: Todo[] = await (await request.get('/api/todos')).json();
  expect(list.find((t) => t.id === 'a')?.text).toBe('Alpha');
});

test('AC-4: PATCH with exactly 200 characters is accepted', async ({ request }) => {
  const text = 'w'.repeat(200);
  const res = await request.patch('/api/todos/a', { data: { text } });
  expect(res.status()).toBe(200);
  const list: Todo[] = await (await request.get('/api/todos')).json();
  expect(list.find((t) => t.id === 'a')?.text).toBe(text);
});

test('AC-5: POST with exactly 200 characters is stored in full', async ({ request }) => {
  const text = 'abcdefghij'.repeat(20);
  const res = await request.post('/api/todos', { data: { text } });
  expect(res.status()).toBe(201);
  expect((await res.json()).text).toBe(text);
  const list: Todo[] = await (await request.get('/api/todos')).json();
  expect(list).toHaveLength(3);
  expect(list.some((t) => t.text === text)).toBe(true);
});

test('AC-6: submitting 201 characters in the page adds nothing and shows the message', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Alpha', { exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'New todo' });
  await input.fill('q'.repeat(201));
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(MSG);
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(2);
});

test('AC-6: the Add button also shows the message, and 200 characters is accepted', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'New todo' });
  await input.fill('q'.repeat(201));
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('alert')).toHaveText(MSG);
  await input.fill('r'.repeat(200));
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('alert')).not.toHaveText(MSG);
});
