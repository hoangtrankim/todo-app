// Todo list page: fetch, render, add. Text is always set with textContent (never innerHTML).
const EMPTY_ERROR = "Todo can't be empty";

const form = document.getElementById('new-todo-form');
const input = document.getElementById('new-todo');
const errorBox = document.getElementById('todo-error');
const emptyMessage = document.getElementById('empty-message');
const list = document.getElementById('todo-list');

let todos = [];

// One <li> per todo: a checkbox labelled by the todo's text. Later tickets add the Delete button here.
function renderTodo(todo) {
  const li = document.createElement('li');
  li.dataset.id = todo.id;
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = todo.done;
  checkbox.addEventListener('change', () => setDone(todo, checkbox.checked));
  const text = document.createElement('span');
  text.className = 'todo-text';
  text.classList.toggle('done', todo.done);
  text.textContent = todo.text;
  label.append(checkbox, ' ', text);
  li.append(label);
  return li;
}

// Save the new state; the page re-renders from the stored todo, or from the old one on failure.
async function setDone(todo, done) {
  try {
    const res = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) throw new Error(`PATCH /api/todos/${todo.id} failed: ${res.status}`);
    const saved = await res.json();
    todos = todos.map((t) => (t.id === saved.id ? saved : t));
    render();
    clearError();
  } catch (err) {
    console.error(err);
    render();
    showError('Could not update todo');
  }
}

function render() {
  list.replaceChildren(...todos.map(renderTodo));
  list.hidden = todos.length === 0;
  emptyMessage.hidden = todos.length !== 0;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

async function load() {
  const res = await fetch('/api/todos');
  if (!res.ok) throw new Error(`GET /api/todos failed: ${res.status}`);
  todos = await res.json();
  render();
}

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
