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
  { id: 'b', text: 'Bravo', done: true },
  { id: 'c', text: 'Charlie', done: false },
];

test.beforeEach(async ({ page }) => {
  await seed(THREE);
  await page.goto('/');
  await expect(page.getByRole('list', { name: 'Todos' }).getByRole('listitem')).toHaveCount(3);
});

const list = (page: import('@playwright/test').Page) => page.getByRole('list', { name: 'Todos' });
const edit = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Edit todo' });

test('AC-1: double-click turns the text into a field holding the current text', async ({
  page,
}) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await expect(edit(page)).toHaveCount(1);
  await expect(edit(page)).toHaveValue('Alpha');
  await expect(edit(page)).toBeFocused();
});

test('AC-2: changing the text and pressing Enter shows the new text, field gone', async ({
  page,
}) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha two');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha two', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Alpha', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await stored()).find((t) => t.id === 'a')?.text).toBe('Alpha two');
});

test('AC-3: changing the text and clicking elsewhere shows the new text, field gone', async ({
  page,
}) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha blur');
  await page.getByRole('heading').first().click();
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha blur', { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored()).find((t) => t.id === 'a')?.text).toBe('Alpha blur');
});

test('AC-4: after saving, a reload shows the new text', async ({ page }) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha saved');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await page.reload();
  await expect(list(page).getByText('Alpha saved', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Alpha', { exact: true })).toHaveCount(0);
});

test('AC-5: Escape shows the old text, field gone', async ({ page }) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Never saved');
  await edit(page).press('Escape');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Never saved')).toHaveCount(0);
});

test('AC-6: after Escape, a reload shows the old text', async ({ page }) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Never saved');
  await edit(page).press('Escape');
  await expect(edit(page)).toHaveCount(0);
  await page.reload();
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Never saved')).toHaveCount(0);
  expect((await stored()).find((t) => t.id === 'a')?.text).toBe('Alpha');
});

test('AC-10: saving without changes closes the field and keeps the text', async ({ page }) => {
  let patches = 0;
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches++;
  });
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Alpha');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
  expect(patches).toBe(0);
  expect((await stored()).find((t) => t.id === 'a')?.text).toBe('Alpha');
});

test('AC-11: a completed todo edited with Enter shows new text and stays completed', async ({
  page,
}) => {
  await list(page).getByText('Bravo', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Bravo');
  await edit(page).fill('Bravo edited');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Bravo edited', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Bravo edited' })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Bravo edited' })).toBeChecked();
  const b = (await stored()).find((t) => t.id === 'b');
  expect(b).toEqual({ id: 'b', text: 'Bravo edited', done: true });
});

test('AC-13: editing one todo changes no other todo', async ({ page }) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha changed');
  await edit(page).press('Enter');
  await expect(list(page).getByText('Alpha changed', { exact: true })).toBeVisible();
  const items = list(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText('Bravo');
  await expect(items.nth(2)).toContainText('Charlie');
  await expect(page.getByRole('checkbox', { name: 'Bravo' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Charlie' })).not.toBeChecked();
  expect(await stored()).toEqual([
    { id: 'a', text: 'Alpha changed', done: false },
    { id: 'b', text: 'Bravo', done: true },
    { id: 'c', text: 'Charlie', done: false },
  ]);
});
