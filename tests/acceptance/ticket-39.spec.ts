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

const THREE: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: false },
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

// Hold PATCH responses until release() is called.
async function holdPatch(page: import('@playwright/test').Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PATCH') await gate;
    await route.continue();
  });
  return release;
}

test('AC-2: while the save is in flight the field is gone and the new text is shown', async ({
  page,
}) => {
  const release = await holdPatch(page);
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('  Alpha new  ');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  release();
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
});

test('AC-2: an in-flight save that fails brings the old text back with "Could not save"', async ({
  page,
}) => {
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 500, body: '{}', contentType: 'application/json' });
    } else await route.continue();
  });
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha new');
  await edit(page).press('Enter');
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Could not save');
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Alpha new', { exact: true })).toHaveCount(0);
});

test('AC-2: editing another todo during an in-flight save keeps focus in the new field', async ({
  page,
}) => {
  const release = await holdPatch(page);
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('Alpha new');
  await edit(page).press('Enter');
  await list(page).getByText('Bravo', { exact: true }).dblclick();
  await expect(edit(page)).toHaveValue('Bravo');
  await expect(edit(page)).toBeFocused();
  release();
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(edit(page)).toBeFocused();
});

test('AC-2: saving unchanged text clears an earlier empty-text error', async ({ page }) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('');
  await edit(page).press('Enter');
  await expect(page.getByRole('alert')).not.toBeEmpty();
  await expect(edit(page)).toHaveCount(0);
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('  Alpha ');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeEmpty();
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
});
