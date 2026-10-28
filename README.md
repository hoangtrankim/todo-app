# todo-app

A sample todo app built by the [system factory](https://github.com/hoangtrankim/system-factory). It is the factory's first target and its retro benchmark.

```sh
npm install
npm start      # http://localhost:3000
npm test       # Playwright
npm run check  # lint, format, types, tests + coverage floor (what CI runs)
```

The server listens on `127.0.0.1` only. Set `HOST` (for example `HOST=0.0.0.0 npm start`) to use another interface. The API still accepts only `Host: localhost:<port>` or `127.0.0.1:<port>`, whatever `HOST` is.
