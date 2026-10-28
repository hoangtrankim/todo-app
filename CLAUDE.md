# todo-app

A sample app built end to end by the system factory (https://github.com/hoangtrankim/system-factory). Work arrives as factory tickets; follow the agent prompts in `.claude/agents/`.

- Plain Node, no framework: `server.js` serves `public/`. Keep it that way unless a design note says otherwise.
- Tests are Playwright, in `tests/`. Acceptance tests from the QA test writer live in `tests/acceptance/` and are never edited by the builder.
- Run `npm run check` before pushing: lint (ESLint), format (Prettier, `npm run format` fixes it), types (`tsc --checkJs`) and the tests with an 80% line coverage floor on `server.js`. CI runs the same gates and fails the PR on any of them. `PORT` sets the server port.
- Acceptance tests in `tests/acceptance/` are left out of lint and format, so the builder never has to touch them.
- The factory CLI is `forge`, installed globally (`npm link` from system-factory).
