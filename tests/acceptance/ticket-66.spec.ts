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

const THREE: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
  { id: 'c', text: 'Charlie', done: false },
];

const items = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');
const dialog = (page: Page) => page.getByRole('alertdialog', { name: 'Confirm delete all' });

async function open(page: Page, todos: Todo[] = THREE) {
  await seed(todos);
  await page.goto('/');
  if (todos.length) await expect(items(page)).toHaveCount(todos.length);
}

test('AC-7: Delete all button visible with todos, hidden without', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'Delete all', exact: true })).toBeVisible();
  await open(page, []);
  await expect(page.getByText('No todos yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete all', exact: true })).toHaveCount(0);
});

test('AC-8: clicking Delete all asks for confirmation and deletes nothing', async ({ page, request }) => {
  await open(page);
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('Delete all 3 todos? This cannot be undone.')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Delete all', exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(items(page)).toHaveCount(3);
  const res = await request.get('/api/todos');
  expect((await res.json()).length).toBe(3);
});

test('AC-9: Cancel closes the confirmation and keeps every todo after reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete all', exact: true })).toBeVisible();
  await expect(items(page)).toHaveCount(3);
  await page.reload();
  await expect(items(page)).toHaveCount(3);
});

test('AC-10: confirming empties the list, shows empty message, stays empty after reload', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByText('No todos yet')).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await page.reload();
  await expect(page.getByText('No todos yet')).toBeVisible();
  await expect(items(page)).toHaveCount(0);
});

test('AC-10: a failed delete shows the error and leaves the list unchanged', async ({ page }) => {
  await open(page);
  await page.route('**/api/todos?all=true', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(page.locator('#todo-error')).toHaveText('Could not delete all todos');
  await expect(items(page)).toHaveCount(3);
  await expect(dialog(page)).toBeHidden();
});

test('AC-11: DELETE ?all=true returns removed count and empties the list', async ({ request }) => {
  await seed(THREE);
  const res = await request.delete('/api/todos?all=true');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ removed: 3 });
  const list = await request.get('/api/todos');
  expect(await list.json()).toEqual([]);
});

test('AC-11: DELETE ?all=true on an empty list removes 0', async ({ request }) => {
  await seed([]);
  const res = await request.delete('/api/todos?all=true');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ removed: 0 });
});

for (const query of ['', '?all=false', '?all=', '?all=1', '?all=true&all=true', '?all=true&done=true', '?foo=1']) {
  test(`AC-12: DELETE /api/todos${query || ' (no query)'} gives 400 and deletes nothing`, async ({ request }) => {
    await seed(THREE);
    const res = await request.delete('/api/todos' + query);
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'Only done=true is supported' });
    const list = await request.get('/api/todos');
    expect((await list.json()).length).toBe(3);
  });
}

test('AC-12: DELETE ?done=true still removes only done todos', async ({ request }) => {
  await seed(THREE);
  const res = await request.delete('/api/todos?done=true');
  expect(res.status()).toBe(200);
  const list = await (await request.get('/api/todos')).json();
  expect(list.map((t: Todo) => t.text)).toEqual(['Alpha', 'Charlie']);
});
