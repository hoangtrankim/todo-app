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
  { id: 'a', text: 'Alpha', done: true },
  { id: 'b', text: 'Bravo', done: false },
  { id: 'c', text: 'Charlie', done: true },
];

test.beforeEach(async () => {
  await seed([]);
});

test.describe('UI', () => {
  test('AC-1: clicking Clear completed leaves only the todo that is not done', async ({ page }) => {
    await seed(THREE);
    await page.goto('/');
    const list = page.getByRole('list', { name: 'Todos' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByText('Bravo')).toBeVisible();
    await expect(list.getByText('Alpha')).toHaveCount(0);
    await expect(list.getByText('Charlie')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'New todo' })).toBeFocused();
  });

  test('AC-1: todos that are not done keep their order', async ({ page }) => {
    await seed([
      { id: '1', text: 'One', done: false },
      { id: '2', text: 'Two', done: true },
      { id: '3', text: 'Three', done: false },
      { id: '4', text: 'Four', done: true },
      { id: '5', text: 'Five', done: false },
    ]);
    await page.goto('/');
    await page.getByRole('button', { name: 'Clear completed' }).click();
    const items = page.getByRole('list', { name: 'Todos' }).getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('One');
    await expect(items.nth(1)).toContainText('Three');
    await expect(items.nth(2)).toContainText('Five');
  });

  test('AC-1: when every todo is done, clearing empties the list', async ({ page }) => {
    await seed([
      { id: '1', text: 'One', done: true },
      { id: '2', text: 'Two', done: true },
    ]);
    await page.goto('/');
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('0 items left')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeHidden();
  });

  test('AC-1: failure shows an alert and leaves the list unchanged', async ({ page }) => {
    await seed(THREE);
    await page.route('**/api/todos?*', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
        : route.continue(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.getByRole('alert')).toHaveText('Could not clear completed todos');
    await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(3);
    expect(await stored()).toEqual(THREE);
  });

  test('AC-1: network failure shows an alert and leaves the list unchanged', async ({ page }) => {
    await seed(THREE);
    await page.route('**/api/todos?*', (route) =>
      route.request().method() === 'DELETE' ? route.abort() : route.continue(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.getByRole('alert')).toHaveText('Could not clear completed todos');
    await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(3);
  });

  test('AC-2: cleared todos are still gone after a reload', async ({ page }) => {
    await seed(THREE);
    await page.goto('/');
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(1);
    await page.reload();
    const list = page.getByRole('list', { name: 'Todos' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByText('Bravo')).toBeVisible();
    expect(await stored()).toEqual([{ id: 'b', text: 'Bravo', done: false }]);
  });

  test('AC-3: no Clear completed button when no todo is done', async ({ page }) => {
    await seed([
      { id: '1', text: 'One', done: false },
      { id: '2', text: 'Two', done: false },
    ]);
    await page.goto('/');
    await expect(page.getByText('2 items left')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeHidden();
  });

  test('AC-3: no Clear completed button when the list is empty', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('0 items left')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeHidden();
  });

  test('AC-3: the button appears once a todo is marked done', async ({ page }) => {
    await seed([{ id: '1', text: 'One', done: false }]);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeHidden();
    await page.getByRole('list', { name: 'Todos' }).getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeVisible();
  });

  test('AC-4: unchecking the only done todo hides the button', async ({ page }) => {
    await seed([
      { id: '1', text: 'One', done: true },
      { id: '2', text: 'Two', done: false },
    ]);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeVisible();
    await page.getByRole('list', { name: 'Todos' }).getByRole('checkbox').first().uncheck();
    await expect(page.getByRole('button', { name: 'Clear completed' })).toBeHidden();
  });

  test('AC-5: the count shows the todos not done after clearing', async ({ page }) => {
    await seed(THREE);
    await page.goto('/');
    await expect(page.getByText('1 items left')).toBeVisible();
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('1 items left')).toBeVisible();
  });

  test('AC-5: the count with several not-done todos is unchanged by clearing', async ({ page }) => {
    await seed([
      { id: '1', text: 'One', done: false },
      { id: '2', text: 'Two', done: true },
      { id: '3', text: 'Three', done: false },
      { id: '4', text: 'Four', done: false },
    ]);
    await page.goto('/');
    await expect(page.getByText('3 items left')).toBeVisible();
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('3 items left')).toBeVisible();
  });
});

test.describe('API', () => {
  test('AC-1: DELETE /api/todos?done=true removes only done todos', async ({ request }) => {
    await seed(THREE);
    const res = await request.delete('/api/todos?done=true');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ removed: 2 });
    const list = await (await request.get('/api/todos')).json();
    expect(list).toEqual([{ id: 'b', text: 'Bravo', done: false }]);
  });

  test('AC-2: the removal is written to the data file', async ({ request }) => {
    await seed(THREE);
    await request.delete('/api/todos?done=true');
    expect(await stored()).toEqual([{ id: 'b', text: 'Bravo', done: false }]);
  });

  test('AC-1: with no done todos it answers 200 removed 0 and deletes nothing', async ({
    request,
  }) => {
    const todos = [{ id: 'x', text: 'X', done: false }];
    await seed(todos);
    const res = await request.delete('/api/todos?done=true');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ removed: 0 });
    expect(await stored()).toEqual(todos);
  });

  for (const query of ['', '?done=false', '?done=1', '?done=TRUE', '?foo=bar', '?done=']) {
    test(`AC-1: DELETE /api/todos${query || ' (no query)'} answers 400 and deletes nothing`, async ({
      request,
    }) => {
      await seed(THREE);
      const res = await request.delete(`/api/todos${query}`);
      expect(res.status()).toBe(400);
      expect(await res.json()).toEqual({ error: 'Only done=true is supported' });
      expect(await stored()).toEqual(THREE);
    });
  }

  test('AC-1: other methods on /api/todos still answer 405 and allow lists DELETE', async ({
    request,
  }) => {
    const res = await request.put('/api/todos');
    expect(res.status()).toBe(405);
    expect(res.headers()['allow']).toBe('GET, POST, DELETE');
  });

  test('AC-1: DELETE /api/todos/:id still removes a single todo', async ({ request }) => {
    await seed(THREE);
    const res = await request.delete('/api/todos/b');
    expect(res.status()).toBeLessThan(300);
    expect((await stored()).map((t) => t.id)).toEqual(['a', 'c']);
  });
});
