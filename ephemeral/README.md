# Ephemeral per-PR environments: twelve ways they go wrong, and eight wirings scored against them

The standard answer to "how do we clean up preview environments" is a
`pull_request: closed` workflow that destroys the stack. It scores
**3 of 12 hazards handled** — one better than the control, which is a deploy
job nobody automated and a human who is supposed to remember.

That is not because the close hook is a bad idea. It is because teardown is
one of four things a per-PR environment has to get right, and it is the only
one anybody argues about. The other three — which commit is actually running,
whose data the reviewer is looking at, and who is allowed to make an
environment in the first place — are worth five of the eight cells between
`on-close` and the wiring at the top of the table.

This directory is a harness for posing all twelve, plus eight reference
wirings to validate it against. The harness is the deliverable; the matrix is
how it earns the right to be believed.

## What is being compared

Every wiring below is the same runtime reading the same seven controls, so
adjacent rows differ by one field and a jump in the score column is
attributable to it. `strategies.test.ts` asserts those adjacencies rather than
asking you to take them on trust.

| Strategy | What it does |
| --- | --- |
| `manual` | A deploy job on `opened` and a human who remembers to clean up. The control. |
| `on-close` | Deploy on open and push, destroy on `pull_request: closed`, all previews sharing the staging database. The standard answer. |
| `on-close-cancel` | The same, plus one `concurrency` group per pull request with `cancel-in-progress`. |
| `on-close-seeded` | The same, plus a database per environment, seeded from the fixture at deploy time. |
| `ttl-reaper` | No close hook at all: a scheduled sweep deletes every environment older than four hours. |
| `on-close-ttl` | A close hook and the four-hour sweep behind it, which is the belt-and-braces answer. |
| `namespace-owned` | A close hook, and every resource nested inside one namespace the stack owns, so teardown is one delete. |
| `namespace-reconciled` | An owned namespace, a label-gated deploy, and a sweep that deletes any namespace whose pull request is not open. |

## The outcomes

Nine words, ordered by how bad they are and how long they stay invisible. A
vocabulary with one failure word in it scores "deleted four hours late" and
"still running next quarter" the same, which is what makes a TTL sweep look
like a solution.

| Outcome | Meaning |
| --- | --- |
| `clean` | Gone, at the moment it stopped being needed. |
| `live` | Up, serving this pull request's head commit, with data only this pull request can see. |
| `reaped` | It outlived its pull request and a sweep removed it later. Bounded cost, unbounded window. |
| `broken` | There is no usable environment when there should be one. The review is blocked and somebody notices in minutes. |
| `stale` | Up, and serving a commit that is not the head. Discoverable: the commit is written on the deployment. |
| `poisoned` | Up, at the right commit, showing data another pull request wrote. Not discoverable: it looks like a correct screen. |
| `leaked` | Still running after the pull request closed, with something still referencing it. |
| `orphaned` | Still running, with nothing referencing it. Strictly worse than `leaked`: there is no list to reconcile against. |
| `exposed` | The repository's deployment secret ran against code a fork author controls. |

`exposed` outranks every other word in the precedence, and `poisoned` outranks
`stale`; `scoring.ts` argues both.

## The hazards

| Hazard | What happens |
| --- | --- |
| `merged` | A pull request is opened, reviewed and merged. The happy path. |
| `long-review` | A pull request stays open longer than the TTL and a reviewer opens its environment. |
| `pushed-a-fix` | The author pushes a second commit and the reviewer reloads. |
| `racing-pushes` | Two commits land in quick succession and the older deploy finishes last. |
| `teardown-cancelled` | The pull request closes and the run that would have destroyed the environment dies. |
| `zombie-deploy` | A deploy is still in flight when the pull request closes, and finishes after teardown. |
| `platform-created-resource` | The environment serves traffic, so the platform creates a resource the stack never recorded. |
| `sweep-never-ran` | Teardown dies and the scheduled sweep that would have recovered it never fires. |
| `fork-pr-unreviewed` | A first-time contributor opens a pull request from a fork and nobody has looked at it. |
| `fork-pr-approved` | A maintainer reads that fork pull request and asks for an environment for it. |
| `cross-pr-write` | Another pull request's end-to-end run writes, and this one's reviewer reloads. |
| `migration-in-pr` | The pull request contains a migration, so its code needs data at a schema `main` is not at. |

Two of the twelve have a correct answer that is not the ideal one, and
`hazards.ts` says why. `teardown-cancelled` is correct at `reaped`: once the
destroy run has died, no wiring can make the environment disappear at the
moment the pull request closed, and scoring it against `clean` would mark all
eight columns wrong and teach nothing about the three that recover.
`sweep-never-ran` is also correct at `reaped` and **no wiring reaches it** —
see below.

## The matrix

Twelve hazards, eight wirings, and all 96 cells re-derived on every run and
checked against this table in both directions by `matrix.test.ts`.

| Hazard | `manual` | `on-close` | `on-close-cancel` | `on-close-seeded` | `ttl-reaper` | `on-close-ttl` | `namespace-owned` | `namespace-reconciled` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `merged` | `leaked` | `clean` | `clean` | `clean` | `reaped` | `clean` | `clean` | `clean` |
| `long-review` | `live` | `live` | `live` | `live` | `broken` | `broken` | `live` | `live` |
| `pushed-a-fix` | `stale` | `live` | `live` | `live` | `live` | `live` | `live` | `live` |
| `racing-pushes` | `stale` | `stale` | `live` | `live` | `live` | `live` | `live` | `live` |
| `teardown-cancelled` | `leaked` | `leaked` | `leaked` | `leaked` | `reaped` | `reaped` | `leaked` | `reaped` |
| `zombie-deploy` | `leaked` | `leaked` | `clean` | `clean` | `reaped` | `clean` | `clean` | `clean` |
| `platform-created-resource` | `leaked` | `orphaned` | `orphaned` | `orphaned` | `reaped` | `reaped` | `clean` | `clean` |
| `sweep-never-ran` | `leaked` | `leaked` | `leaked` | `leaked` | `leaked` | `leaked` | `leaked` | `leaked` |
| `fork-pr-unreviewed` | `clean` | `exposed` | `exposed` | `exposed` | `exposed` | `exposed` | `exposed` | `clean` |
| `fork-pr-approved` | `broken` | `exposed` | `exposed` | `exposed` | `exposed` | `exposed` | `exposed` | `live` |
| `cross-pr-write` | `poisoned` | `poisoned` | `poisoned` | `live` | `live` | `live` | `live` | `live` |
| `migration-in-pr` | `broken` | `broken` | `broken` | `live` | `live` | `live` | `live` | `live` |

| Strategy | Handled |
| --- | --- |
| `manual` | 2/12 |
| `on-close` | 3/12 |
| `on-close-cancel` | 5/12 |
| `on-close-seeded` | 7/12 |
| `ttl-reaper` | 5/12 |
| `on-close-ttl` | 7/12 |
| `namespace-owned` | 8/12 |
| `namespace-reconciled` | 11/12 |

## What the table says

### Adding a TTL sweep to a working close hook buys nothing

`on-close-seeded` and `on-close-ttl` differ in one control — whether a
scheduled sweep deletes everything older than four hours — and they score
**identically, 7/12**. The sweep is not inert: it changes three cells. It
rescues `teardown-cancelled` from `leaked` to `reaped`, it moves
`platform-created-resource` from `orphaned` to `reaped`, and it turns
`long-review` from `live` into `broken`, because a reviewer who comes back on
day two finds the environment deleted underneath them.

So the sweep does not improve the wiring. It moves the failure from a silent
leak to a loud outage, and whether that is an improvement is a question about
your team rather than about your infrastructure. It is a real trade and the
score column is the wrong place to look for it — which is the argument for
reading a matrix rather than a total.

### The two designs at 5/12 have no failure in common

`on-close-cancel` and `ttl-reaper` score the same and agree on two of the five
— `pushed-a-fix` and `racing-pushes`, which is to say on the deploy controls
they share and on nothing else. One of them deletes environments at the right
moment and shares one database between every preview; the other keeps its data
straight and deletes everything four hours late, including the environments
still under review. A league table would call them equivalent. They are not
close.

### `cancel-in-progress` is worth two cells, and the group is the part people get wrong

`on-close` → `on-close-cancel` is one field and two cells: `racing-pushes`
(`stale` → `live`) and `zombie-deploy` (`leaked` → `clean`). The second is the
one to notice, because it is a *teardown* failure fixed by a *deploy* control.
A deploy that was in flight when the pull request closed finishes after the
destroy and puts the whole environment back, and nothing about the close hook
is wrong.

It only works if the concurrency group is shared by the deploy workflow and the
destroy workflow — a group per workflow, which is what `${{ github.workflow }}`
in the group expression gives you, makes two pushes cancel each other and
leaves the close free to race a deploy. That is the exact hazard, with the
mitigation applied and not working.

### A scrupulous state file is not a list of what exists

`on-close-seeded` → `namespace-owned` is one field and one cell, and nothing
in the deployer changes. It records every resource it creates and deletes
exactly that list, and `platform-created-resource` still reads `orphaned`
against it, because the resource in question was created by the platform on
first use. A log group, an image in a registry, a DNS record from an ingress
controller, a snapshot from a backup policy: they cost money, they hold data,
and `terraform destroy` has never heard of them.

Nesting everything inside one namespace the stack owns fixes it without
changing when or whether teardown runs — the recorded parent cascades over
what nobody recorded. The alternative fix is to tear down by label query
instead of by id list, which is what the sweep does, and that scores `reaped`
rather than `clean`: same resources gone, one sweep interval later.

### The control beats six of the eight wirings on the security row

`manual` handles two hazards, and one of them is `fork-pr-unreviewed`. It wins
that cell by being too primitive to have the bug: a `pull_request` workflow has
no secrets on a fork, so nothing deploys. Six wirings score `exposed` there,
because the fix for "previews do not work on forks" that every guide reaches
for is `pull_request_target`, which runs with the repository's secrets against
a head commit an untrusted contributor wrote. A preview pipeline is an
unusually bad place for that: the secret it holds exists to create
infrastructure.

The two fork rows are one decision seen twice. `pull_request` scores `clean`
then `broken` — safe, and no fork contributor ever gets an environment.
`pull_request_target` scores `exposed` twice. Only a label gate scores both,
and the cost is honest: a first-time contributor waits for a maintainer to
look at their code before their preview exists, which is the point.

Note that `fork-pr-approved` still reads `exposed` for the
`pull_request_target` wirings even though a maintainer has now approved. The
secret ran at `opened`. Approval afterwards does not un-run it.

### Nothing handles `sweep-never-ran`

All eight columns read `leaked`. The row is a cancelled teardown plus a sweep
that never fires, and every design here that recovers from the first depends on
the second — a `schedule:` workflow, which GitHub disables on repositories with
sixty days of no activity, quietly. A reconciler is not a backstop if it is
made of the same material as the thing it is backing up.

The thing that actually bounds the loss is a spend alert on the account, and it
is not a wiring, has no column here, and is the one item on this page that
cannot be tested by a suite that runs in a pull request.

### The recommendation

`namespace-reconciled`, at 11/12 — the three controls it adds to
`namespace-owned` are a label-gated trigger, a deploy on the `labeled` event,
and a sweep that reconciles against open pull requests rather than against a
clock. `workflow-templates/preview-environment.yml` and
`workflow-templates/preview-reconcile.yml` are that wiring as two files you can
copy, and `workflows.test.ts` checks them against this table: if the
top-scoring row ever changes, the templates fail the build rather than
quietly becoming advice from last year.

What it costs, stated where the score cannot: the reconciler needs to read pull
request state as well as list cloud resources, so it is the only design here
that needs a credential spanning both; and the label gate means a first-time
contributor's preview waits on a human.

## The files

| File | What it is |
| --- | --- |
| `cloud.ts` | The resource ledger: create, cascade-delete, query by label. Knows nothing about the deployer. |
| `deployer.ts` | Brings an environment up and records what it created. Tears down by that record. |
| `seeds.ts` | The seed fixture and the two places an environment's data comes from. |
| `clock.ts` | The only source of time. Advances only when a timeline says so. |
| `strategies.ts` | The seven controls, and the eight wirings as points in them. |
| `hazards.ts` | The twelve timelines, and the correct answer for each. |
| `harness.ts` | The runtime: registers runs, lands them, sweeps, probes. |
| `scoring.ts` | The nine outcomes, the precedence, and the score. |
| `matrix.ts` | Plays every hazard against every wiring. |
| `readme.ts` | This document, read as data, so the tables above can be checked. |
| `workflows.ts` | Reads the shipped workflow templates and states which controls they implement. |

## Running it

```
pnpm test ephemeral
```

No containers, no sockets, no sleeps and no wall clock: the whole matrix is
derived in-process, which is why `matrix.test.ts` re-derives every cell on
every run rather than caching a table that could go stale.
