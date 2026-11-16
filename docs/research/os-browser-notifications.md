# OS-level browser notifications for Cadence

Researched 2026-11-16. Each claim links to the source it comes from. Claims I could not confirm in a primary source are marked **unverified**. Code references point at local branch `main`.

## Question

What does it take to show OS-level browser notifications for people who allow them?

Context: Cadence always shows a Notification in the in-app bell, inbox and toasts while a person is **Online**, meaning Cadence is open in at least one tab. OS-level notifications are an extra for people who grant permission. Native mobile push is out of scope. A person who is signed in with no tab open is **Away**, and the 8 am email Digest covers them.

## Short answer

- **You need a service worker even for tab-only notifications.** `new Notification()` throws on Chrome for Android ([BCD/MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification), [crbug 481856](https://crbug.com/481856)). On iOS, `Notification` does not exist at all unless the page runs as a Home Screen web app, and even there notifications come only from a service worker ([MDN browser-compat data](https://developer.mozilla.org/en-US/docs/Web/API/Notification#browser_compatibility)). So the portable call is `ServiceWorkerRegistration.showNotification()`, served from `/sw.js` over HTTPS (localhost counts as secure).
- **No push server is needed for the Online-only requirement (Option A).** An open tab gets the event over the in-app live channel, then calls `registration.showNotification()` only when no Cadence tab is visible. There are no VAPID keys, no subscription table and no sender. This works well on desktop Chrome, Edge, Firefox and Safari.
- **On mobile, Option A delivers almost nothing.** Mobile pages "almost never run in the background" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification)), and an iOS Safari tab has no Notification API. Reliable OS notifications on phones need Web Push (Option B): a service worker, `PushManager.subscribe` with a VAPID key, a push-subscription table, and a server sender such as the `web-push` npm library. On iOS, Web Push also requires the person to add Cadence to the Home Screen ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- **Ask for permission only from a click, in context, after a pre-prompt.** Firefox (72+) and Safari reject requests made without a user gesture. Chrome moves sites with low accept rates to a "quiet" prompt. Once a person picks "denied", the page cannot ask again ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API), [web.dev](https://web.dev/articles/permissions-best-practices), [Chrome](https://developer.chrome.com/blog/notification-permission-data-in-crux)).
- **De-duplicate in two layers.** First, `tag` = Notification id, so a second notification with the same tag replaces the first instead of stacking ([WHATWG §2.6](https://notifications.spec.whatwg.org/#showing-a-notification)). Second, either have one leader tab (Web Locks) post the event, or let the service worker decide by checking `clients.matchAll()` for a visible window. Leave out `renotify`: Firefox and Safari don't support it.
- **Recommendation: ship Option A first** (desktop, tab-only, service worker, no push). Keep the Digest for Away. Treat Option B (Web Push) as a separate, later decision, because it changes what "Away" means: a person who subscribed to push could be reached without the Digest.
- **Fits the stack.** `react-router-serve` serves `build/client` at `/`, and Vite copies `public/` into it. So `public/sw.js` is served at `/sw.js` and can have scope `/` ([source](#7-how-it-fits-cadence)).

## 1. Notifications API vs `showNotification()` vs Web Push

There are three ways to put a notification on screen:

| Mechanism | Runs where | Needs | Reaches Away people? |
| --- | --- | --- | --- |
| `new Notification(title, opts)` ("non-persistent") | Page script | Permission | No |
| `registration.showNotification(title, opts)` ("persistent") | Page or service worker | Permission and an active service worker | No, unless something wakes the service worker |
| Web Push: a `push` event in the service worker, which then calls `showNotification` | Service worker, woken by the push service | Permission, a service worker, `PushManager.subscribe` with a VAPID key, a server sender | Yes |

- **The constructor is banned in service workers.** Its first step throws a `TypeError` if the global is a `ServiceWorkerGlobalScope`. `actions` are allowed only on persistent notifications ([WHATWG §3.2](https://notifications.spec.whatwg.org/#dom-notification-notification)).
- **Chrome for Android:** the constructor "always throws a `TypeError`", and "A notification can only be sent from a service worker" ([MDN browser-compat data, `api.Notification.Notification`](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification#browser_compatibility)). MDN says it "throws a `TypeError` when called in nearly all mobile browsers, and this is unlikely to change", and links [crbug 481856](https://crbug.com/481856) ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification)). **Verified.**
- **`showNotification()`** rejects with a `TypeError` if the registration has no active worker, or if permission is not `"granted"` ([WHATWG §4](https://notifications.spec.whatwg.org/#dom-serviceworkerregistration-shownotification)). A page can call it through `navigator.serviceWorker.ready`, so no push is involved.
- **Clicks:** a persistent notification fires `notificationclick` in the service worker. A non-persistent one fires `click` on the `Notification` object ([WHATWG §2.7](https://notifications.spec.whatwg.org/#activating-a-notification)).
- **Web Push** joins three standards: the W3C [Push API](https://www.w3.org/TR/push-api/) (browser side), [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) (the protocol between the app server and the push service), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) (payload encryption) and [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) (VAPID). Push messages must lead to a visible notification: Safari revokes subscriptions that break the `userVisibleOnly` promise ([WebKit "Meet Web Push"](https://webkit.org/blog/12945/meet-web-push/)).

**Which one Cadence needs:** OS notifications are only wanted while the person is Online, so we don't strictly need Web Push. Use `showNotification()` through a service worker, not `new Notification()`. The service worker is what makes the same code work on Chrome for Android, and it gives us `notificationclick` handling.

## 2. Service worker requirements

- **Secure context.** Service workers run only over HTTPS, and "`localhost` is considered a secure origin" ([MDN, Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)). Potentially trustworthy origins include `127.0.0.0/8`, `::1`, `localhost` and `*.localhost` ([MDN, Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)). `requestPermission` is secure-context only as well ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)), and `PushManager` is `[SecureContext]` ([Push API](https://www.w3.org/TR/push-api/)).
- **Scope.** By default the scope is the directory the script lives in. You can widen it with the `Service-Worker-Allowed` header. A script at `/sw.js` with `scope: "/"` controls the whole origin ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)). So the file must sit at the root, not under `/assets/`.
- **Registration can fail** in private browsing or when all cookies are blocked ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)). Chrome notifications don't work in incognito from Chrome 49 on ([MDN browser-compat data, `api.Notification`](https://developer.mozilla.org/en-US/docs/Web/API/Notification#browser_compatibility)). Treat OS notifications as best-effort and always keep the in-app bell.
- **Cross-origin iframes** cannot request notification permission in Chrome or Firefox ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)).

## 3. VAPID and the push server (Option B only)

- **What VAPID is.** VAPID lets an application server identify itself to a push service with a signed JWT. The JWT is ES256 (ECDSA P-256). `aud` is the push-resource origin. `exp` must be no more than 24 h ahead. `sub` should be a `mailto:` or `https:` contact. The token goes in `Authorization: vapid t=<jwt>, k=<public key>`. A push service may answer 403 for an invalid token and 401 for a missing one on a restricted subscription ([RFC 8292 §2–4](https://www.rfc-editor.org/rfc/rfc8292)).
- **Browser side.** `applicationServerKey` is the VAPID public key: an uncompressed P-256 point of 65 octets ([Push API](https://www.w3.org/TR/push-api/)). Chrome and Edge require it ([MDN browser-compat data, `PushManager.subscribe`](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe#browser_compatibility)).
- **Payload encryption.** It uses `aes128gcm` with ECDH P-256 and a 16-octet auth secret. Push services need only accept 4096 octets of body, which leaves about 3993 octets of plaintext ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)). Send a small payload, such as a Notification id, title and URL.
- **Sending with [`web-push`](https://github.com/web-push-libs/web-push)** (npm `web-push` 4.0.0, `engines.node >= 16`, from the [npm registry](https://registry.npmjs.org/web-push/latest)):
  - Generate keys once: `web-push generate-vapid-keys [--json]` or `webpush.generateVAPIDKeys()`. The README says "create these keys once, store them and use them for all future messages".
  - Call `webpush.setVapidDetails(subject, publicKey, privateKey)`.
  - Call `webpush.sendNotification(subscription, payload, { TTL, urgency, topic })`. The subscription is the `JSON.stringify` of a browser `PushSubscription`: `{ endpoint, keys: { p256dh, auth } }`.
  - The promise rejects on failure, and both the result and the error carry `statusCode`, `headers` and `body`.
  - The README warns that Safari rejects a VAPID subject of `https://localhost` with `BadJwtToken`.
- **Push protocol facts.**
  - `TTL` is required, `Urgency` is optional, and `Topic` replaces an undelivered message with the same topic. A 201 means the push service accepted the message, not that it was delivered ([RFC 8030 §5](https://www.rfc-editor.org/rfc/rfc8030)).
  - Sending to an expired subscription "MUST return a 404" ([RFC 8030 §7.3](https://www.rfc-editor.org/rfc/rfc8030)).
  - RFC 8030 uses 410 for receipt subscriptions ([§6.2](https://www.rfc-editor.org/rfc/rfc8030)). In practice, push services also return 410 for unsubscribed endpoints (**unverified** against a primary source; the `web-push` README does not say). Delete the stored subscription on both 404 and 410.
  - Chrome rate-limits high-volume, low-engagement senders to no less than 1000 per minute and answers excess sends with HTTP 429 ([Chrome blog](https://developer.chrome.com/blog/web-push-rate-limits)).
- **Subscription storage.** Store one row per browser subscription: person id, `endpoint` (unique), `p256dh`, `auth`, created and last-success timestamps, and user agent. Handle `pushsubscriptionchange` in the service worker, which carries `oldSubscription` and `newSubscription` ([Push API](https://www.w3.org/TR/push-api/)). Re-send the current subscription to the server on each sign-in.
- **Apple.** No Apple Developer Program membership is needed. Allow `*.push.apple.com` through any firewall ([WebKit, iOS 16.4](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit "Meet Web Push"](https://webkit.org/blog/12945/meet-web-push/)).
- **Declarative Web Push** (Safari): the payload is JSON with `"web_push": 8030`, `notification.title` and `navigate`, and the browser shows it without a service worker. `window.pushManager` is exposed. It shipped for Home Screen web apps on iOS/iPadOS 18.4 ([WebKit 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)) and on macOS in Safari 18.5 ([WebKit 18.5](https://webkit.org/blog/16923/webkit-features-in-safari-18-5/)). Other browsers still need a service worker, so it doesn't remove the need for one.

## 4. Browser support

Sources: MDN browser-compat data for `api.Notification`, `api.Notification.Notification`, `api.Notification.requestPermission_static`, `api.Notification.renotify`, `api.ServiceWorkerRegistration.showNotification` and `api.PushManager.subscribe`, fetched from `bcd.developer.mozilla.org` on 2026-11-16 (shown on each MDN page's compat table). Where WebKit's blog says the same thing, it is cited.

| Browser | `new Notification()` in a tab | `showNotification()` | Web Push | `renotify` | Permission needs a user gesture |
| --- | --- | --- | --- | --- | --- |
| Chrome desktop | Yes (20+). Not in incognito (49+) | Yes (42+) | Yes (42+), `applicationServerKey` required | Yes (50+) | Not enforced, but a quiet UI can apply ([Chrome](https://developer.chrome.com/blog/notification-permission-data-in-crux)) |
| Edge | Yes (14+) | Yes (17+) | Yes (17+), `applicationServerKey` required | Yes (79+) | Same as Chrome (Chromium) (**unverified** for Edge-specific UI) |
| Firefox desktop | Yes (22+) | Yes (44+) | Yes (44+) | **No** | **Yes, 72+.** Otherwise the promise is rejected at once ([BCD](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static#browser_compatibility), [Mozilla Hacks](https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/)) |
| Chrome Android | **Throws `TypeError`**; service worker only | Yes (42+) | Yes (42+) | Yes (50+) | Lighter, non-blocking prompt from Chrome 155. A timed-out request resolves `"default"` ([Chrome](https://developer.chrome.com/blog/notification-prompts-android)) |
| Firefox Android | Yes (22+) per BCD, but see the MDN mobile warning | Yes (44+) | Yes (48+) | **No** | Yes, 79+ |
| Safari macOS | Yes (7+) | Yes (16+, macOS Ventura+) | Yes (Safari 16 on Ventura+ per [WebKit](https://webkit.org/blog/12945/meet-web-push/); the 16.4 post says "16.1") | **No** | Yes for the push subscription ([WebKit](https://webkit.org/blog/12945/meet-web-push/)). MDN: "Safari has done it for some time" |
| Safari iOS/iPadOS, regular tab | **`Notification` is undefined** (`ReferenceError`) | No | No | No | n/a |
| Safari iOS/iPadOS, Home Screen web app | Constructor unavailable; service worker only | Yes (16.4+) | Yes (16.4+); declarative 18.4+ | **No** | **Yes**, "in response to direct user interaction" ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)) |

iOS notes:

- Before iOS 26, a Home Screen web app needed a manifest with `display` set to `standalone` or `fullscreen` ([WebKit 16.4](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- From iOS/iPadOS 26, "every website added to the Home Screen opens as a web app" by default, and a manifest is no longer required ([WebKit, Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)). A manifest is still worth adding for the name and icons.
- Whether a Home Screen web app can call `showNotification()` locally, without a push subscription, while it is in the foreground is **unverified**. WebKit only describes the feature as Push API + Notifications API + service workers together.

## 5. Permission prompt best practice

- **Use a user gesture.** Firefox 72+ and Firefox Android 79+ allow `Notification.requestPermission()` and `PushManager.subscribe()` only "in response to a user gesture such as a click" ([MDN browser-compat data](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static#browser_compatibility)). Firefox rejects other requests and shows only an address-bar icon ([Mozilla Hacks](https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/)). Safari "has done it for some time" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)). iOS requires direct user interaction ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- **Ask in context, after a pre-prompt, never on page load.** web.dev reports 12% acceptance without a gesture versus 30% with one. It advises calling the browser prompt only after the person says yes to your own pre-prompt ([web.dev](https://web.dev/articles/permissions-best-practices)). Chrome recommends placing toggles "as part of preexisting UI surfaces" ([Chrome](https://developer.chrome.com/blog/notification-permission-data-in-crux)). For Cadence, the opt-in could be a "Show desktop notifications" toggle in notification settings or in the bell dropdown.
- **Chrome's quiet UI and enforcement.**
  - Chrome 80 added a quieter permission UI. Sites with very low accept rates are enrolled automatically, separately for mobile and desktop ([Chrome](https://developer.chrome.com/blog/notification-permission-data-in-crux)).
  - Sites rated "Failing" for abusive notifications get notifications and notification requests blocked ([Google Web Tools Help](https://support.google.com/webtools/answer/9799831?hl=en)). **Unverified detail:** the timeline and number of review requests.
  - Chrome may also revoke notification permission on sites with low engagement and high volume ([Chromium blog, Oct 2025](https://blog.chromium.org/2025/10/automatic-notification-permission.html); seen in search results only, not read in full: **unverified**).
- **"Denied" is final for the page.** Browsers honour a permanent denial, and code cannot show the prompt again. Detect it and show how to change the browser's site settings ([web.dev](https://web.dev/articles/permissions-best-practices)). `"default"` means no decision yet, and the app should act as if denied ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)).
- **Reading the state.**
  - `Notification.permission` returns `"default" | "granted" | "denied"` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)).
  - `navigator.permissions.query({ name: "notifications" })` returns `"prompt" | "granted" | "denied"`. The Permissions API's `"prompt"` maps to `"default"` ([WHATWG §2.2](https://notifications.spec.whatwg.org/#permissions-integration), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query)).
  - Chrome advises listening to `PermissionStatus.onchange`, because people can now opt in later from Site Controls ([Chrome](https://developer.chrome.com/blog/notification-prompts-android)).
  - Feature-detect `"Notification" in window` first, because it is undefined in iOS Safari tabs.

## 6. Multi-tab de-duplication

- **`tag` semantics.** When a notification is shown, the user agent looks for an existing notification with the same non-empty `tag` and the same origin. If it finds one, it closes the old one and replaces it (or removes it and appends the new one). The tag is per origin, not per tab or per registration ([WHATWG §2.6](https://notifications.spec.whatwg.org/#showing-a-notification)). So if two tabs both call `showNotification("…", { tag: notificationId })`, the person ends up with **one** OS notification.
- **`renotify`.** The user agent may alert again (sound or vibration) on a replacement only when `renotify` is true. `renotify: true` with an empty tag throws a `TypeError` ([WHATWG §2.6, §3.2](https://notifications.spec.whatwg.org/#showing-a-notification)). Leave `renotify` off so duplicates replace silently. It is unsupported in Firefox and Safari anyway ([MDN browser-compat data](https://developer.mozilla.org/en-US/docs/Web/API/Notification/renotify#browser_compatibility)).
- **Why `tag` alone is not enough.** Two tabs can race, and each replacement fires `close` on the old notification ([WHATWG §2.6](https://notifications.spec.whatwg.org/#showing-a-notification)). How a platform shows "replace" (silently, or as a fresh banner) is UA-defined (**unverified** per OS). Add one of these:
  1. **One leader tab.** Each tab calls `navigator.locks.request("cadence-notifier", () => neverResolvingPromise)`. Only the lock holder acts on live events. When that tab closes, the lock passes to the next tab. Web Locks is Baseline since March 2022 and secure-context only ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)). A `BroadcastChannel` can tell the other tabs to update their bell or mark a Notification read ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)).
  2. **Let the service worker decide (the simplest single choke point).** Pages `postMessage` the event to the service worker. The service worker runs `clients.matchAll({ type: "window" })`, which returns clients "in most recently focused order" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clients/matchAll)). If any `WindowClient.visibilityState === "visible"` (or `focused`) ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WindowClient)), it skips the OS notification because the in-app toast covers it. Otherwise it calls `self.registration.showNotification(title, { tag: id, data: { url } })`.
  3. Under Web Push (Option B) there is a single service worker per origin, so one push makes one notification, with no tab coordination.
- **Show only when hidden.** On the page side, check `document.visibilityState === "hidden"` before notifying. When a tab becomes visible again, close stale notifications ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)). In the service worker, use `registration.getNotifications({ tag })` then `.close()` (**unverified** here; not fetched).
- **Clicks.** In `notificationclick`, call `event.notification.close()`. Then `clients.matchAll({ type: "window" })`: if a Cadence window exists, `focus()` it; if not, `clients.openWindow(url)` ([MDN WindowClient](https://developer.mozilla.org/en-US/docs/Web/API/WindowClient), [MDN openWindow](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow)). `openWindow` needs transient activation, and Firefox allows it only from a notification click. `Client.url` only changes on full page loads, so matching by URL "doesn't work well for single-page apps" ([MDN openWindow](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow)). In Cadence, focus any Cadence window and `postMessage` it the target path, so it navigates with React Router.

## 7. How it fits Cadence

Facts from `main`:

- `react-router` and `@react-router/serve` are 8.3.0. `npm start` runs `react-router-serve ./build/server/index.js`.
- `public/` holds only `favicon.svg` and `images/`. There is no service worker, no web app manifest and no `serviceWorker` code in `app/`.
- No real-time channel exists.
- A sonner `<Toaster position="bottom-right" richColors closeButton />` is already mounted in `app/routes/layout.app.tsx` (line ~247).
- `app/lib/mailer.server.ts` exists, which matters for the Digest.
- ADR 0006 says Cadence runs one server process on one SQLite file through Drizzle (`app/db/schema.ts`), so in-memory fan-out to connected tabs works.

**Serving `/sw.js`.**

- `@react-router/serve` 8.3.0 (`node_modules/@react-router/serve/dist/cli.js`, lines 111–120) builds an Express app. It mounts:
  - `express.static(<assetsBuildDirectory>/assets, { immutable: true, maxAge: "1y" })` at `/assets`
  - `express.static(assetsBuildDirectory)` at the public path (`/`), where the default `assetsBuildDirectory` is `../client` relative to the server build, so `build/client`
  - `express.static("public", { maxAge: "1h" })`
- Vite copies `public/` to the root of the build output "as-is" ([Vite](https://vite.dev/guide/assets)), so `public/sw.js` becomes `build/client/sw.js`. It is served at `/sw.js` by the second middleware, without long-term caching, and can register with `scope: "/"`. In dev, Vite serves `public/` at `/` too.
- Write `sw.js` as plain JS. It sits outside Vite's bundle, so no TS or imports, unless a build step is added.
- Register it from a client-only effect in `app/root.tsx` or `layout.app.tsx`, for example `useEffect(() => navigator.serviceWorker?.register("/sw.js"))`. The server never runs it, so SSR is unaffected.

### Option A: tab-only (recommended first step)

1. The live channel (SSE or WebSocket, decided elsewhere) pushes each new Notification to every Online tab.
2. Every tab updates the bell. A visible tab shows the sonner toast.
3. Every tab forwards the event to the service worker. The service worker skips if any Cadence window is visible. Otherwise it calls `showNotification(title, { body, tag: notification.id, data: { url } })`. (Or use a Web Locks leader tab.)
4. `notificationclick` focuses a Cadence window and tells it to navigate.
5. Permission comes from a "Desktop notifications" toggle (a click), with a pre-prompt, and shows a settings help text when denied.

What it costs: `public/sw.js` (~40 lines), registration, a permission toggle and a client bridge. Option A needs no VAPID keys, no DB table and no new dependency.

What it reaches:

- Desktop Chrome, Edge, Firefox and Safari while a Cadence tab is open but hidden. That matches "Online".
- Little or nothing on phones: an iOS tab has no API, and backgrounded mobile pages don't run.
- Whether hidden desktop tabs keep receiving SSE/WebSocket events promptly under background throttling is **unverified**. Test this in Chrome's intensive-throttling mode before relying on it.

### Option B: Web Push

Everything in A, plus:

- VAPID keys in env
- `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` from the same click
- a `push_subscription` table in `app/db/schema.ts` (a migration)
- a server sender (`web-push`) that runs when a Notification is created, with 404/410 cleanup and TTL/urgency
- a `push` handler in `sw.js`
- for iOS: a manifest, and asking people to add Cadence to the Home Screen first

What it reaches: people with no tab open, including Android Chrome and iOS Home Screen web apps. It reaches **Away** people, which overlaps the Digest. That is a product decision, not just a technical one.

Is Web Push "required on iOS anyway"? On iOS, OS notifications exist only for Home Screen web apps ([MDN browser-compat data](https://developer.mozilla.org/en-US/docs/Web/API/Notification#browser_compatibility), [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Whether such an app can show a local `showNotification()` without push is **unverified**. Even if it can, an iOS web app in the background doesn't run its live channel, so in practice only Web Push gives iOS people OS notifications.

### Recommendation

Ship **Option A** for the PRD. It meets "OS notifications while Online" on desktop at low cost and with no new infrastructure. It also builds the pieces Option B would reuse: `sw.js`, the permission UX and `notificationclick`. The trade-off is that mobile people get only the in-app experience. Treat **Option B** as a follow-up, to pick only if Cadence wants to reach Away people or phones in real time. That means deciding how it interacts with the 8 am Digest, and accepting the cost of keys, a table and a sender.

## Open questions for the PRD

1. Should OS notifications fire only when every Cadence tab is hidden, or also when the tab is visible but the window is unfocused?
2. Which Notification types justify an OS notification? Probably not all, given Chrome's quiet-UI and abuse signals.
3. Where does the opt-in live: notification settings, the bell, or a contextual moment such as after enrolling? What does the pre-prompt say?
4. Is "Desktop notifications" a per-device setting (browser permission) only, or also a per-person preference stored server-side?
5. Do we accept that phone people (iOS especially) get no OS notifications in v1?
6. If Option B comes later, does a push subscription change "Away" handling? For example, does it suppress or shorten the Digest?
7. Which roles get OS notifications (Student, Instructor, Team Admin, Platform Admin)? Are any types admin-only?
8. Does the deployment run on HTTPS in every environment where this must work? Service workers need a secure context.

## Sources

- WHATWG Notifications API: https://notifications.spec.whatwg.org/
- W3C Push API (Working Draft): https://www.w3.org/TR/push-api/
- RFC 8030 (Generic Event Delivery Using HTTP Push): https://www.rfc-editor.org/rfc/rfc8030
- RFC 8291 (Message Encryption for Web Push): https://www.rfc-editor.org/rfc/rfc8291
- RFC 8292 (VAPID): https://www.rfc-editor.org/rfc/rfc8292
- MDN, Notification() constructor: https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification
- MDN, Notification.requestPermission(): https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static
- MDN, Using the Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API
- MDN, Using Service Workers: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- MDN, Secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- MDN, Clients.matchAll(): https://developer.mozilla.org/en-US/docs/Web/API/Clients/matchAll
- MDN, Clients.openWindow(): https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow
- MDN, WindowClient: https://developer.mozilla.org/en-US/docs/Web/API/WindowClient
- MDN, Web Locks API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- MDN, Broadcast Channel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
- MDN, Permissions.query(): https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query
- MDN browser-compat data (`bcd.developer.mozilla.org/bcd/api/v0/current/api.{Notification,ServiceWorkerRegistration,PushManager}.json`), fetched 2026-11-16
- Chromium issue 481856: https://crbug.com/481856
- WebKit, Meet Web Push (Safari 16, macOS Ventura): https://webkit.org/blog/12945/meet-web-push/
- WebKit, Web Push for Web Apps on iOS and iPadOS (16.4): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit, Features in Safari 16.4: https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
- WebKit, Meet Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
- WebKit, Features in Safari 18.4: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- WebKit, Features in Safari 18.5: https://webkit.org/blog/16923/webkit-features-in-safari-18-5/
- WebKit, Features in Safari 26.0: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Mozilla Hacks, Upcoming notification permission changes in Firefox 72: https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/
- web.dev, Permissions best practices: https://web.dev/articles/permissions-best-practices
- Chrome for Developers, Notification permission data in CrUX (quiet UI): https://developer.chrome.com/blog/notification-permission-data-in-crux
- Chrome for Developers, Lighter notification prompts on Android (Chrome 155): https://developer.chrome.com/blog/notification-prompts-android
- Chrome for Developers, Web push rate limits: https://developer.chrome.com/blog/web-push-rate-limits
- Google Web Tools Help, Abusive notification reviews: https://support.google.com/webtools/answer/9799831?hl=en
- web-push README: https://github.com/web-push-libs/web-push (raw README read 2026-11-16); npm metadata: https://registry.npmjs.org/web-push/latest
- Vite, The public directory: https://vite.dev/guide/assets
- `@react-router/serve` 8.3.0 source, `dist/cli.js` lines 111–120 (local `node_modules`)
