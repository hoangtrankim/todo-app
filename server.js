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
    const todos = JSON.parse(await readFile(todosFile(), 'utf8'));
    if (!Array.isArray(todos)) throw new Error('Todos file is not a JSON array');
    return todos;
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

// The body must be a JSON object; unparsable JSON and non-object JSON (a bare
// string, number, array or null) are both rejected as invalid.
async function readJsonObject(req) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Invalid JSON');
  }
  return body;
}

async function handleTodos(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, (await readTodos()).filter(isTodo));
  }
  if (req.method === 'POST') {
    const body = await readJsonObject(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, EMPTY_ERROR);
    const todo = { id: randomUUID(), text, done: false };
    await updateTodos((todos) => todos.push(todo));
    return sendJson(res, 201, todo);
  }
  sendJson(res, 405, { error: 'Method not allowed' }, { allow: 'GET, POST' });
}

// The file is hand-editable, so skip entries that are not objects (e.g. null).
function isTodo(t) {
  return typeof t === 'object' && t !== null;
}

async function handleTodo(req, res, id) {
  if (req.method === 'PATCH') {
    const body = await readJsonObject(req);
    if (typeof body.done !== 'boolean') throw new HttpError(400, 'done must be true or false');
    // Throwing inside the update skips the write, so an unknown id changes nothing.
    const todo = await updateTodos((todos) => {
      const found = todos.find((t) => isTodo(t) && t.id === id);
      if (!found) throw new HttpError(404, 'Todo not found');
      found.done = body.done;
      return found;
    });
    return sendJson(res, 200, todo);
  }
  if (req.method === 'DELETE') {
    // The body is never read. Only the todo with this exact id is removed; an
    // unknown id throws, which skips the write.
    await updateTodos((todos) => {
      const index = todos.findIndex((t) => isTodo(t) && t.id === id);
      if (index === -1) throw new HttpError(404, 'Todo not found');
      todos.splice(index, 1);
    });
    res.writeHead(204).end();
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' }, { allow: 'PATCH, DELETE' });
}

const TODO_PATH = /^\/api\/todos\/([^/]+)$/;

async function handleApi(req, res, pathname) {
  if (pathname === '/api/todos') return handleTodos(req, res);
  const match = TODO_PATH.exec(pathname);
  if (match) {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      throw new HttpError(404, 'Todo not found');
    }
    return handleTodo(req, res, id);
  }
  throw new HttpError(404, 'Not found');
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
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return serveStatic(pathname, res);
    try {
      await handleApi(req, res, pathname);
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
  // Exit cleanly on a stop signal so Node writes test coverage (NODE_V8_COVERAGE) before it quits.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
}
