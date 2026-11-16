# Research: running the 8 am Digest, and in whose timezone

Ticket: [#5](https://github.com/drdla/cohort-005-project/issues/5) (map: [#1](https://github.com/drdla/cohort-005-project/issues/1)).
Researched 2026-11-16. No repo convention for research notes existed, so this lives in `docs/research/`.

## Short answer

- **Timezone:** send at each person's **local** 8 am. Today we know nothing usable: `users` has no location or timezone column, and the country we resolve is per request (pricing), stored only on `purchases`. A country is not enough anyway (the US has 29 IANA zones). Capture an **IANA timezone name** from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and store it on `users`.
- **Scheduling:** run a **frequent tick (every 15 min)**, not one job per person. Each tick picks people whose local time is past 08:00 and who have no Digest recorded for their local date, and records each send in a table with a unique key `(user_id, local_date)`. That key makes the job idempotent, so restarts, duplicate ticks and catch-up after downtime are safe.
- **Trigger:** either an in-process scheduler (`croner` or `node-cron`) started from the server build, or an external cron calling a secret-protected route. Both work with the way the app is served. The idempotency table matters more than which trigger we pick.
- **Gap:** there is **no mailer** in the codebase. The ticket mentions `app/lib/mailer.server.ts`, but it does not exist on `main`. Sending email is a separate decision.

## 1. How the app is served (codebase)

- `npm start` runs `react-router-serve ./build/server/index.js` (`package.json`). `react-router-serve` is a long-lived Node/Express process. It `import()`s the server build once at startup, mounts `createRequestHandler` on `/{*splat}`, calls `app.listen`, and closes the server on `SIGTERM`/`SIGINT` (`node_modules/@react-router/serve/dist/cli.js`, `run()`, v8.3.0).
  - Result: module-scope code in the server build runs **once per process**. That is where an in-process scheduler could start. There is no custom server entry, so a timer would start from a `.server.ts` module imported by the build, or from a custom `server.js` that wraps the build. Both are implementation choices.
  - `react-router-serve` has no built-in scheduler and no hook for background jobs (same file).
- In dev (`react-router dev`, Vite), modules are re-evaluated on hot reload, so a module-scope timer can be started more than once. It needs a `globalThis` guard, or it must be disabled in dev.
- Database: a single SQLite file, `data.db`, through `better-sqlite3` + Drizzle (`app/db/index.ts`). There is no Redis or Postgres, which rules out Redis/Postgres queues (BullMQ, pg-boss) unless we add infrastructure.
- `CF-IPCountry` handling in `app/lib/country.server.ts` suggests Cloudflare may sit in front, but nothing in the repo configures a deployment target.

## 2. What we know about a person's location today (codebase)

- `users` (`app/db/schema.ts`): `id, name, email, role, avatarUrl, bio, createdAt`. **No country, locale or timezone.**
- `resolveCountry(request)` (`app/lib/country.server.ts`) returns an ISO country code per request: dev session override, then the `CF-IPCountry` header, then an ip-api.com lookup on `X-Forwarded-For`, else `null`. It is used for PPP pricing (`courses.$slug.purchase.tsx`) and stored only as `purchases.country`.
  - It is the **request's** country, not the person's, and it only exists for people who have bought something.
- A country does not give a timezone. Counting countries listed in IANA [`zone1970.tab`](https://data.iana.org/time-zones/tzdb/zone1970.tab) (run 2026-11-16): US 29 zones, RU 27, CA 23, BR 16, AU 13, MX 12, DE 2. AT and IN have 1 each. IANA itself avoids country-level zone names because "the country of Mexico has several time zones" ([tz theory](https://data.iana.org/time-zones/theory.html)).

## 3. Timezone handling (primary sources)

- **IANA tz database**: "the history of local time for many representative locations worldwide", "updated periodically" (latest 2026f, released 2026-10-27) ([iana.org/time-zones](https://www.iana.org/time-zones)). Names follow `AREA/LOCATION`, e.g. `America/New_York` ([theory.html](https://data.iana.org/time-zones/theory.html)). Store this name, not a UTC offset: offsets change with DST, and the name carries the rules.
- **Capturing it in the browser**: `new Intl.DateTimeFormat().resolvedOptions().timeZone` returns "the runtime's default time zone", an IANA name such as `"Europe/Brussels"` ([MDN resolvedOptions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/resolvedOptions)). Browsers do not send a timezone with requests, so the client has to post it, for example once after sign-in or from the root layout when it differs from the stored value. A settings field to override it would cover travellers and odd browser setups.
- **Validating it on the server**: `Intl.DateTimeFormat` throws `RangeError` if "options contain invalid values" ([MDN constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat)). Verified on Node 26: `RangeError: Invalid time zone specified: Invalid/Zone`. `Intl.supportedValuesOf("timeZone")` returns the sorted list of primary IANA identifiers ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf)). On Node 26 it returns 418 entries, which can feed a zod enum.
- **Computing local time without a library**: `new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now)` gives the local hour (the `timeZone` option accepts any IANA name, per the MDN constructor page). Verified at 2026-11-16T07:30Z: Vienna 8, New York 2, Los Angeles 23, Kolkata 13, Sydney 18. The same approach with `year/month/day` gives the person's **local date**, which is the idempotency key.
- **Non-hour offsets**: `Asia/Kolkata` is UTC+5:30, so local 08:00 is 02:30 UTC. A tick that runs only at :00 UTC would never land on 8 am there. Use a ≥ 08:00 check with a 15-minute tick, rather than "hour == 8".
- **Fallback**: people without a stored timezone need a default (platform timezone or UTC). This is a product decision.

## 4. Scheduling options

| Option | How | Fits this app? | Caveats |
| --- | --- | --- | --- |
| In-process: [`croner`](https://github.com/Hexagon/croner) | `new Cron("*/15 * * * *", { protect: true }, tick)` started in the server process | Yes. Zero dependencies; `protect` "will block new triggers as long as an old trigger is in progress"; optional IANA `timezone` option | Runs only while the process is up; one copy per process (duplicates if scaled out); dev HMR guard needed |
| In-process: [`node-cron`](https://github.com/node-cron/node-cron) v4 | `cron.schedule(expr, fn, { timezone, noOverlap: true })` | Yes. "Schedules match wall-clock time in the task's `timezone`"; `noOverlap` "skips a run instead of stacking them" | It "coordinates but does not persist state to a database"; its docs point to a queue or workflow engine for exactly-once delivery across crashes |
| One cron job per timezone | node-cron/croner `timezone: "Europe/Vienna"`, `0 8 * * *` per distinct zone | Possible | Jobs must be rebuilt as users' zones change. croner DST rule: a fall-back repeated time "runs once, at the first occurrence", and a spring-forward skipped time "runs at the first valid time after the gap" ([croner](https://github.com/Hexagon/croner)). More moving parts than one tick |
| External cron calls a route | e.g. a resource route `POST /api/digest-tick` with a shared-secret header, hit by system cron, the host's cron, or [GitHub Actions `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) | Yes. Fits `react-router-serve` (it is just another route); survives app restarts; one trigger even with several instances | GitHub Actions: "can be delayed during periods of high loads", may drop queued jobs, minimum interval 5 min, and auto-disables after 60 days without activity in public repos. Fine for a Digest, not precise |
| SQLite-backed job queue | e.g. [`plainjob`](https://github.com/justplainstuff/plainjob) (better-sqlite3, cron schedules) | Possible; reuses `data.db` | Small, young projects; adds a dependency and a worker loop for one daily job. Not needed if the idempotency table below exists |
| Redis/Postgres queues (BullMQ, pg-boss, Agenda/Mongo) | — | No | Need infrastructure the app does not have |

## 5. Recommended shape (for the PRD to confirm)

1. Add `users.timezone` (IANA name, nullable), captured from the browser and editable in settings, and validated against `Intl.supportedValuesOf("timeZone")`.
2. Add a `digest_runs` (or similar) table with a unique `(user_id, local_date)`.
3. Every 15 minutes, for each user with unread Notifications whose local time is ≥ 08:00 and who has no `digest_runs` row for their local date: insert the row (the unique constraint wins any race), then send. Send nothing when there are no unread Notifications, per the map. The ≥ 08:00 check means a missed tick or a restart still sends the Digest later that morning. A product decision is needed on whether to give up after a cutoff (e.g. noon).
4. Trigger: start with an in-process `croner` job (simplest, no infrastructure). Move to an external cron hitting a protected route if we run more than one instance or need it to survive process downtime. Step 3 makes either safe.

## Open questions for the PRD

- Default timezone for people we have not captured one for (UTC? platform zone? derive from `resolveCountry` only when the country has a single zone?).
- Email delivery: which provider or mailer. Nothing exists in the codebase yet.
- Catch-up cutoff: if the server was down at 8 am, should the Digest still go out at 11 am?
