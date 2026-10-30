import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

async function seed() {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(
    TODOS_FILE,
    JSON.stringify([
      { id: 'a', text: 'Alpha open', done: false },
      { id: 'b', text: 'Bravo done', done: true },
      { id: 'c', text: 'Charlie open', done: false },
      { id: 'd', text: 'Delta done', done: true },
    ]),
  );
}

const OPEN = ['Alpha open', 'Charlie open'];
const DONE = ['Bravo done', 'Delta done'];

test.beforeEach(async () => {
  await seed();
});

const list = (page: Page) => page.getByRole('list', { name: 'Todos' });
const btn = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Filter' }).getByRole('button', { name, exact: true });

async function expectListed(page: Page, texts: string[]) {
  await expect(list(page).getByRole('listitem')).toHaveCount(texts.length);
  for (const t of [...OPEN, ...DONE]) {
    const loc = list(page).getByText(t, { exact: true });
    if (texts.includes(t)) await expect(loc).toBeVisible();
    else await expect(loc).toHaveCount(0);
  }
}

async function expectPressed(page: Page, name: string) {
  for (const n of ['All', 'Active', 'Done']) {
    await expect(btn(page, n)).toHaveAttribute('aria-pressed', n === name ? 'true' : 'false');
  }
}

async function markPage(page: Page) {
  await page.evaluate(() => ((window as unknown as { __m: number }).__m = 1));
}
async function stillSamePage(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __m?: number }).__m)).toBe(1);
}

test('AC-1: no hash lists every todo with All pressed', async ({ page }) => {
  await page.goto('/');
  await expectListed(page, [...OPEN, ...DONE]);
  await expectPressed(page, 'All');
});

test('AC-2: clicking Active lists only not-done todos', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'Active').click();
  await expectListed(page, OPEN);
});

test('AC-3: clicking Done lists only done todos', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'Done').click();
  await expectListed(page, DONE);
});

test('AC-4: from Active, clicking All lists every todo', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'Active').click();
  await expectListed(page, OPEN);
  await btn(page, 'All').click();
  await expectListed(page, [...OPEN, ...DONE]);
});

test('AC-5: selected button is pressed, others are not, and it looks pressed', async ({ page }) => {
  await page.goto('/');
  await expectPressed(page, 'All');
  await btn(page, 'Active').click();
  await expectPressed(page, 'Active');
  await btn(page, 'Done').click();
  await expectPressed(page, 'Done');
  const style = (name: string) =>
    btn(page, name).evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.fontWeight}|${s.borderTopColor}|${s.borderTopWidth}|${s.backgroundColor}`;
    });
  expect(await style('Done')).not.toBe(await style('Active'));
  const weight = (name: string) => btn(page, name).evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(await weight('Done')).toBeGreaterThan(await weight('Active'));
});

test('AC-6: clicking Active sets hash #/active without reload', async ({ page }) => {
  await page.goto('/');
  await markPage(page);
  await btn(page, 'Active').click();
  await expect(page).toHaveURL(/#\/active$/);
  await stillSamePage(page);
});

test('AC-7: clicking Done sets hash #/done without reload', async ({ page }) => {
  await page.goto('/');
  await markPage(page);
  await btn(page, 'Done').click();
  await expect(page).toHaveURL(/#\/done$/);
  await stillSamePage(page);
});

test('AC-8: clicking All sets hash #/ or empty without reload', async ({ page }) => {
  await page.goto('/#/done');
  await markPage(page);
  await btn(page, 'All').click();
  await expect.poll(() => new URL(page.url()).hash).toMatch(/^(#\/)?$/);
  await expectListed(page, [...OPEN, ...DONE]);
  await stillSamePage(page);
});

test('AC-9: Done survives a reload', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'Done').click();
  await page.reload();
  await expectPressed(page, 'Done');
  await expectListed(page, DONE);
});

test('AC-10: Active survives a reload', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'Active').click();
  await page.reload();
  await expectPressed(page, 'Active');
  await expectListed(page, OPEN);
});

for (const hash of ['', '#/', '#/banana']) {
  test(`AC-11: hash "${hash}" shows All and leaves the hash unchanged`, async ({ page }) => {
    await page.goto('/' + hash);
    await expectListed(page, [...OPEN, ...DONE]);
    await expectPressed(page, 'All');
    expect(new URL(page.url()).hash).toBe(hash);
  });
}

test('AC-12: back, forward and hand-edited hash update list and button', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'Active').click();
  await expectListed(page, OPEN);
  await btn(page, 'Done').click();
  await expectListed(page, DONE);

  await page.goBack();
  await expectListed(page, OPEN);
  await expectPressed(page, 'Active');
  await page.goForward();
  await expectListed(page, DONE);
  await expectPressed(page, 'Done');

  await page.evaluate(() => (location.hash = '#/active'));
  await expectListed(page, OPEN);
  await expectPressed(page, 'Active');
  await page.evaluate(() => (location.hash = '#/banana'));
  await expectListed(page, [...OPEN, ...DONE]);
  await expectPressed(page, 'All');
});

test('AC-19: three real buttons in order, above the list, keyboard operable', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Filter' });
  await expect(group.getByRole('button')).toHaveText(['All', 'Active', 'Done']);
  const g = await group.boundingBox();
  const l = await list(page).boundingBox();
  expect(g!.y + g!.height).toBeLessThanOrEqual(l!.y);

  await btn(page, 'Active').focus();
  await expect(btn(page, 'Active')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectListed(page, OPEN);
  await expectPressed(page, 'Active');

  await btn(page, 'Done').focus();
  await page.keyboard.press('Space');
  await expectListed(page, DONE);
  await expectPressed(page, 'Done');

  // reachable by Tab
  await btn(page, 'All').focus();
  await page.keyboard.press('Tab');
  await expect(btn(page, 'Active')).toBeFocused();
});
