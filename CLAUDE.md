# todo-app

A sample app built end to end by the system factory (https://github.com/hoangtrankim/system-factory). Work arrives as factory tickets; follow the agent prompts in `.claude/agents/`.

- Plain Node, no framework: `server.js` serves `public/`. Keep it that way unless a design note says otherwise.
- Tests are Playwright, in `tests/`. Acceptance tests from the QA test writer live in `tests/acceptance/` and are never edited by the builder.
- Run `npm test` before pushing. `PORT` sets the server port.
