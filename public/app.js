// Todo list page: fetch, render, add. Text is always set with textContent (never innerHTML).
const EMPTY_ERROR = "Todo can't be empty";

const form = document.getElementById('new-todo-form');
const input = /** @type {HTMLInputElement} */ (document.getElementById('new-todo'));
const errorBox = document.getElementById('todo-error');
const countMessage = document.getElementById('todo-count');
const emptyMessage = document.getElementById('empty-message');
const clearButton = document.getElementById('clear-completed');
const list = document.getElementById('todo-list');

let todos = [];
let editingId = null;

// One <li> per todo: a checkbox named by the todo's text, the text (or an edit input while
// editing it), then a Delete button. The text sits outside the label so a double-click
// never toggles the checkbox.
function renderTodo(todo) {
  const li = document.createElement('li');
  li.dataset.id = todo.id;
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = todo.done;
  checkbox.addEventListener('change', () => setDone(todo, checkbox.checked));
  checkbox.setAttribute('aria-label', todo.text);
  label.append(checkbox);
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete';
  deleteButton.textContent = 'Delete';
  deleteButton.setAttribute('aria-label', `Delete ${todo.text}`);
  deleteButton.addEventListener('click', () => deleteTodo(todo));
  li.append(label, ' ', todo.id === editingId ? renderEditInput(todo) : renderText(todo), ' ', deleteButton);
  return li;
}

function renderText(todo) {
  const text = document.createElement('span');
  text.className = 'todo-text';
  text.classList.toggle('done', todo.done);
  text.textContent = todo.text;
  text.addEventListener('dblclick', () => startEdit(todo));
  return text;
}

function renderEditInput(todo) {
  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'edit';
  editInput.setAttribute('aria-label', 'Edit todo');
  editInput.value = todo.text;
  editInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveEdit(todo, editInput.value);
    else if (event.key === 'Escape') cancelEdit(todo);
  });
  editInput.addEventListener('blur', () => saveEdit(todo, editInput.value));
  return editInput;
}

function startEdit(todo) {
  editingId = todo.id;
  render();
  focusIn(todo.id, 'input.edit');
}

function cancelEdit(todo) {
  if (editingId !== todo.id) return;
  editingId = null;
  render();
  focusIn(todo.id, 'input[type="checkbox"]');
}

// Clearing editingId first makes the blur caused by the re-render a no-op.
async function saveEdit(todo, value) {
  if (editingId !== todo.id) return;
  editingId = null;
  const text = value.trim();
  if (!text) {
    render();
    showError(EMPTY_ERROR);
    focusIn(todo.id, 'input[type="checkbox"]');
    return;
  }
  if (text === todo.text) {
    render();
    focusIn(todo.id, 'input[type="checkbox"]');
    return;
  }
  await patchTodo(todo, { text }, 'Could not save');
}

// render() replaces the list, so put focus back on the matching control of a todo.
function focusIn(id, selector) {
  const li = /** @type {HTMLElement[]} */ ([...list.children]).find((el) => el.dataset.id === id);
  li?.querySelector(selector)?.focus();
}

// Save the changes; the page re-renders from the stored todo, or from the old one on failure.
async function patchTodo(todo, changes, failMessage) {
  try {
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!res.ok) throw new Error(`PATCH /api/todos/${todo.id} failed: ${res.status}`);
    const saved = await res.json();
    todos = todos.map((t) => (t.id === saved.id ? saved : t));
    render();
    clearError();
  } catch (err) {
    console.error(err);
    render();
    showError(failMessage);
  }
  focusIn(todo.id, 'input[type="checkbox"]');
}

function setDone(todo, done) {
  return patchTodo(todo, { done }, 'Could not update todo');
}

// Remove the todo once the server confirms; 404 means it is already gone, so drop it too.
async function deleteTodo(todo) {
  try {
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`DELETE /api/todos/${todo.id} failed: ${res.status}`);
  } catch (err) {
    console.error(err);
    showError('Could not delete todo');
    return;
  }
  const index = todos.findIndex((t) => t.id === todo.id);
  if (index === -1) return;
  todos.splice(index, 1);
  render();
  clearError();
  // Focus the todo that took its place (or the one before it), or the input if none remain.
  const next = todos[index] ?? todos[index - 1];
  if (next) focusIn(next.id, 'button.delete');
  else input.focus();
}

// Delete the done todos, then show what the server kept; on failure the list stays as it is.
async function clearCompleted() {
  try {
    const res = await fetch('/api/todos?done=true', { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /api/todos?done=true failed: ${res.status}`);
  } catch (err) {
    console.error(err);
    showError('Could not clear completed todos');
    return;
  }
  try {
    todos = await fetchTodos();
  } catch (err) {
    console.error(err);
    showError('Could not refresh todos');
    return;
  }
  render();
  clearError();
  input.focus();
}

function render() {
  list.replaceChildren(...todos.map(renderTodo));
  list.hidden = todos.length === 0;
  emptyMessage.hidden = todos.length !== 0;
  countMessage.textContent = `${todos.filter((t) => !t.done).length} items left`;
  countMessage.hidden = false;
  clearButton.hidden = !todos.some((t) => t.done);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

async function fetchTodos() {
  const res = await fetch('/api/todos');
  if (!res.ok) throw new Error(`GET /api/todos failed: ${res.status}`);
  return res.json();
}

async function load() {
  todos = await fetchTodos();
  render();
}

clearButton.addEventListener('click', clearCompleted);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    showError(EMPTY_ERROR);
    return;
  }
  let res;
  try {
    res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error(err);
    showError('Could not add todo');
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showError(data.error ?? 'Could not add todo');
    return;
  }
  todos.push(data);
  render();
  clearError();
  input.value = '';
  input.focus();
});

load().catch((err) => {
  console.error(err);
  showError('Could not load todos');
});
