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
  { id: 'b', text: 'Bravo', done: false },
  { id: 'c', text: 'Charlie', done: true },
];

const list = (page: Page) => page.getByRole('list', { name: 'Todos' });
const items = (page: Page) => list(page).getByRole('listitem');
const pressed = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Filter' }).getByRole('button', { name, exact: true });

async function open(page: Page, hash: string, todos: Todo[] = MIXED) {
  await seed(todos);
  await page.goto('/' + hash);
  await expect(pressed(page, 'All')).toBeVisible();
}

for (const hash of ['', '#/active', '#/done']) {
  test(`AC-13: count shows all not-done todos under filter "${hash || 'all'}"`, async ({ page }) => {
    await open(page, hash);
    await expect(page.getByText('2 items left', { exact: true })).toBeVisible();
  });
}

test('AC-14: marking a todo done under Active removes it and lowers the count', async ({ page }) => {
  await open(page, '#/active');
  await expect(items(page)).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Alpha' }).check();
  await expect(items(page)).toHaveCount(1);
  await expect(list(page).getByText('Alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1 items left', { exact: true })).toBeVisible();
  await expect(pressed(page, 'Active')).toHaveAttribute('aria-pressed', 'true');
});

test('AC-15: marking a todo not done under Done removes it and raises the count', async ({ page }) => {
  await open(page, '#/done');
  await expect(items(page)).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Charlie' }).uncheck();
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByText('3 items left', { exact: true })).toBeVisible();
  await expect(pressed(page, 'Done')).toHaveAttribute('aria-pressed', 'true');
});

test('AC-16: adding under Done saves it, raises the count, hides it, keeps the filter', async ({ page }) => {
  await open(page, '#/done');
  await page.getByRole('textbox', { name: 'New todo' }).fill('Delta');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('3 items left', { exact: true })).toBeVisible();
  await expect(list(page).getByText('Delta')).toHaveCount(0);
  await expect(items(page)).toHaveCount(1);
  expect(new URL(page.url()).hash).toBe('#/done');
  await expect(pressed(page, 'Done')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/active');
  await page.reload();
  await expect(list(page).getByText('Delta', { exact: true })).toBeVisible();
});

test('AC-17: adding under Active shows the new todo', async ({ page }) => {
  await open(page, '#/active');
  await page.getByRole('textbox', { name: 'New todo' }).fill('Delta');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(list(page).getByText('Delta', { exact: true })).toBeVisible();
  await expect(items(page)).toHaveCount(3);
  await expect(page.getByText('3 items left', { exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/active');
});

test('AC-18: Done with none done gives a blank list, no message, controls visible', async ({ page }) => {
  await open(page, '#/done', [{ id: 'a', text: 'Alpha', done: false }]);
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByText('No todos yet')).toHaveCount(0);
  await expect(page.getByText(/no (todos|matches|items)/i)).toHaveCount(0);
  await expect(pressed(page, 'All')).toBeVisible();
  await expect(pressed(page, 'Active')).toBeVisible();
  await expect(pressed(page, 'Done')).toBeVisible();
  await expect(page.getByText('1 items left', { exact: true })).toBeVisible();
});

test('AC-18: Active with all done gives a blank list, no message, controls visible', async ({ page }) => {
  await open(page, '#/active', [{ id: 'c', text: 'Charlie', done: true }]);
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByText('No todos yet')).toHaveCount(0);
  await expect(page.getByText(/no (todos|matches|items)/i)).toHaveCount(0);
  await expect(pressed(page, 'Active')).toBeVisible();
  await expect(page.getByText('0 items left', { exact: true })).toBeVisible();
});
