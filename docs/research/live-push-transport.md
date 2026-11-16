# Live push to open browser tabs: SSE vs WebSockets vs polling

Research for [#3](https://github.com/drdla/cohort-005-project/issues/3) (map: [#1](https://github.com/drdla/cohort-005-project/issues/1)). Planning only: no code was changed.

## Answer

Use **Server-Sent Events (SSE) from a React Router resource route**, served by the existing `react-router-serve` process, with an **in-process, per-user registry of open streams**. In this setup:

- A Notification is **written to SQLite first**. The push only tells open tabs that something changed. On (re)connect a tab refetches what is unread, so a dropped push never loses a Notification.
- **Online** = the registry holds at least one open stream for the user. Allow a short grace period so a reconnect doesn't count as going Away.
- **One stream per browser, not per tab.** Elect a leader tab with the Web Locks API, and have it relay events to the other tabs over `BroadcastChannel`. Without this, the HTTP/1.1 limit of 6 connections per host stalls the app once a person has about 6 tabs open (see Pitfalls).

WebSockets would need us to replace `react-router-serve` with our own server, and the client-to-server direction gives us nothing we need. Polling is the fallback if long-lived connections turn out to be impossible on the host. It is slow in background tabs and only gives a rough sense of who is Online.

## What the app runs on today (codebase facts)

| Fact | Source |
| --- | --- |
| Production server is `react-router-serve ./build/server/index.js`; dev is `react-router dev` (Vite) | `package.json` scripts |
| SSR on, framework mode, React Router 8.3.0 | `react-router.config.ts`, `package.json` |
| No custom server, Dockerfile or deploy config in the repo | repo root |
| One SQLite file, `data.db`, opened lazily via better-sqlite3 in WAL mode | `app/db/index.ts` |
| Auth is a cookie session (`cadence_session`), read with `getCurrentUserId(request)` | `app/lib/session.ts`, e.g. `app/routes/api.video-tracking.ts` |
| Resource routes already exist as `api.*.ts` files registered in `app/routes.ts` | `app/routes.ts` |
| `react-router-serve` = Express 5 + `compression` + `morgan` + `express.static`, then `app.all("/{*splat}", createRequestHandler(...))`; plain `app.listen` (HTTP/1.1, no access to the `http.Server`) | `node_modules/@react-router/serve/dist/cli.js` lines 111-127 |

One SQLite file means **one server host**. Unless we deliberately run a cluster, it also means **one Node process**. That makes an in-memory fan-out registry valid. If we ever run more than one process, the processes need a shared bus such as Redis pub/sub or Postgres `LISTEN/NOTIFY`, or each process has to poll an outbox table. That cost only arrives with scale-out.

## Options compared

| | SSE (`EventSource`) | WebSockets | Polling (`fetcher.load` / `useRevalidator` on an interval) |
| --- | --- | --- | --- |
| Works on `react-router-serve` as-is | **Yes.** A resource route returns a streaming `Response` (verified below) | **No.** It needs an `upgrade` handler on the `http.Server`, which `react-router-serve` doesn't expose. "By design, we do not provide options to customize the React Router App Server", so we would have to migrate to our own `@react-router/express` server [RR serve] | Yes |
| Server process needs | One long-lived HTTP response per connection, plus an in-memory `Map<userId, Set<stream>>` | Same, plus the `ws` dependency, our own server entry and a dev setup with Vite in middleware mode [RR quickstart] | No long-lived state. Load = tabs ÷ interval |
| Direction | Server → client. Client → server stays on normal RR actions (mark read etc.) | Both ways (not needed) | Client pulls |
| Latency | Immediate | Immediate | Up to one interval. In hidden tabs, Chrome may throttle timers to once a minute [Chrome timers] |
| Reconnect / resume | Built into the browser: `retry:` field and `Last-Event-ID` header [WHATWG SSE] | Hand-rolled | n/a |
| Telling who is Online | **Exact**: at least one open stream in the registry | Exact (same idea) | **Rough**: "seen within N seconds" heartbeat column |
| Fan-out across tabs | One stream per browser via a leader tab, relayed over `BroadcastChannel` (strongly advised, see 6-connection limit) | Not limited by the per-host HTTP connection pool | Each tab polls unless the tabs coordinate |
| Several server instances | Needs a shared pub/sub bus | Same | Works anywhere (reads the DB) |

## Verified: SSE works through `react-router-serve` and its compression

`compression` is a known SSE trap: it buffers output, and its README says it "does not work out of the box with server-sent events… you can achieve this by calling `res.flush()`" [compression README]. `text/event-stream` counts as compressible (`compressible("text/event-stream") === true`, checked locally), so the stream *is* gzipped. The React Router adapter already deals with this:

- `@react-router/express` `sendRemixResponse` calls `res.flushHeaders()` when the Content-Type matches `text/event-stream` (`node_modules/@react-router/express/dist/index.js`, line 63).
- `@react-router/node` `writeReadableStreamToWritable` calls `flushable.flush()` after **every chunk** (`node_modules/@react-router/node/dist/index.js`, lines 107-122). `res.flush` is the method `compression` adds.
- The adapter aborts `request.signal` when the client disconnects: `res.on("close", () => controller?.abort())` (`@react-router/express`, line 48). That is the hook for removing a stream from the registry.
- If we'd rather skip gzip for the stream, `compression` won't transform a response that sends `Cache-Control: no-transform` (`node_modules/compression/index.js`, `shouldTransform`).

These are behaviours of the installed 8.3.0 packages, read from their source. Pin and re-check them on upgrades.

## Pitfalls to design around

1. **The HTTP/1.1 limit of 6 connections per host.** MDN: "When not used over HTTP/2, SSE suffers from a limitation to the maximum number of open connections, which can be specially painful when opening various tabs as the limit is per browser and set to a very low number (6)… marked as 'Won't fix' in Chrome and Firefox." [MDN EventSource]. `react-router-serve` speaks only HTTP/1.1, so with one `EventSource` per tab, the 6th tab's ordinary navigations and fetches would queue. There are two fixes and we should do both. First, **one connection per browser**: elect a leader tab with `navigator.locks.request(...)` [MDN Web Locks] and relay events with `BroadcastChannel` [MDN BroadcastChannel]. When the leader tab closes, its lock is released and another tab takes over. Second, put an HTTP/2-terminating proxy in front in production (negotiated limit, default 100 streams [MDN EventSource]).
2. **It must be a resource route.** A route module with a `loader` and no default component returns its `Response` untouched [RR resource routes]. Don't open the stream from a UI route's `loader`. Open the `EventSource` in a client-only `useEffect`, e.g. in `app/routes/layout.app.tsx`, and close it on unmount.
3. **Cleanup on disconnect.** Remove the stream from the registry on `request.signal`'s `abort` event, and also when `enqueue` throws. Otherwise the registry leaks memory and wrongly reports the user as Online.
4. **Keep-alives.** "Legacy proxy servers are known to… drop HTTP connections after a short timeout… authors can include a comment line (one starting with a ':' character) every 15 seconds or so." [WHATWG SSE]. Send `: ping` about every 15 s. The same timer can catch dead sockets.
5. **Don't revalidate the whole page on every event.** `useRevalidator().revalidate()` reruns the loaders of every matched route [RR useRevalidator]. For a bell or toast, update local state from the event payload, or `useFetcher().load()` one small unread-count or inbox route. Save full revalidation for a deliberate "refresh" moment.
6. **Persist first, push second.** Write the Notification row, then push. On reconnect, which `EventSource` does on its own with `Last-Event-ID` [WHATWG SSE], refetch unread instead of trying to replay a perfect event log. This keeps the in-memory registry disposable, so a server restart costs nothing.
7. **Auth and switching users.** The stream is tied to the user whose cookie opened it. `EventSource` sends cookies on same-origin requests (`withCredentials` matters only cross-origin [MDN EventSource]). The DevUI user switch (`api.switch-user.ts`) answers with a `redirect`. Make sure the stream is closed and reopened when the user changes, or one person's Notifications will reach another person's tab.
8. **Module state in dev.** The registry is module-level state. In development, React Router reloads server modules ("purging the require cache for every request" under `react-router-serve` dev [RR serve]; Vite HMR under `react-router dev`). Keep the registry on `globalThis` so a reload doesn't orphan open streams. In production the server "boots up, and that's the end of it" [RR serve].
9. **Online vs Away edge cases.** A hidden or background tab is still Online by our definition, so it must keep its stream open. Don't pause the stream on `visibilitychange`. That matters for OS-level browser notifications, which are most useful exactly when the tab is hidden. Debounce Online→Away by a few seconds to ride out reconnects.

## Open questions for the PRD

- Where will production run? Long-lived HTTP responses must be allowed. Serverless or edge platforms with short request timeouts would push us to polling. HTTP/2 at the edge removes pitfall 1 but doesn't replace the leader-tab design for local dev.
- Is "Online" needed on the server at all, beyond the Digest? The Digest keys on *unread*, not on Away, so Online may only drive the choice between toast and email-later, or nothing at all.

## Sources

- [RR serve] React Router App Server: https://reactrouter.com/api/other-api/serve
- [RR adapter] `@react-router/express` adapter: https://reactrouter.com/api/other-api/adapter
- [RR quickstart] Custom Express server + Vite middleware mode: https://reactrouter.com/tutorials/quickstart
- [RR resource routes] https://reactrouter.com/how-to/resource-routes
- [RR useRevalidator] https://reactrouter.com/api/hooks/useRevalidator
- [WHATWG SSE] HTML Living Standard, Server-sent events: https://html.spec.whatwg.org/multipage/server-sent-events.html
- [MDN EventSource] https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- [MDN Web Locks] https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- [MDN BroadcastChannel] https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- [Chrome timers] Heavy throttling of chained JS timers (Chrome 88): https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- [compression README] https://github.com/expressjs/compression#server-sent-events
- Installed package source (v8.3.0 / compression 1.8.2): `node_modules/@react-router/serve/dist/cli.js`, `node_modules/@react-router/express/dist/index.js`, `node_modules/@react-router/node/dist/index.js`, `node_modules/compression/index.js`
