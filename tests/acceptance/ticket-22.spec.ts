import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

async function seed(todos: { id: string; text: string; done: boolean }[]) {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(todos));
}

test.beforeEach(async () => {
  await seed([]);
});

test('AC-1: 3 todos with 1 done shows "2 items left"', async ({ page }) => {
  await seed([
    { id: '1', text: 'One', done: true },
    { id: '2', text: 'Two', done: false },
    { id: '3', text: 'Three', done: false },
  ]);
  await page.goto('/');
  await expect(page.getByText('2 items left')).toBeVisible();
});

test('AC-1: count updates after add, check and delete without reload', async ({ page }) => {
  await seed([
    { id: '1', text: 'One', done: false },
    { id: '2', text: 'Two', done: false },
  ]);
  await page.goto('/');
  await expect(page.getByText('2 items left')).toBeVisible();

  await page.getByLabel('New todo').fill('Three');
  await page.getByLabel('New todo').press('Enter');
  await expect(page.getByText('3 items left')).toBeVisible();

  await page.getByRole('list', { name: 'Todos' }).getByRole('checkbox').first().check();
  await expect(page.getByText('2 items left')).toBeVisible();

  await page.getByRole('list', { name: 'Todos' }).getByRole('checkbox').first().uncheck();
  await expect(page.getByText('3 items left')).toBeVisible();

  await page.getByRole('list', { name: 'Todos' }).getByRole('button', { name: /delete/i }).first().click();
  await expect(page.getByText('2 items left')).toBeVisible();
});

test('AC-1: count uses "items" even for 1', async ({ page }) => {
  await seed([{ id: '1', text: 'One', done: false }]);
  await page.goto('/');
  await expect(page.getByText('1 items left')).toBeVisible();
});

test('AC-1: count is not shown when loading fails', async ({ page }) => {
  await page.route('**/api/todos', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
      : route.continue(),
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/items left/)).toBeHidden();
});

test('AC-2: with no todos it shows "0 items left"', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('0 items left')).toBeVisible();
  await expect(page.getByText('No todos yet')).toBeVisible();
});
