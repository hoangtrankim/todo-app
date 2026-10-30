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

test.beforeEach(async ({ page }) => {
  await seed([
    { id: 'a', text: 'Alpha', done: false },
    { id: 'b', text: 'Bravo', done: false },
  ]);
  await page.goto('/');
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(2);
});

const list = (page: Page) => page.getByRole('list', { name: 'Todos' });
const edit = (page: Page) => page.getByRole('textbox', { name: 'Edit todo' });

async function holdPatch(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PATCH') await gate;
    await route.continue();
  });
  return release;
}

// Starts a save of Alpha -> "Alpha new" and leaves it in flight.
async function startPendingSave(page: Page) {
  const release = await holdPatch(page);
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha new');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  return release;
}

test('AC-2: editing during an in-flight save opens the field with the pending text', async ({ page }) => {
  const release = await startPendingSave(page);
  await list(page).getByText('Alpha new', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Alpha new');
  release();
});

test('AC-2: Enter on the unchanged pending text closes the field and the new text lands', async ({ page, request }) => {
  const release = await startPendingSave(page);
  await list(page).getByText('Alpha new', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Alpha new');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  release();
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Alpha', { exact: true })).toHaveCount(0);
  await expect(edit(page)).toHaveCount(0);
  const todos = await (await request.get('/api/todos')).json();
  expect(todos[0].text).toBe('Alpha new');
});

test('AC-2: click-away on the unchanged pending text closes the field and keeps the new text', async ({ page }) => {
  const release = await startPendingSave(page);
  await list(page).getByText('Alpha new', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Alpha new');
  await page.getByRole('heading').first().click();
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  release();
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Alpha', { exact: true })).toHaveCount(0);
});

test('AC-2: Escape on the pending text keeps showing it until the server answers', async ({ page }) => {
  const release = await startPendingSave(page);
  await list(page).getByText('Alpha new', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Alpha new');
  await edit(page).press('Escape');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  release();
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
});

test('AC-2: changing the pending text and saving works as a normal edit', async ({ page, request }) => {
  const release = await startPendingSave(page);
  await list(page).getByText('Alpha new', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Alpha new');
  await edit(page).fill('Alpha final');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha final', { exact: true })).toBeVisible();
  release();
  await expect(list(page).getByText('Alpha final', { exact: true })).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('/api/todos')).json())[0].text).toBe('Alpha final');
});
