# todo-app

A sample todo app built by the [system factory](https://github.com/hoangtrankim/system-factory). It is the factory's first target and its retro benchmark.

```sh
npm install
npm start      # http://localhost:3000
npm test       # Playwright
npm run check  # lint, format, types, tests + coverage floor (what CI runs)
```

The server listens on `127.0.0.1` only. Set `HOST` (for example `HOST=0.0.0.0 npm start`) to use another interface.

## Security

There is no login. By default the server listens on `127.0.0.1` only. Setting `HOST` to another interface (for example `0.0.0.0`) exposes the API, with no login, to anyone on that network: the Host check only blocks DNS rebinding, not direct requests. Do not expose it to an untrusted network.

Writes (`POST`, `PATCH`) must send `Content-Type: application/json`, which stops other web pages from adding todos with a cross-site form or `text/plain` request.
