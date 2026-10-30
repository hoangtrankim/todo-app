import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE = process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

test('text typed in a newer edit survives the earlier save answering', async ({ page }) => {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(
    TODOS_FILE,
    JSON.stringify([
      { id: 'a', text: 'Alpha', done: false },
      { id: 'b', text: 'Bravo', done: false },
    ]),
  );
  let release = () => {};
  const gate = new Promise((resolve) => (release = () => resolve(undefined)));
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PATCH') await gate;
    await route.continue();
  });
  await page.goto('/');
  const edit = page.getByRole('textbox', { name: 'Edit todo' });

  await page.getByText('Alpha', { exact: true }).dblclick();
  await edit.fill('Alpha new');
  await edit.press('Enter');
  await page.getByText('Bravo', { exact: true }).dblclick();
  await edit.fill('Bravo typed');
  release();

  await expect(page.getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(edit).toHaveValue('Bravo typed');
  await expect(edit).toBeFocused();
});
