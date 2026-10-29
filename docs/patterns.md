# Patterns

The house design patterns of todo-app. The designer names the ones a ticket uses in its design note; the builder follows them; the reviewer sends a PR back as `design` when it ignores or bypasses one. Add or change an entry only through a design note's **New pattern** or **Changed pattern**, in this shape:

```markdown
## Name
Where: the file and functions that hold it.
Use when: the situation that calls for it.
Rule: what code must do, and what it must not.
```

## Storage module

Where: `server.js`, `todosFile`, `readTodos`, `writeTodos`.
Use when: any code reads or writes todos.
Rule: go through these functions only. Never touch the data file with `fs` anywhere else. The file path comes from `TODOS_FILE`, so tests can point each run at its own file. Writes go to a temp file and are renamed into place. A missing file is an empty list; a corrupt file throws and is never overwritten.

## Serialized update

Where: `server.js`, `updateTodos(fn)`.
Use when: a request changes stored todos (create, update, delete).
Rule: do the read-modify-write inside `updateTodos`, never as a separate `readTodos` then `writeTodos`, so concurrent requests cannot lose a change. To reject a change, throw inside `fn`: that skips the write.

## HttpError

Where: `server.js`, `class HttpError` and the `catch` in `start`.
Use when: a request must fail with a client error status (4xx).
Rule: throw `new HttpError(status, message)`; the one handler in `start` turns it into `{ "error": message }` with that status. Anything else thrown is logged and becomes a 500. Handlers do not write error responses themselves, except `405` with an `allow` header.

## Validate at the edge

Where: `server.js`, `readJsonObject`, `requireJson`, `isTodo`.
Use when: a handler reads a request body, or reads stored entries.
Rule: writes read their body with `readJsonObject` (JSON content type, size limit, must be an object), then check each field they use before any storage call. Stored entries are filtered with `isTodo`, since the file is hand-editable.

## Thin route handlers

Where: `server.js`, `handleApi` routes to `handleTodos` (collection) and `handleTodo` (one item), one branch per method.
Use when: adding an API route or method.
Rule: `handleApi` only matches the path. A handler validates, calls storage, and sends the response with `sendJson`; shared steps (parsing, finding a todo) become small functions, not copies. An unsupported method answers `405` with an `allow` header.

## Render from state

Where: `public/app.js`, the `todos` array, `render`, `renderTodo`.
Use when: the page shows or changes todos.
Rule: update `todos` from the server's answer, then call `render()`, which rebuilds the list from `todos`. Do not edit list items in place. Set user text with `textContent`, never `innerHTML`. After a re-render, put focus back with `focusIn`.

## One error box

Where: `public/app.js`, `showError`, `clearError`, element `#todo-error`.
Use when: a page action fails or input is invalid.
Rule: show the message with `showError` and clear it with `clearError` on the next success. Log the cause with `console.error`; never swallow a failed request silently.
