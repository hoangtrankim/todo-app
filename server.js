// Minimal static server plus a small JSON API for todos. Plain node:http, no framework.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const root = join(appDir, 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const MAX_BODY = 10 * 1024;
const EMPTY_ERROR = "Todo can't be empty";

function todosFile() {
  return resolve(appDir, process.env.TODOS_FILE ?? join('data', 'todos.json'));
}

// Re-read on every request (no cache) so tests can reset state by rewriting the file.
// A missing file is an empty list; a corrupt file throws instead of being overwritten.
export async function readTodos() {
  try {
    return JSON.parse(await readFile(todosFile(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function writeTodos(todos) {
  const file = todosFile();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(todos, null, 2));
  await rename(tmp, file);
}

// All read-modify-write updates go through one chain so concurrent POSTs never lose a todo.
let writeChain = Promise.resolve();
function updateTodos(fn) {
  const next = writeChain.then(async () => {
    const todos = await readTodos();
    const result = fn(todos);
    await writeTodos(todos);
    return result;
  });
  writeChain = next.catch(() => {});
  return next;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

async function handleTodos(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, await readTodos());
  }
  if (req.method === 'POST') {
    const raw = await readBody(req);
    // The body must be a JSON object; unparsable JSON and non-object JSON (a bare
    // string, number, array or null) are both rejected as invalid.
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'Invalid JSON');
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, EMPTY_ERROR);
    const todo = { id: randomUUID(), text, done: false };
    await updateTodos((todos) => todos.push(todo));
    return sendJson(res, 201, todo);
  }
  sendJson(res, 405, { error: 'Method not allowed' }, { allow: 'GET, POST' });
}

async function serveStatic(pathname, res) {
  const path = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

export function start(port = Number(process.env.PORT ?? 3000)) {
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    if (pathname !== '/api/todos') return serveStatic(pathname, res);
    try {
      await handleTodos(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message }, err.status === 413 ? { connection: 'close' } : {});
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
  return new Promise((resolveServer) => server.listen(port, () => resolveServer(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then((s) => console.log(`Listening on http://localhost:${s.address().port}`));
}
