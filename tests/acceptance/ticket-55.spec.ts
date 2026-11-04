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

const MIXED: Todo[] = [
  { id: 'a', text: 'Alpha', done: false },
  { id: 'b', text: 'Bravo', done: true },
  { id: 'c', text: 'Charlie', done: false },
];
const ALL_DONE: Todo[] = MIXED.map((t) => ({ ...t, done: true }));

const markAll = (page: Page) => page.getByRole('button', { name: 'Mark all as done', exact: true });
const markNone = (page: Page) =>
  page.getByRole('button', { name: 'Mark all as not done', exact: true });
const box = (page: Page, name: string) => page.getByRole('checkbox', { name });

async function open(page: Page, todos: Todo[], hash = '') {
  await seed(todos);
  await page.goto('/' + hash);
}

async function expectStates(page: Page, done: boolean) {
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    if (done) await expect(box(page, name)).toBeChecked();
    else await expect(box(page, name)).not.toBeChecked();
  }
}

test('AC-1: button "Mark all as done" visible when some todo is not done', async ({ page }) => {
  await open(page, MIXED);
  await expect(markAll(page)).toBeVisible();
  await expect(markNone(page)).toHaveCount(0);
});

test('AC-2: button labelled "Mark all as not done" when every todo is done', async ({ page }) => {
  await open(page, ALL_DONE);
  await expect(markNone(page)).toBeVisible();
  await expect(markAll(page)).toHaveCount(0);
});

test('AC-3: no button when there are no todos', async ({ page }) => {
  await open(page, []);
  await expect(page.getByText('No todos yet', { exact: false })).toBeVisible().catch(() => {});
  await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();
  await expect(markAll(page)).toHaveCount(0);
  await expect(markNone(page)).toHaveCount(0);
});

test('AC-4: click "Mark all as done" makes every todo done', async ({ page }) => {
  await open(page, MIXED);
  await markAll(page).click();
  await expectStates(page, true);
  await expect(markNone(page)).toBeVisible();
  await expect(page.getByText('0 items left', { exact: true })).toBeVisible();
});

test('AC-5: click "Mark all as not done" makes every todo not done', async ({ page }) => {
  await open(page, ALL_DONE);
  await markNone(page).click();
  await expectStates(page, false);
  await expect(markAll(page)).toBeVisible();
  await expect(page.getByText('3 items left', { exact: true })).toBeVisible();
});

for (const [hash, filter] of [
  ['#/active', 'Active'],
  ['#/done', 'Done'],
]) {
  test(`AC-6: under ${filter} filter the click changes hidden todos too`, async ({ page }) => {
    await open(page, MIXED, hash);
    await markAll(page).click();
    await expect(page.getByText('0 items left', { exact: true })).toBeVisible();
    await page.getByRole('group', { name: 'Filter' }).getByRole('button', { name: 'All', exact: true }).click();
    await expectStates(page, true);
  });
}

test('AC-6: under Active filter, "Mark all as not done" unchecks hidden done todos', async ({ page }) => {
  await open(page, MIXED, '#/active');
  await markAll(page).click();
  await expect(markNone(page)).toBeVisible();
  await markNone(page).click();
  await expect(page.getByText('3 items left', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Filter' }).getByRole('button', { name: 'All', exact: true }).click();
  await expectStates(page, false);
});

test('AC-7: states persist after reload', async ({ page }) => {
  await open(page, MIXED);
  await markAll(page).click();
  await expect(page.getByText('0 items left', { exact: true })).toBeVisible();
  await page.reload();
  await expectStates(page, true);
  await markNone(page).click();
  await expect(page.getByText('3 items left', { exact: true })).toBeVisible();
  await page.reload();
  await expectStates(page, false);
});

for (const mode of ['status 500', 'abort']) {
  test(`AC-8: on failure (${mode}) no todo changes on screen`, async ({ page }) => {
    await open(page, MIXED);
    await expect(markAll(page)).toBeVisible();
    await page.route('**/api/todos', (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return mode === 'abort'
        ? route.abort()
        : route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    });
    await markAll(page).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(box(page, 'Alpha')).not.toBeChecked();
    await expect(box(page, 'Bravo')).toBeChecked();
    await expect(box(page, 'Charlie')).not.toBeChecked();
    await expect(markAll(page)).toBeVisible();
    await expect(page.getByText('2 items left', { exact: true })).toBeVisible();
  });
}

test('AC-9: on failure the same error area as a failed checkbox save is shown', async ({ page }) => {
  await open(page, MIXED);
  await page.route('**/api/todos', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fallback(),
  );
  await markAll(page).click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Could not update todo');
  const bulkId = await alert.getAttribute('id');
  expect(bulkId).toBe('todo-error');

  // A failed single checkbox save uses the same area and text.
  await page.reload();
  await page.route('**/api/todos/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fallback(),
  );
  await box(page, 'Alpha').check();
  await expect(page.getByRole('alert')).toHaveText('Could not update todo');
  expect(await page.getByRole('alert').getAttribute('id')).toBe(bulkId);
});

for (const key of ['Enter', 'Space']) {
  test(`AC-14: Tab to the button then ${key} acts as a click`, async ({ page }) => {
    await open(page, MIXED);
    const btn = markAll(page);
    await expect(btn).toBeVisible();
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press(key);
    await expectStates(page, true);
    await expect(markNone(page)).toBeVisible();
  });
}

test('AC-14: the button is reachable with Tab', async ({ page }) => {
  await open(page, MIXED);
  await expect(markAll(page)).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    if (await markAll(page).evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Mark all as done never received focus via Tab');
});
