// Todo list page: fetch, render, add. Text is always set with textContent (never innerHTML).
const EMPTY_ERROR = "Todo can't be empty";

const form = document.getElementById('new-todo-form');
const input = document.getElementById('new-todo');
const errorBox = document.getElementById('todo-error');
const emptyMessage = document.getElementById('empty-message');
const list = document.getElementById('todo-list');

let todos = [];

// One <li> per todo. Later tickets add the done checkbox and Delete button here.
function renderTodo(todo) {
  const li = document.createElement('li');
  li.dataset.id = todo.id;
  const text = document.createElement('span');
  text.textContent = todo.text;
  li.append(text);
  return li;
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
  const res = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
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
