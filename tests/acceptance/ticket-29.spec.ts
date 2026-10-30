import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };

async function seed(todos: Todo[]) {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(todos));
}

async function stored(): Promise<Todo[]> {
  return JSON.parse(await readFile(TODOS_FILE, 'utf8'));
}

const THREE: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: false },
  { id: 'c', text: 'Charlie', done: false },
];

test.beforeEach(async () => {
  await seed([]);
});

test('AC-1: a todo marked done in another tab is gone after Clear completed, without reload', async ({
  page,
  request,
}) => {
  await seed(THREE);
  await page.goto('/');
  const list = page.getByRole('list', { name: 'Todos' });
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // "Tab B": another client marks Alpha done; this page still thinks it is not done.
  const patch = await request.patch('/api/todos/a', { data: { done: true } });
  expect(patch.status()).toBeLessThan(300);
  expect((await stored()).find((t) => t.id === 'a')?.done).toBe(true);

  // Tab A marks Bravo done and clears.
  await list.getByRole('listitem').filter({ hasText: 'Bravo' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Clear completed' }).click();

  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('Charlie')).toBeVisible();
  await expect(list.getByText('Alpha')).toHaveCount(0);
  await expect(list.getByText('Bravo')).toHaveCount(0);
  await expect(page.getByText('1 items left')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear completed' })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'New todo' })).toBeFocused();
  expect(await stored()).toEqual([{ id: 'c', text: 'Charlie', done: false }]);
});

test('AC-1: a todo marked not done in another tab stays listed after Clear completed', async ({
  page,
  request,
}) => {
  await seed([
    { id: 'a', text: 'Alpha', done: true },
    { id: 'b', text: 'Bravo', done: true },
    { id: 'c', text: 'Charlie', done: false },
  ]);
  await page.goto('/');
  const list = page.getByRole('list', { name: 'Todos' });
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // Another client un-does Alpha; this page still shows it as done.
  const patch = await request.patch('/api/todos/a', { data: { done: false } });
  expect(patch.status()).toBeLessThan(300);

  await page.getByRole('button', { name: 'Clear completed' }).click();

  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Alpha');
  await expect(items.nth(1)).toContainText('Charlie');
  await expect(list.getByText('Bravo')).toHaveCount(0);
  await expect(page.getByText('2 items left')).toBeVisible();
});

test('AC-1: after a successful clear the list is re-read from GET /api/todos', async ({ page }) => {
  await seed([
    { id: 'a', text: 'Alpha', done: true },
    { id: 'b', text: 'Bravo', done: false },
  ]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Clear completed' })).toBeVisible();
  const refresh = page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/todos' && res.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Clear completed' }).click();
  expect((await refresh).status()).toBe(200);
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(1);
});

test('AC-1: when the refresh fails after a clear, an alert shows and the list is left as it was', async ({
  page,
}) => {
  await seed([
    { id: 'a', text: 'Alpha', done: true },
    { id: 'b', text: 'Bravo', done: false },
    { id: 'c', text: 'Charlie', done: true },
  ]);
  await page.goto('/');
  const list = page.getByRole('list', { name: 'Todos' });
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // Fail only GETs of the list from now on; the DELETE goes through.
  await page.route('**/api/todos', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Clear completed' }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not refresh todos');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByText('Alpha')).toBeVisible();
  await expect(list.getByText('Charlie')).toBeVisible();
  // The server did delete them.
  expect(await stored()).toEqual([{ id: 'b', text: 'Bravo', done: false }]);
});

test('AC-1: when the clear itself fails, the list is unchanged and the clear error shows', async ({
  page,
}) => {
  const todos: Todo[] = [
    { id: 'a', text: 'Alpha', done: true },
    { id: 'b', text: 'Bravo', done: false },
  ];
  await seed(todos);
  await page.route('**/api/todos?*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
      : route.continue(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Clear completed' }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not clear completed todos');
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(2);
  expect(await stored()).toEqual(todos);
});
