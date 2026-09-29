# Auth state reuse, and what "per worker" turns out to mean

Two questions get asked as one. **Reuse** is about how many times a suite signs
in; **isolation** is about how many accounts it signs in *as*. `storageState`
answers the first. It has no opinion at all about the second, and the recipe
most often reached for answers the second only until a test fails.

This directory measures both halves against a real browser and a real session
server, and re-derives every published cell on every run.

- **Capture** — 4 wirings × 7 probes, in Chromium. What is still in a context
  built from a saved file. `pnpm test:authstate`.
- **Isolation** — 5 strategies × 3 hazards + 2 costs, from 10 real
  `playwright test` runs. What survives two workers and one restart. No browser;
  rides `pnpm test`.

The fixture server is the instrument, and one rule in it is load-bearing: **an
account has one live session, and a new sign-in ends the old one.** Most
fixture servers mint an independent token per login, and a suite measured
against one reports every strategy as equally safe — which is not the server
teams actually deploy, and not the reason they went looking for `storageState`.

---

## Half one: what a saved file still has in it

Each wiring signs in its own way, saves with `storageState`, and a **fresh
context built from that file** is asked all seven probes. Nothing is asked of
the context that did the signing in: it holds the session in memory and would
report every recipe as perfect.

| wiring          | cookie  | local-storage | session-storage | indexed-db | server-gate | spa-gate   | idb-gate   |
| --------------- | ------- | ------------- | --------------- | ---------- | ----------- | ---------- | ---------- |
| `api-only`      | present | absent        | absent          | absent     | signed-in   | signed-out | signed-out |
| `api-then-seed` | present | present       | absent          | absent     | signed-in   | signed-in  | signed-out |
| `ui-login`      | present | present       | absent          | absent     | signed-in   | signed-in  | signed-out |
| `ui-login-idb`  | present | present       | absent          | present    | signed-in   | signed-in  | signed-in  |

### The wirings

| wiring | what it does | where it comes from |
| --- | --- | --- |
| `api-only` | Sign in with an API request and save. No page is ever opened. | Playwright's authentication guide, "Authenticate with API request". |
| `api-then-seed` | Sign in with an API request, open a page, write the token to storage by hand, save. | The workaround written on the day `api-only` turns out not to sign a single-page application in. |
| `ui-login` | Drive the real sign-in form and save whatever the application wrote. | Playwright's authentication guide, the headline recipe. |
| `ui-login-idb` | Drive the real sign-in form and save with `{ indexedDB: true }`. | The option added in Playwright 1.51, whose documentation names Firebase Authentication as the case. |

### The probes

Four ask what the **file** contains; three ask whether an **application** would
consider the restored browser signed in. They are different questions and get
different vocabularies — `present`/`absent` against `signed-in`/`signed-out` —
rather than a shared "pass", because the whole argument of this half is that
they have different answers.

The three gate pages are the same session seen by three applications: `/app/server`
renders the verdict server-side from the cookie, `/app/spa` reads `localStorage`,
and `/app/idb` reads IndexedDB the way an auth SDK does.

### The control, and why every `absent` depends on it

"`sessionStorage` is absent in all four rows" is a finding about `storageState`
only if the sessions put a token in `sessionStorage` to begin with. A fixture
that quietly never wrote one produces the identical column and an identical
finding — about the fixture.

So `wirings.ts` declares what each recipe leaves in the **live** browsing
context, and `capture.spec.ts` checks that against the browser before reading
the file. `ui-login` is declared as writing all three client stores, and the
control is read from the page that signed in rather than a fresh one, because
`sessionStorage` is scoped to a browsing context: a second tab in the same
`BrowserContext` reports it empty, and a control that opened its own page would
"discover" the token missing before `storageState` had been anywhere near it.

### What the table says

**No wiring keeps `sessionStorage`.** The column is constant across four
genuinely different recipes, including the one that drives the real sign-in form
and therefore had a token in `sessionStorage` at the moment it saved. A team
that moved its token out of `localStorage` after a security review has moved it
somewhere no capture will follow it, and the symptom is a suite that signs in
perfectly and lands on a login page.

**Driving the real UI buys nothing over hand-seeding.** `ui-login` and
`api-then-seed` agree on all seven cells. One of them runs the application's own
sign-in path and one of them writes a string into `localStorage` from the
outside, and the saved files are indistinguishable — because the fidelity of the
capture is decided by `storageState`, not by how faithfully the session was
established. The expensive recipe is worth its cost for other reasons (it
exercises the login path, it fails when the login page breaks); *what it saves*
is not one of them.

**One option moves exactly two cells.** `{ indexedDB: true }` is the only
difference between `ui-login` and `ui-login-idb`, and it moves the IndexedDB
store and the gate that reads it and nothing else. If your auth SDK keeps the
session there, those two cells are the entire difference between a suite that
works and a suite that does not, and it is one word.

**Whether `api-only` works is a property of your application, not of the
recipe.** The fastest recipe in the documentation signs one of the three
applications in and neither of the other two. It is completely correct for a
session-cookie application and completely useless for a token-bearing one, and
nothing about the recipe says which you have.

**The `HttpOnly` cookie is the one thing every wiring keeps.** The single
credential no page script could have read — and therefore the one no
hand-written workaround could ever have saved — is present in all four rows,
while every other storage column has an `absent` in it somewhere. `storageState`
reads the cookie jar over the protocol rather than out of the document, which is
why the hardest credential to fake is the easiest one to carry.

### What this half does not say

Chromium only. Every cell here is decided by Playwright's serialisation of a
context rather than by an engine's storage implementation, and the one arguable
exception — IndexedDB — is decided by an option on a Playwright call. Rederiving
the table in three engines would cost three browsers to restate one library's
behaviour; the cross-browser matrix is `matrix/`.

---

## Half two: what survives two workers and one restart

Five strategies, each measured by two real `playwright test` runs against a live
origin: a **parallel** phase with two workers, and a **restart** phase with one
worker, one retry, and a test that fails on purpose to discard it.

| strategy             | session-eviction | parallel-mutation | restart-inheritance | cleared | logins | accounts |
| -------------------- | ---------------- | ----------------- | ------------------- | ------- | ------ | -------- |
| `shared-lazy`        | evicted          | unreachable       | inherited           | 0/3     | 4      | 2        |
| `shared-file`        | survives         | collided          | inherited           | 1/3     | 2      | 2        |
| `per-parallel-index` | survives         | isolated          | inherited           | 2/3     | 3      | 3        |
| `per-worker-index`   | survives         | isolated          | fresh               | 3/3     | 4      | 4        |
| `per-test`           | survives         | isolated          | fresh               | 3/3     | 6      | 5        |

### The strategies

| strategy | what it does | where it comes from |
| --- | --- | --- |
| `shared-lazy` | Every worker signs into the same account itself. Nothing is saved or reused. | What a suite does before anybody has heard of `storageState`. The control. |
| `shared-file` | A setup project signs in once into one account and saves it; every worker restores that one file. | Playwright's authentication guide, the headline recipe. |
| `per-parallel-index` | One account per `parallelIndex`, restored from the slot's file if there is one. | Playwright's authentication guide, "Moderate: one account per parallel worker". |
| `per-worker-index` | The same recipe keyed on `workerIndex`. | Not a published recipe. One identifier different from the row above. |
| `per-test` | A fresh account per test. | Playwright's authentication guide, "Advanced: one account per test". |

### The hazards

| hazard | what it asks | how it is read |
| --- | --- | --- |
| `session-eviction` | Does one worker signing in end another worker's session? | A ledger row whose `GET /api/me` answered 401. |
| `parallel-mutation` | Does a worker read data a different worker wrote? | A ledger row whose notes contain the other spec's marker. |
| `restart-inheritance` | When a failed test discards a worker, does its replacement resume the dead worker's account? | Two rows at one `parallelIndex` with different `workerIndex` values and the same account. |

### What the table says

**`shared-lazy`'s `unreachable` is a cell that must not be read as good news.**
The collision did not happen because it could not happen: one of the two workers
had already been signed out, and a worker with no session writes nothing. The first version of this derivation scored that cell `isolated`, which
put the worst strategy in the table level with the best ones on the column it is
worst at — and did so *because* it had failed the column to its left. A hazard
that could not be posed is now reported as not posed, and `derive.test.ts` fixes
the ordering against ledgers no real run produces.

**Reuse is not isolation.** `shared-file` — the headline `storageState` recipe —
clears `session-eviction` and still reads `collided`. Signing in once instead of
once per worker is a statement about logins; it says nothing about whose data
the workers are looking at, and the table's cheapest row (2 logins) is also the
one that changed the least about correctness.

**One identifier, one cell.** `per-parallel-index` and `per-worker-index` differ
in exactly one hazard: `restart-inheritance`. Playwright discards a worker when
a test in it fails and starts a replacement with a **new `workerIndex` and the
same `parallelIndex`** — so the documented recipe's `existsSync` branch finds the
dead worker's saved file and resumes its account, including whatever that
account's server-side state had become. The recipe delivers the isolation it is
famous for and loses it in the one circumstance nobody tests it in: after a test
has already failed, which is when the suite is being read most carefully and
trusted least.

**The inheritance is visible in the cost column too.** `per-parallel-index`
signs in three times where `per-worker-index` signs in four, and the login it
saves is exactly the replacement worker restoring a file instead of getting an
account of its own. The cheaper number is the bug.

**The most isolated option in the documentation buys nothing over the
one-identifier change.** `per-test` and `per-worker-index` clear all three
hazards, and `per-test` pays two more sign-ins and one more account for it. That
is not an argument against per-test isolation in general — it protects against
hazards this table does not contain, such as a test that mutates an account's
own profile — but on the three measured here it is a price with nothing behind
it.

**Nothing is both cheap in accounts and clean.** Every strategy that clears all
three hazards uses at least one account per worker, and there is no row that is
both. That is the trade, stated rather than resolved: a suite whose account
provisioning is expensive is choosing between `per-parallel-index` and knowing
what happens to it after a failure.

### Determinism

No sleeps, no wall clock, no randomness, no polling. The two workers in the
parallel phase are ordered against each other by **named barriers** at the
origin: a worker parks on `/api/barrier?name=…&parties=2` and is released when
its partner arrives, so "after the other worker has had its chance to evict me"
is a rendezvous rather than a duration. The restart is provoked by a test that
throws when `testInfo.retry === 0`, which fails once and passes once, every
time. Session ids come from a counter rather than `randomUUID`.

The one timer in the directory is `server.ts`'s deadline on a parked request,
which turns a barrier that will never fill — because a worker died, or because
the run used a different worker count than the barrier was written for — into a
504 naming the barrier rather than a hang somewhere else. It is registered in
`determinism/registry.ts`.

---

## Layout

| file | what it is |
| --- | --- |
| `origin.ts` | The session server's routes and state. Pure; no socket. |
| `server.ts` | The socket, and the parked-request deadline. |
| `wirings.ts`, `probes.ts` | The capture half's four recipes and seven questions. |
| `capture.ts` | The capture table, declared. |
| `capture.spec.ts` | The capture table, measured in Chromium. |
| `strategies.ts` | The five isolation strategies and the account-resolution rule. |
| `isolation.ts` | The isolation table, declared. |
| `derive.ts` | Ledger → verdicts. Pure, and tested against ledgers no run produces. |
| `runs.test.ts` | The isolation table, measured by ten real `playwright test` runs. |
| `findings.ts` | Every published claim, as a predicate over the two tables. |
| `render.ts` | The tables above, rendered — `readme.test.ts` compares the text. |
| `fixture/` | The suite the isolation runs drive. Subjects, not tests; one fails on purpose. |

## Running it

```
pnpm test               # the isolation half, the unit suites, the README audit
pnpm test:authstate     # the capture half — needs Chromium
```

`fixture/` is excluded from every runner in the repository and listed in
`EXPECTED_EMPTY` in `shape/collect.ts`, for the reason `matrix/fixture/` and
`trace/attempts/` are: those files are the subject of a measurement rather than
tests of anything, one of them is red by design, and counting them would put
five end-to-end declarations into the pyramid ratio for files nobody wrote to
catch a bug.
