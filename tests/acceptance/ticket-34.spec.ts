import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };

const SEED: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
];

async function stored(): Promise<Todo[]> {
  return JSON.parse(await readFile(TODOS_FILE, 'utf8'));
}

const list = (page: Page) => page.getByRole('list', { name: 'Todos' });
const edit = (page: Page) => page.getByRole('textbox', { name: 'Edit todo' });

test.beforeEach(async ({ page }) => {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(SEED));
  await page.goto('/');
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
});

test('AC-7: clearing the text and pressing Enter keeps old text and shows the error', async ({
  page,
}) => {
  let patches = 0;
  await page.route('**/api/todos/*', (r) => {
    if (r.request().method() === 'PATCH') patches++;
    return r.continue();
  });
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('');
  await edit(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveText("Todo can't be empty");
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
  expect(patches).toBe(0);
  expect(await stored()).toEqual(SEED);
});

test('AC-8: only spaces and click away keeps old text and shows the error', async ({ page }) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('     ');
  await page.getByRole('heading').first().click();
  await expect(page.getByRole('alert')).toHaveText("Todo can't be empty");
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
  expect(await stored()).toEqual(SEED);
});

test('AC-9: text with surrounding spaces is saved and shown trimmed, and kept', async ({
  page,
}) => {
  await list(page).getByText('Alpha', { exact: true }).dblclick();
  await edit(page).fill('   Alpha new   ');
  await edit(page).press('Enter');
  await expect(edit(page)).toHaveCount(0);
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
  await expect(page.getByText("Todo can't be empty")).toBeHidden();
  await expect(page.getByText('Could not save')).toBeHidden();
  await expect.poll(async () => (await stored())[0].text).toBe('Alpha new');
  await page.reload();
  await expect(list(page).getByText('Alpha new', { exact: true })).toBeVisible();
});

for (const mode of ['abort', '500'] as const) {
  test(`AC-12: failed save (${mode}) shows old text, no field, "Could not save"`, async ({
    page,
  }) => {
    await page.route('**/api/todos/*', (r) => {
      if (r.request().method() !== 'PATCH') return r.continue();
      return mode === 'abort'
        ? r.abort()
        : r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' });
    });
    await list(page).getByText('Alpha', { exact: true }).dblclick();
    await edit(page).fill('Changed');
    await edit(page).press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Could not save');
    await expect(edit(page)).toHaveCount(0);
    await expect(list(page).getByText('Alpha', { exact: true })).toBeVisible();
    await expect(list(page).getByText('Changed')).toHaveCount(0);
    expect(await stored()).toEqual(SEED);
  });
}
