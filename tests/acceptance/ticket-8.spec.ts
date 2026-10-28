import { expect, test } from '@playwright/test';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT ?? 3000);
const TODOS_FILE =
  process.env.TODOS_FILE ?? path.join(os.tmpdir(), 'todo-app-test', 'todos.json');

type Todo = { id: string; text: string; done: boolean };
const SEED: Todo[] = [
  { id: 'a', text: 'Buy milk', done: false },
  { id: 'b', text: 'Walk dog', done: true },
];

test.beforeEach(async () => {
  await mkdir(path.dirname(TODOS_FILE), { recursive: true });
  await writeFile(TODOS_FILE, JSON.stringify(SEED));
});

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };

// node:http lets us set any Host header (fetch forbids it). host === null sends no Host header.
function raw(
  method: string,
  urlPath: string,
  host: string | null,
  extra: Record<string, string> = {},
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...extra };
    if (host !== null) headers.Host = host;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path: urlPath, headers, setHost: false },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function stored(): Promise<Todo[]> {
  return JSON.parse(await readFile(TODOS_FILE, 'utf8'));
}

const GOOD_HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `LOCALHOST:${PORT}`];
const BAD_HOSTS = ['evil.example', `evil.example:${PORT}`, 'localhost', `localhost:${PORT + 1}`, `127.0.0.1:${PORT + 1}`];

test.describe('AC-5: delete only for the local user', () => {
  test('AC-5: foreign Host DELETE is refused with 403 and the todo stays', async () => {
    const res = await raw('DELETE', '/api/todos/a', 'evil.example', { Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
    expect(await stored()).toEqual(SEED);
  });

  for (const host of BAD_HOSTS) {
    test(`AC-5: Host "${host}" is refused on every method and writes nothing`, async () => {
      for (const [method, p, body] of [
        ['GET', '/api/todos', undefined],
        ['POST', '/api/todos', JSON.stringify({ text: 'Hacked' })],
        ['PATCH', '/api/todos/a', JSON.stringify({ done: true })],
        ['DELETE', '/api/todos/a', undefined],
        ['OPTIONS', '/api/todos', undefined],
      ] as const) {
        const res = await raw(method, p, host, {}, body);
        expect(res.status, `${method} ${p}`).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden host' });
      }
      expect(await stored()).toEqual(SEED);
    });
  }

  test('AC-5: a request with no Host header is refused', async () => {
    const res = await raw('DELETE', '/api/todos/a', null, {});
    // HTTP/1.1 without Host may be rejected by Node itself (400); either way nothing is deleted.
    expect([400, 403]).toContain(res.status);
    expect(await stored()).toEqual(SEED);
  });

  for (const host of GOOD_HOSTS) {
    test(`AC-5: Host "${host}" can still delete (204) and list`, async () => {
      const list = await raw('GET', '/api/todos', host);
      expect(list.status).toBe(200);
      expect(JSON.parse(list.body)).toEqual(SEED);
      const del = await raw('DELETE', '/api/todos/a', host);
      expect(del.status).toBe(204);
      expect(await stored()).toEqual([SEED[1]]);
    });
  }

  test('AC-5: unknown id with an allowed Host is still 404', async () => {
    const res = await raw('DELETE', '/api/todos/nope', `localhost:${PORT}`);
    expect(res.status).toBe(404);
  });

  test('AC-5: static files are not host-checked', async () => {
    const res = await raw('GET', '/', 'evil.example');
    expect(res.status).toBe(200);
  });

  test('AC-5: Delete button in the UI still removes the todo at once', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Buy milk', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Buy milk' }).click();
    await expect(page.getByText('Buy milk', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Walk dog', { exact: true })).toBeVisible();
  });

  test('AC-5: server is not reachable on a non-loopback interface by default', async () => {
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    test.skip(!external, 'no non-loopback IPv4 address on this machine');
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const req = http.request(
        { host: external!.address, port: PORT, path: '/api/todos', method: 'GET', timeout: 3000 },
        (res) => {
          res.resume();
          resolve(null);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve(e as NodeJS.ErrnoException));
      req.end();
    });
    expect(err, 'connection to the LAN address should fail').not.toBeNull();
  });
});

test.describe('AC-5: no CORS headers (cross-site deletes stay blocked)', () => {
  const cases: [string, string, string | undefined][] = [
    ['GET', '/api/todos', undefined],
    ['POST', '/api/todos', JSON.stringify({ text: 'New' })],
    ['PATCH', '/api/todos/a', JSON.stringify({ done: true })],
    ['DELETE', '/api/todos/a', undefined],
    ['DELETE', '/api/todos/missing', undefined],
    ['OPTIONS', '/api/todos', undefined],
    ['OPTIONS', '/api/todos/a', undefined],
  ];
  for (const [method, p, body] of cases) {
    test(`AC-5: ${method} ${p} with a foreign Origin has no Access-Control-* header`, async () => {
      const res = await raw(method, p, `localhost:${PORT}`, { Origin: 'http://evil.example' }, body);
      const cors = Object.keys(res.headers).filter((h) => h.startsWith('access-control-'));
      expect(cors).toEqual([]);
    });
  }

  test('AC-5: preflight for a cross-site DELETE gets no CORS approval', async () => {
    const res = await raw('OPTIONS', '/api/todos/a', `localhost:${PORT}`, {
      Origin: 'http://evil.example',
      'Access-Control-Request-Method': 'DELETE',
    });
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('AC-5: the 403 response carries no Access-Control-* header either', async () => {
    const res = await raw('DELETE', '/api/todos/a', 'evil.example', { Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});
