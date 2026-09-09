# Consumer-driven contract testing, with a broker

Two consumer suites, a real provider, a real [Pact Broker](https://docs.pact.io/pact_broker),
and a measurement of what the broker is actually for.

```
pact/
  consumer/    the contracts, written from the consumer's side
  provider/    a real provider, verified against them
  broker/      publish / can-i-deploy / record-deployment over the broker's HTTP API
  pipeline/    four wirings × twelve scenarios, run against a real broker
```

| command | what it runs | needs a broker |
| --- | --- | --- |
| `pnpm pact:consumer` | the consumer suites; writes `pacts/` | no |
| `pnpm pact:provider` | provider verification against that file | no |
| `pnpm test:pact` | both, in that order | no |
| `pnpm test:pact:broker` | the pipeline matrix | **yes** |

`PACT_BROKER_BASE_URL` points the last one at a broker; without it the suite
skips itself and says so. CI runs `pactfoundation/pact-broker` as a service
container, so the matrix below is re-derived on every pull request.

## What was here before, and what was wrong with it

The Phase 4 item "contract testing example with Pact" left the consumer half
working and the provider half described. That is the ordinary shape of a
half-built contract-testing setup — the consumer half needs nothing but the
consumer — and it hides two failures that are worth naming, because neither is
visible from a green build.

**The consumer suites had never run.** `MatchersV3.regex(...)` was passed as
the `Content-Type` header value; the pact FFI parses that header as a content
type, fails, and `unwrap()`s the error, so `pactffi_with_body` panics and takes
the worker process with it — `fatal runtime error: failed to initiate panic`,
no test results, exit 1. A literal `'application/json'` is the fix. A matcher
on `Content-Type` was never expressing anything anyway.

**Provider verification had never run either.** The verify suite was pointed at
`PROVIDER_BASE_URL`, skipped itself when that was unset, and listed six state
handlers whose bodies were comments. There was no provider in the repository
for it to verify. `provider/app.ts` is one now.

Getting it green surfaced a third thing, which is a real design point rather
than a bug: `given('a valid refresh token exists')` is **unsatisfiable** without
a parameter. The provider seeds a token it invented, the verifier replays the
consumer's example value, and the two are different strings — so the
interaction fails with a 401 that reads as a provider bug. The fix is
`given('a valid refresh token exists', { refreshToken: … })`: the consumer says
which token it will present and the provider makes that one valid.

## The measurement

Four wirings, twelve scenarios, every cell a real verification against a real
broker. `pipeline/scenarios.ts` states, for each scenario, whether it actually
breaks the consumer *that is running in production* — so a cell is scored
against ground truth rather than counted as a detection:

- **caught** — breaks, and something went red.
- **missed** — breaks, and nothing went red.
- **quiet** — safe, and nothing went red. The right answer.
- **false-alarm** — safe, and something went red.

Three of the twelve are safe, because a table of breaking changes only measures
how loud a wiring is and "fail everything" would win it.

<!-- MATRIX -->
| scenario | truth | files-stale | files-fresh | broker | broker-pending |
| --- | --- | --- | --- | --- | --- |
| `NOTHING_CHANGED` | safe | quiet/none | quiet/none | quiet/none | quiet/none |
| `USER_ROLE_REMOVED` | breaks | caught/provider-ci | caught/provider-ci | caught/provider-ci | caught/provider-ci |
| `CREATED_AT_RENAMED` | breaks | caught/provider-ci | caught/provider-ci | caught/provider-ci | caught/provider-ci |
| `USER_ID_STRINGIFIED` | breaks | missed/none | missed/none | missed/none | missed/none |
| `CREATE_STATUS_CHANGED` | breaks | caught/provider-ci | caught/provider-ci | caught/provider-ci | caught/provider-ci |
| `ROLE_VALUE_RENAMED` | breaks | caught/provider-ci | caught/provider-ci | caught/provider-ci | caught/provider-ci |
| `SCOPE_HEADER_REQUIRED` | breaks | caught/provider-ci | caught/provider-ci | caught/provider-ci | caught/provider-ci |
| `LOGOUT_ROUTE_REMOVED` | breaks | caught/provider-ci | caught/provider-ci | caught/provider-ci | caught/provider-ci |
| `EXTRA_FIELD_ADDED` | safe | quiet/none | quiet/none | quiet/none | quiet/none |
| `CONSUMER_ADDED_EXPECTATION` | breaks | missed/none | caught/provider-ci | caught/provider-ci | caught/deploy-gate |
| `LOGOUT_RETIRED` | safe | false-alarm/provider-ci | quiet/none | quiet/none | quiet/none |
| `LOGOUT_RETIRED_EARLY` | breaks | caught/provider-ci | missed/none | caught/provider-ci | caught/provider-ci |
<!-- /MATRIX -->

Totals over 9 breaking and 3 safe scenarios:

<!-- TOTALS -->
| wiring | caught | missed | false alarms |
| --- | --- | --- | --- |
| files-stale | 7 | 2 | 1 |
| files-fresh | 7 | 2 | 0 |
| broker | 8 | 1 | 0 |
| broker-pending | 8 | 1 | 0 |
<!-- /TOTALS -->

`matrix.broker.test.ts` re-derives every number above on every run and fails if
the table and the run disagree, in both directions.

## What the matrix says

**On provider-side changes the broker buys nothing.** The seven scenarios where
a provider team edits its service and the contract does not move — a removed
field, a rename, a status code, a tightened header, a deleted route — are
scored *identically* by all four columns. That is most of what "why you need a
broker" material is about, and none of it is a reason for a broker. Verifying a
pact file that happens to be current catches all of it.

**The one nobody catches is the one you would ship.** `USER_ID_STRINGIFIED` —
`"id": 1` becoming `"id": "1"`, the thing an ORM upgrade or a bigint migration
does by itself — is missed by every wiring, and the wiring is not at fault:
`MatchersV3.integer()` compiles to `{"match":"integer"}`, and pact's matcher
*coerces*. `coercion.test.ts` pins both halves of that with the provider's
`bogusUserId` control: the same interaction with `"id": "abc"` fails, so the
field is being matched and the rule is "parses as an integer", not "is a JSON
number". No broker, selector or gate changes this. A `regex('^[0-9]+$', …)`
matcher would not help either; the answer is a consumer assertion on the parsed
value, which is what the consumer suites already do with `toBeTypeOf('number')`
against the *mock* — and the mock is generated from the same matcher, so it
agrees.

**Staleness fails in both directions, and the two file columns do not contain
each other.** `files-stale` misses the consumer's new expectation and
false-alarms on the retirement; `files-fresh` catches the first and misses
`LOGOUT_RETIRED_EARLY`. Their caught-counts are equal — 7 and 7 — which is why
"is the file current" is the wrong question to argue about. Copying the file
more often converts one error into a different one.

**What the broker actually adds is `deployedOrReleased`.** The two
`LOGOUT_RETIRED*` rows are the same retirement in the two possible orders, and
they are identical in every field but which consumer version production is
running. That is the whole difference, and it is the difference the file
columns cannot see: `files-fresh` verifies *the current contract*, which is not
the same document as *every contract still running in production*. It scores
the too-early retirement green. The broker's `deployedOrReleased` selector is
the only mechanism here that knows the old consumer is still deployed, and it
is the same mechanism that clears the retirement once it is not.

**Pending pacts move a failure between teams without changing detection.**
`broker` and `broker-pending` differ in exactly one cell.
`CONSUMER_ADDED_EXPECTATION` — a consumer publishing a contract for an endpoint
the provider has not built — goes from failing the *provider's* build to
failing the *consumer's* deploy gate. Same detection, different team
interrupted, and the second one is the team that caused it.

## Two things that cost real time

**The verifier reads broker configuration from the ambient environment.**
`pact-core`'s argument mapper does
`opts.pactBrokerUrl || process.env['PACT_BROKER_BASE_URL']` and adds a broker
source if *either* is set. There is no way to ask for a run with no broker: a
call passing only `pactUrls` still fetches from the broker when that variable is
exported — which it is in every CI job doing contract testing. This made the
`files-*` columns wrong in a way that read as flakiness, since by the time a
file cell ran, earlier cells had published pacts the file cell then also
verified. `provider/verify.ts` unsets the broker and proxy variables around the
verifier call and passes credentials explicitly; `verify.test.ts` pins it.

**The verifier honours `HTTPS_PROXY` for a provider on 127.0.0.1.** Behind a
proxy that answers CONNECT with 403, every interaction fails with a 403 and a
`text/plain` body, which reads as a provider that has grown an authorization
layer rather than as a request that never arrived. `no_proxy` listing
`127.0.0.1` does not help.

## What is not built

`includeWipPactsSince` is not measured. It is the sibling of pending pacts —
"verify contracts published since this date even if no selector picks them" —
and distinguishing it from `enablePending` needs a corpus with branches in it,
which this one does not have.

Broker webhooks are not wired up. `runBrokerCell` triggers the provider's
re-verification directly, which is what a webhook would have caused; what is
not measured is the latency and failure modes of the webhook itself.

The broker runs with no authentication in CI. `broker/client.ts` supports basic
and bearer auth and `resolveBroker` reads them from the environment, but no
test exercises a broker that refuses an anonymous request.
