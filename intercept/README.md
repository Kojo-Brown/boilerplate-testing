# Faking the network, and what each way of doing it costs

> `page.route`, `page.routeFromHAR` and `context.setOffline` — eight wirings,
> twelve probes, two conditions, measured in Chromium against an origin this
> directory starts.

```bash
pnpm test:intercept                # the matrix and the two behaviour suites, in a browser
pnpm test intercept/               # the wirings, the classifiers and the recording audit
pnpm intercept:record              # re-take har/origin.har — read the warning first
```

## The question this answers

Every end-to-end suite past a certain size fakes the network, and the
literature on how stops at "here is how to intercept a request". The question
it does not ask is what the fake takes away — which of your application's
behaviours stop being exercised the moment the responses stop coming from a
server.

That is not a question about HTTP. It is a question about a specific
interception mechanism in a specific browser, so it is measured rather than
reasoned about: [`matrix.ts`](./matrix.ts) declares 192 cells,
[`fidelity.spec.ts`](./fidelity.spec.ts) checks every one of them against
Chromium on each run, and [`matrix.test.ts`](./matrix.test.ts) restates each
finding below as an assertion over the table. Nothing here is quoted from
documentation. Several cells are the opposite of what the first draft
predicted.

**The headline, before the tables**: the most common way to "simulate being
offline" in a Playwright suite — aborting the requests — is, with no network
behind it, *identical in every respect* to Chromium's offline emulation except
that the page never finds out. An application with an offline banner, a sync
queue or a retry-when-back queue has none of that exercised, and the suite is
green.

## The eight wirings

| wiring | what it installs | why somebody reaches for it |
| --- | --- | --- |
| `live` | Nothing is intercepted. | The control. Every other row is only interesting as a difference from this one, and under `severed` it is the reason the other seven exist. |
| `stub-fulfill` | `route(API_GLOB)` answering from a hand-written table, `fallback()` for the rest. | The fake people write first, because it needs no tooling and no recording. Its bodies are the ones the author imagined rather than the ones the origin sends. |
| `har-abort` | `routeFromHAR(har, { url: API_GLOB, notFound: 'abort' })`. | The recording, scoped to the API and closed: anything it does not hold fails. The honest HAR wiring, and the one whose failures are loud. |
| `har-fallback` | `routeFromHAR(har, { url: API_GLOB, notFound: 'fallback' })`. | Playwright's default, and one word apart from the row above. The word decides whether a suite that has outgrown its recording tells you so or quietly resumes using the network. |
| `har-whole-page` | `routeFromHAR(har, { notFound: 'abort' })` — no URL filter. | The same recording with the scope taken off, so the document and its stylesheet replay too. Almost nobody writes this one, and it is the only wiring here that is a complete offline replay of the application. |
| `abort-api` | `route(API_GLOB, route => route.abort('internetdisconnected'))`. | What "simulate the network being down" usually means in a test suite. The error code is the one Chromium reports for a disconnected machine, which is as far as the resemblance goes. |
| `offline` | `setOffline(true)`. | Chromium's own offline emulation, which is a statement about the connection rather than about any URL — and therefore the only wiring here the page can detect. |
| `offline-har` | `setOffline(true)` plus `routeFromHAR(har, { notFound: 'fallback' })`. | The combination an offline-capable application actually needs: the page is told it is offline, and the requests it makes anyway are still answered, because a fulfilled route never touches the connection the emulation switched off. |

## The twelve probes

| probe | question | possible answers |
| --- | --- | --- |
| `document` | Does the page load at all? | `origin`, `failed` |
| `static-asset` | Does the stylesheet the document links arrive? | `origin`, `failed` |
| `known-get` | Does a GET that is in the recording, and unchanged since, still answer? | `origin`, `stub`, `failed` |
| `reaches-origin` | Did that GET actually leave the browser? | `reached`, `not-reached` |
| `drifted-get` | What does a GET answer after the origin changed its shape? | `origin`, `stale`, `stub`, `failed` |
| `unrecorded-get` | What happens when the app starts calling an endpoint the fake never saw? | `origin`, `stub`, `failed` |
| `query-variance` | Does the same path with a cache-busting query still match the recording? | `origin`, `stub`, `failed` |
| `post-echo` | Does a POST whose answer depends on its body get the answer for the body it sent? | `echoes-sent`, `echoes-recorded`, `stub`, `failed` |
| `retry-recovers` | Does the client's retry path run? | `recovered`, `first-try`, `failed` |
| `online-flag` | What does `navigator.onLine` say? | `online`, `offline` |
| `offline-event` | Does an `offline` event reach a listener the page installed? | `fired`, `silent` |
| `observed-by-test` | Does `page.on('request')` see the request? | `observed`, `unobserved` |

The one cell value worth defining before the tables is **`stale`**: the request
succeeded, the body is stamped as having come from the origin, and the origin
stopped sending that body some time ago. It is the only outcome here that
describes a *successful* response as a problem, and it is the one a suite
reading the recording never sees.

## Connected: the browser can reach the origin

Anything a wiring declines ends up on a socket, which is what makes a leaky
fake invisible.

| probe | live | stub-fulfill | har-abort | har-fallback | har-whole-page | abort-api | offline | offline-har |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `document` | origin | origin | origin | origin | origin | origin | failed | origin |
| `static-asset` | origin | origin | origin | origin | origin | origin | failed | origin |
| `known-get` | origin | stub | origin | origin | origin | failed | failed | origin |
| `reaches-origin` | reached | not-reached | not-reached | not-reached | not-reached | not-reached | not-reached | not-reached |
| `drifted-get` | origin | stub | stale | stale | stale | failed | failed | stale |
| `unrecorded-get` | origin | origin | failed | origin | failed | failed | failed | failed |
| `query-variance` | origin | stub | failed | origin | failed | failed | failed | failed |
| `post-echo` | echoes-sent | stub | failed | echoes-sent | failed | failed | failed | failed |
| `retry-recovers` | recovered | first-try | failed | failed | failed | failed | failed | failed |
| `online-flag` | online | online | online | online | online | online | offline | offline |
| `offline-event` | silent | silent | silent | silent | silent | silent | fired | fired |
| `observed-by-test` | observed | observed | observed | observed | observed | observed | observed | observed |

## Severed: every request the wiring declines is aborted before it leaves the browser

A runner with no egress, or a laptop on a train. The origin is still running,
so the specs can still ask it what it was asked — which is how the
`reaches-origin` row is measured at all.

| probe | live | stub-fulfill | har-abort | har-fallback | har-whole-page | abort-api | offline | offline-har |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `document` | failed | failed | failed | failed | origin | failed | failed | origin |
| `static-asset` | failed | failed | failed | failed | origin | failed | failed | origin |
| `known-get` | failed | stub | origin | origin | origin | failed | failed | origin |
| `reaches-origin` | not-reached | not-reached | not-reached | not-reached | not-reached | not-reached | not-reached | not-reached |
| `drifted-get` | failed | stub | stale | stale | stale | failed | failed | stale |
| `unrecorded-get` | failed | failed | failed | failed | failed | failed | failed | failed |
| `query-variance` | failed | stub | failed | failed | failed | failed | failed | failed |
| `post-echo` | failed | stub | failed | failed | failed | failed | failed | failed |
| `retry-recovers` | failed | first-try | failed | failed | failed | failed | failed | failed |
| `online-flag` | online | online | online | online | online | online | offline | offline |
| `offline-event` | silent | silent | silent | silent | silent | silent | fired | fired |
| `observed-by-test` | observed | observed | observed | observed | observed | observed | observed | observed |

## What the tables say

Each of these is a function over the matrix in [`matrix.ts`](./matrix.ts)
rather than a sentence. Edit a cell and the paragraph it contradicts fails the
build.

**Aborting requests and going offline differ on nothing but belief.** With no
network behind either, `abort-api` and `offline` agree on ten of twelve probes
and disagree on exactly `online-flag` and `offline-event`. Every request fails
either way; only one of them tells the page. An `offline` banner, a queue that
drains on `online`, a service worker registered when the connection returns —
none of it is reached by the wiring most suites use.

**`notFound: 'fallback'` and `notFound: 'abort'` are the same wiring with no
network behind them.** Under `severed` the two rows are identical. Under
`connected` they differ on exactly three probes — `unrecorded-get`,
`query-variance` and `post-echo` — and those three *are* the leak: they are the
requests the fallback quietly answered over a socket. A HAR suite on the
default setting works locally and fails the first time it runs somewhere
without egress, and the three cells above are the list of what it was really
doing.

**A replay is indistinguishable from the origin, which is the feature and the
bug.** Five wirings answer `known-get` with a body stamped `origin`; exactly
one of them reached the origin. Nothing in the response says which — a
recording is a copy of those bytes. The only instrument that can tell them
apart is the origin's own ledger, read over a socket the browser has no part
in, and no real test suite has one.

**Every replay is stale, and staleness is silent.** All four replaying wirings
answer `drifted-get` with `stale`: the recording holds `schema: 1`, where a
feed item is a string, and the origin now serves `schema: 2`, where it is an
object. A suite reading the recording is green against an API that would hand
it `undefined`. This is the failure mode a HAR has that a hand-written stub
does not have *more* of — both are frozen — but a stub is visibly somebody's
guess, and a recording looks like evidence.

**A recording is keyed on the whole request.** A cache-busting query and a POST
body the recording has not seen are both misses, so a client that appends `?_=`
or a request id to its GETs replays nothing at all. The match is on the
request, not on the endpoint, and nothing about a HAR-based suite announces
that until the day somebody adds a parameter.

**The feared answer does not actually happen.** No cell in the table reads
`echoes-recorded`: Playwright compares the request body, so a POST whose
payload has changed misses loudly rather than being answered with somebody
else's recording. That is the better of the two failures, and it is the same
property as the paragraph above — the strictness that makes a replay brittle is
the strictness that stops it lying.

**The recorded failure is the one that replays.** The recording holds both
answers the flaky endpoint gave — a 503 and then a 200 for the same URL — and
every replaying wiring serves the 503 to both attempts. A client that recovered
against the origin cannot recover against the recording, and the suite reports
a bug in a retry that works.

**A stub deletes the retry entirely.** `stub-fulfill` answers `/api/flaky` with
a 200 because the person who wrote the table wrote the happy path, so the retry
branch is never entered: `first-try` where the origin gives `recovered`. Every
assertion about the response still passes. This is the general shape of what a
hand-written fake costs — not wrong answers, but unreachable code.

**Counting requests proves nothing.** `page.on('request')` fires in all
sixteen rows, including the ones where nothing left the browser. `expect(requests).toHaveLength(1)`
is a statement about the client and carries no information about the network.

**Offline does not mean empty, and that is what makes it usable.**
`setOffline(true)` switches off the *connection*; a route handler that fulfils
never touches it. `offline-har` is the only wiring here where the page believes
it is disconnected **and** the application still loads and answers — which is
the arrangement you need to test an offline-capable application at all, and
which neither "abort everything" nor "setOffline and hope" gives you.

**Only a whole-page replay survives.** With no network, `har-whole-page` and
`offline-har` are the only wirings where the document loads: everything else
scopes its replay to `**/api/**` and leaves the HTML and the CSS to a network
that is not there. `offline.spec.ts` takes that one step further than the table
can and asserts the *computed colour* of an element, so the claim is that
Chromium parsed and applied a replayed stylesheet rather than that a request
returned 200.

## Choosing one

The table does not have a winner, and a league table would be dishonest here in
a way it is not for the other matrices in this repository: these wirings are
answers to different questions.

- **Asserting on your own UI, against data you control** → `stub-fulfill`.
  Cheapest, most readable, and the most likely to drift from the API. Pair it
  with contract tests ([`pact/`](../pact/README.md)) or schema conformance
  ([`openapi/`](../openapi/README.md)), which are the things that notice the
  drift this wiring cannot.
- **Replaying real traffic** → `har-abort`, never `har-fallback`. The closed
  setting is the one that tells you when the recording has been outgrown, and
  the three-cell difference above is what the open one is hiding.
- **Testing an offline-capable application** → `offline-har`. The page must be
  told, and the assets must still arrive.
- **Testing that an application survives a dead API** → `abort-api` *and*
  `offline`, not either alone. They exercise different halves of the
  application's response to failure.
- **Never** → a recording as the only defence against the API changing. Nothing
  in the `severed` table can notice that, because a recording cannot be wrong
  about itself.

## How it is wired

- **[`origin.ts`](./origin.ts)** — the fixture origin as a pure function of a
  request: seven routes plus two control endpoints. Every JSON body is stamped
  with its source, which is the measuring instrument the whole matrix rests on.
  [`server.ts`](./server.ts) is the only file here that touches `node:http`.
- **[`wirings.ts`](./wirings.ts)** — the eight wirings, applied through a
  three-method port that Playwright's `BrowserContext` satisfies structurally.
  That is why [`wirings.test.ts`](./wirings.test.ts) can assert what each one
  installs in milliseconds, without a browser.
- **[`client.ts`](./client.ts)** — the code that runs inside the page, handed
  to `page.evaluate`. No imports and no closures: the closure does not travel.
- **[`har/origin.har`](./har/origin.har)** — seven entries, recorded against
  schema 1, committed. [`har.test.ts`](./har.test.ts) asserts it is still the
  *older* recording, holds no cache-busted URL, and carries no
  credential-shaped header.
- **[`session.ts`](./session.ts)** — the five steps every spec performs in the
  same order. The order is the experiment: a connection listener installed
  after the wiring misses the only `offline` event there is.
- **CI** — the `intercept` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
  on one Node major. Required, not advisory.

The census in [`shape/`](../shape/README.md) classifies the three specs here as
`e2e` and everything else in the directory as `unit` or `integration`, which is
the split the directory is built around: the browser answers what only a
browser can, and everything else answers the rest without one.

## Four things that cost an afternoon

**A HAR is matched by URL, and a URL contains a port.** Recording against an
ephemeral port produces a file that replays against nothing. `ORIGIN_PORT` is
fixed at 3111 for that reason — clear of `ct/`'s bundler on 3100 and the
application config's 5173 — and the recorder and the `webServer` both read it
from the same constant.

**`fetch` from `about:blank` measures CORS, not routing.** Every probe needs a
loaded document to issue its request from, so each cell loads the page *before*
the wiring is applied and navigates again at the end for the `document` probe.
A first draft applied the wiring first, and every `severed` row came back
`failed` for a reason that had nothing to do with the wiring.

**Route handlers are tried newest-first.** The severing handler is registered
before the wiring's own, which is what makes it a backstop rather than a
blanket: the wiring sees every request first and the abort receives only what
it declined — by not matching, or by calling `fallback()`. Registered the other
way round, all eight rows are identical.

**Re-recording erases the measurement.** Two probes exist because the committed
recording is out of date, and `pnpm intercept:record` pins the origin to schema
1 so that a re-record keeps it that way. `har.test.ts` fails if the recording
ever holds today's schema — a fixture whose value depends on being stale needs
a test saying so, because nothing else about the file communicates it.
