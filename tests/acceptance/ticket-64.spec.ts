import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

const TODOS: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
];

const items = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

test('AC-1: Escape empties the new-todo input and keeps focus', async ({ page }) => {
  await seed(TODOS);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'New todo' });
  await input.fill('half typed');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
});

test('AC-2: Escape adds no todo and leaves the list unchanged', async ({ page, request }) => {
  await seed(TODOS);
  await page.goto('/');
  await expect(items(page)).toHaveCount(2);
  const before = await (await request.get('/api/todos')).json();
  const input = page.getByRole('textbox', { name: 'New todo' });
  await input.fill('half typed');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).nth(0)).toContainText('Alpha');
  await expect(items(page).nth(1)).toContainText('Bravo');
  expect(await (await request.get('/api/todos')).json()).toEqual(before);
  await page.reload();
  await expect(items(page)).toHaveCount(2);
});
