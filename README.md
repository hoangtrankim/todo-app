# todo-app

A sample todo app built by the [system factory](https://github.com/hoangtrankim/system-factory). It is the factory's first target and its retro benchmark.

```sh
npm install
npm start      # http://localhost:3000
npm test       # Playwright
npm run check  # lint, format, types, tests + coverage floor (what CI runs)
```

The server listens on `127.0.0.1` only. Set `HOST` (for example `HOST=0.0.0.0 npm start`) to use another interface. The API still accepts only `Host: localhost:<port>` or `127.0.0.1:<port>`, whatever `HOST` is.

## Security

There is no login. Anyone who can reach the server's port can read and change the todos, and the server listens on all network interfaces. Do not expose it to an untrusted network.

Writes (`POST`, `PATCH`) must send `Content-Type: application/json`, which stops other web pages from adding todos with a cross-site form or `text/plain` request.
