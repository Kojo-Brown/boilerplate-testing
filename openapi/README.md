# OpenAPI schema conformance: what a response validator actually catches

Six wirings of "assert responses match the spec", eleven ways a service stops
matching one, and the table of which wiring notices which.

```bash
pnpm test openapi          # the corpus, the six wirings, and this README
```

---

## The claim being tested

"We validate our responses against the OpenAPI spec" is usually one specific
thing: take the response body, find the schema the document declares for that
operation and status, hand both to a JSON Schema validator. Every
response-validation middleware works this way and it is a real improvement over
asserting nothing.

It catches **four** of the eleven divergences below.

Not because the validator is bad — Ajv is not the weak link anywhere in this
table — but because most of the ways a service stops matching its document are
not inside the response body. A status code nobody declared, a content type
nobody declared, a required header that went missing, a query parameter the
handler honours and the document has never heard of: the body is impeccable in
every one of those cases, and the schema it is checked against has nothing to
say.

---

## The subject

One small service, in three files, deliberately boring:

- [`spec.ts`](./spec.ts) — an OpenAPI 3.1 document. Four operations over
  `/orders`, an `Order` schema with an enum, a `date-time`, nested objects, an
  array of `$ref`s and one nullable field.
- [`service.ts`](./service.ts) — an implementation of it, as a pure function
  from a request record to a response record. Frozen store, literal ids,
  injected clock: no run of this suite can disagree with another about what the
  service said. [`server.ts`](./server.ts) is the `node:http` shell around it,
  in its own file so that only the tests which actually open a socket count as
  having crossed a boundary — see [`../shape/`](../shape/).
- [`drifts.ts`](./drifts.ts) — the corpus. Each entry is one stated change to
  the response, applied as a transform, so that the conforming service and each
  drifting service differ in exactly the one way the entry's source names.

Requests go over a real socket through [`supertest`](../supertest/), because
half of what a conformance check looks at only exists on the wire. A check that
has only ever seen a JavaScript object has not been tested against an HTTP
response.

---

## The six wirings

Each is a complete answer to "we have schema-conformance tests", and each is a
pure function from one captured exchange to a list of findings.

| Wiring | What it looks at |
| --- | --- |
| `status-only` | The status code the test expected, and nothing else. |
| `handwritten` | Assertions on the three fields the client reads, written by hand. |
| `body-schema` | The body against the schema for the status it came back with, as written. |
| `body-schema-strict` | The same, with formats asserted and objects closed by the validator. |
| `full-response` | Body, plus the status, media type and required headers the document declares. |
| `request-and-response` | Everything above, and the request the test sent, against the same document. |

The rule that decides most of the table, and the one worth carrying away:

> **A validator that cannot find a schema does not fail. It says nothing.**

The document declares no 409 on this operation, so there is no schema, so there
is nothing to validate against, so the check passes. Every step is reasonable.
The conclusion is that the wiring is loudest about responses you already
documented and silent about the ones you did not — which is backwards, because
the undocumented response *is* the drift. `body-schema` and
`body-schema-strict` behave that way. `full-response` is the same validator plus
three lines that turn "no schema here" into a finding.

---

## The corpus

Eleven drifts and one control. Each is a regression somebody has shipped, not a
JSON Schema keyword picked off a list — a corpus built keyword-by-keyword
measures Ajv, and Ajv does not need measuring.

| Drift | Where it comes from |
| --- | --- |
| `none` | The service as written. Every wiring must be silent here. |
| `extra-field` | A `select *` reaches the serialiser and an internal column ships. |
| `missing-required` | A column is made nullable and a required property stops being sent. |
| `wrong-type` | A numeric column arrives as a string from the driver. |
| `format-violation` | A `date-time` is serialised as a bare date. |
| `enum-drift` | A new lifecycle state is added to the domain and not to the document. |
| `nested-null` | A left join puts a null inside an array item, two levels down. |
| `undeclared-status` | A conflict case is added to the handler; the document declares 200 and 404. |
| `wrong-content-type` | A path reaches for `res.send(string)` and answers text where JSON is declared. |
| `missing-header` | A refactor drops the `Location` header from a 201 that still declares it. |
| `undeclared-query-param` | A filter is added to the handler and the client, and never to the document. |
| `empty-collection` | The `wrong-type` bug again, against a filter that legitimately matches no rows. |

---

## The matrix

Four words, and the fourth is why there are four. `catch` — the wiring produced
a finding and would have failed the build. `miss` — it produced nothing and the
service does not match its document. `quiet` — it produced nothing on the
*conforming* exchange, which is what it must do. `alarm` — it produced a finding
on the conforming exchange, which makes its whole column worthless. Without the
`none` row, a wiring that rejected every response would score eleven out of
eleven.

| Drift | `status-only` | `handwritten` | `body-schema` | `body-schema-strict` | `full-response` | `request-and-response` |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | quiet | quiet | quiet | quiet | quiet | quiet |
| `extra-field` | miss | miss | miss | catch | catch | catch |
| `missing-required` | miss | miss | catch | catch | catch | catch |
| `wrong-type` | miss | catch | catch | catch | catch | catch |
| `format-violation` | miss | miss | miss | catch | catch | catch |
| `enum-drift` | miss | catch | catch | catch | catch | catch |
| `nested-null` | miss | miss | catch | catch | catch | catch |
| `undeclared-status` | catch | miss | miss | miss | catch | catch |
| `wrong-content-type` | miss | catch | miss | miss | catch | catch |
| `missing-header` | miss | miss | miss | miss | catch | catch |
| `undeclared-query-param` | miss | miss | miss | miss | miss | catch |
| `empty-collection` | miss | miss | miss | miss | miss | miss |

| Wiring | Caught |
| --- | --- |
| `status-only` | 1/11 |
| `handwritten` | 3/11 |
| `body-schema` | 4/11 |
| `body-schema-strict` | 6/11 |
| `full-response` | 9/11 |
| `request-and-response` | 10/11 |

---

## What the table says

### The jump is the envelope, not the dialect

`body-schema` → `body-schema-strict` is the entire "make the validator stricter"
axis: register `ajv-formats`, close the objects the document left open. It is
the change teams spend their argument on, and it is worth **two** rows.

`body-schema-strict` → `full-response` is three checks, about ten lines, none of
which involves a schema at all — was this status declared, was this media type
declared, is every required response header here. It is worth **three** rows,
and they are the three rows nothing below it catches.

If you adopt one thing from this directory, adopt the ten lines.

### The wirings are not a ladder

They are drawn in increasing order and the order is a lie until `full-response`.

- `status-only` catches `undeclared-status`. `body-schema` and
  `body-schema-strict` both miss it.
- `handwritten` catches `wrong-content-type`. Both schema wirings miss it —
  there is no schema declared for `text/plain`, so there is nothing to check,
  so they are satisfied. The hand-written assertion fails because the body it
  was reading is not there.
- `handwritten` and `body-schema` are 3/11 and 4/11 and neither contains the
  other.

The practical form of this: **replacing hand-written response assertions with
schema validation can lose coverage**, and deleting `.expect(200)` because "the
schema check covers it" definitely does. Keep the cheap assertion. It is one
line and it is the only thing below `full-response` that notices a status code
the handler invented.

### `additionalProperties` belongs in the document

`extra-field` is the drift that leaks data, and `body-schema` cannot see it,
because no schema in [`spec.ts`](./spec.ts) sets `additionalProperties: false`.
That is not a flaw planted to make a point — it is what nearly every
hand-written OpenAPI document looks like. The keyword is easy to forget,
unpleasant to maintain, and genuinely wrong for a schema you intend to extend.

The strict dialect closes those objects itself, in
[`schema.ts`](./schema.ts#L1), and it is worth being clear about what that costs:
the validator is then no longer checking the document, it is checking the
document plus an assumption, and for a service whose clients must tolerate added
fields the assumption is wrong in the direction that fails a build on a
backwards-compatible change. Injecting it is what you do *while* you are moving
the keyword into the document, where it is a decision somebody made.

### `format` is an annotation, and you are told so in a log line

JSON Schema classifies `format` as an annotation, so a validator that ignores
`format: date-time` is not buggy — it is correct, and it is Ajv's default. What
Ajv does is print

```
unknown format "date-time" ignored in schema at path "#/properties/placedAt"
```

once per format, to stderr, in the middle of an install log. That is the only
warning anybody gets that a keyword in their document is decorative.

`compileDocument` captures those lines instead of printing them, so
`Validators.ignoredFormats` is a value a test can assert on: the lenient dialect
ignores `uuid` and `date-time`, the strict dialect ignores nothing, and
[`schema.test.ts`](./schema.test.ts) fails if that stops being true.

### The row every wiring misses

`empty-collection` is `wrong-type` — the same bug, the same transform, applied
to a list endpoint — against `GET /orders?status=refunded`. The filter is legal,
the enum member is declared, and no order in the store has it. The response is
`[]`.

`[]` satisfies every item schema ever written. All six wirings go quiet, the
build is green, and the bug ships the first time a refund exists.

This is the shape of the whole finding: **conformance is a property of the
responses your tests provoked, not of your endpoint.** A validator cannot judge
a response nobody produced, and no amount of strictness changes that. What
changes it is a fixture that makes every branch produce output, which is a
property of the test data, not of the wiring.

### And the operation nobody called

`DELETE /orders/{orderId}` is declared in the document, implemented in
`service.ts`, and returns `{ "cancelled": true }` where the document promises an
`Order` — every required property absent, one undeclared property present. Five
of the six wirings report it the instant anything asks; the sixth is
`status-only`, which is quiet for an honest reason worth noticing — the handler
answers 200 and the document declares 200, so the only thing wrong is in a body
it does not read.

All six score a clean sheet on it, because the corpus never sends it a
request.

[`coverage.ts`](./coverage.ts) is the only gate in this directory that notices:

```
operations: 3/4 (75%) — untouched: DELETE /orders/{orderId}
responses:  3/7 (42.9%) — unobserved: POST /orders 400, GET /orders/{orderId} 404, DELETE /orders/{orderId} 200, DELETE /orders/{orderId} 404
```

**Gate on operation coverage; report response coverage.** Operation coverage at
100% is a floor worth failing a build on — an operation nothing has ever called
is untested by any definition. Response coverage at 100% is the wrong gate: a
document that declares a 503 for a dependency outage is describing something a
suite can only reach by faking the outage, and a team held to 100% deletes the
503 from the document instead. That is a gate making the spec worse.

---

## Copying this into a service

The pieces are separable and the order matters:

1. **Keep your status assertions.** One line, and it is the only cheap thing
   that catches a status the handler invented.
2. **Validate the body** against the operation's declared schema. Four of
   eleven, and the four that are easiest to ship.
3. **Add the envelope checks** — status declared, media type declared, required
   headers present. Three more rows for ten lines. This is the best ratio in
   the table.
4. **Close your objects in the document**, not in the validator. Until you have,
   close them in the validator and know what you are assuming.
5. **Validate requests too**, in tests. A request your own test suite sends that
   the document forbids is a client you are about to write.
6. **Gate operation coverage at 100%.** Everything above is a function of one
   response; this is the only check that notices the response nobody asked for.

For the spec-first direction of the same problem — the consumer states what it
needs and the provider is verified against it — see [`../pact/`](../pact/). Pact
answers "does the provider still serve what this consumer relies on"; this
directory answers "does the service still match the document it publishes".
They fail on different days.

---

## What this module does not measure

Stated rather than left as an exercise, because a table this confident invites
the assumption that it covers everything:

- **`2XX` wildcards and `default` responses.** OpenAPI allows both and this
  document uses neither, so `responseFor` handles exact codes only. A wiring
  that resolved `409` to a `default` response would move one cell.
- **`allOf` / `oneOf` composition.** `closeObjects` recurses into combinator
  branches and deliberately refuses to close them — closing both halves of an
  `allOf` produces a schema nothing can satisfy — but no schema here uses one,
  so that refusal is tested in [`schema.test.ts`](./schema.test.ts) rather than
  in the matrix.
- **OpenAPI 3.0's `nullable: true`.** This document is 3.1, where nullability
  is a type array. A 3.0 document needs a translation step before any JSON
  Schema validator sees it, and that step is a common source of false passes.
- **Runtime validation.** Everything here runs in tests. Validating responses in
  the server at runtime is a different trade — it catches drift in production
  and costs latency on every request — and the wiring is the same.
- **Request validation as a server-side gate.** `request-and-response` validates
  the request *the test sent*, which is a statement about your client
  expectations. Rejecting malformed requests in the service is a separate
  concern with the same document behind it.
