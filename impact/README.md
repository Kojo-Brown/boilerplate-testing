# Test-impact analysis: eight ways to pick the suites a diff affects, scored against eight ways a diff breaks one

Running only the affected tests is the cheapest-sounding idea in continuous
integration, and it has a failure mode nothing else in a pipeline has: when it
is wrong, **nothing goes red**. A selector that misses a suite does not report
an error. It reports a tick, next to a change that broke something, and the
usual response to the resulting bug is to distrust the tests rather than the
selection.

So this directory does not argue about selection strategies. It measures them.
Eight strategies against eight faults, scored over the 49 suite-runs a full run
of the catalogue would spend, with every cell produced by applying a real change
to a real file and running a real suite — measured against **Vitest 3.2.7 and
TypeScript 6.0.3**. `pnpm test` re-derives all 64 cells on every run (fourteen
Vitest processes, run one at a time, no browser and no container, about twenty
seconds), so a claim that stops being true fails CI rather than quietly becoming
a wrong sentence here.

## The subject

`fixture/` is a six-suite project built so that each dependency in it has a
different *shape*: an import chain three modules deep, a test helper that is not
a test, a plugin directory loaded by `readdir` and a computed specifier, a rate
table read from disk, a snapshot baseline, and a shared matcher that reaches
every suite through `setupFiles`. None of that is decoration — each one is a
column in the matrix, and five of the eight strategies fail on at least one of
them.

Nothing in the fixture is red. Each measured run copies it to `.runs/<fault>/`,
applies one fault to one file, and runs Vitest over the copy; the suites that
fail are the ground truth a selection is scored against. They are measured, not
declared, which is the only reason the matrix is worth reading.

## The faults

| fault | the change | suites broken | the dependency it travels along |
|---|---|---|---|
| `bulk-threshold` | `src/pricing.ts` | 2 of 6 | an ordinary source change, one import hop below a test and two below another |
| `scale-cents` | `src/money.ts` | 3 of 6 | a change at the bottom of the graph: three suites deep, which is where a selector stops saving anything |
| `test-factory` | `src/support/factory.ts` | 3 of 6 | a change to a test helper, which is reachable from tests only through a file that is not a test |
| `runtime-rule` | `src/rules/bulk.rule.ts` | 1 of 6 | a module loaded by name at run time: no import statement anywhere names it |
| `rate-table` | `src/data/rates.json` | 1 of 6 | a data file, read from disk and imported by nothing |
| `snapshot-baseline` | `src/__snapshots__/label.test.ts.snap` | 1 of 6 | a snapshot baseline, which a test depends on entirely and names not at all |
| `setup-matcher` | `setup.ts` | 5 of 6 | a setup file, which reaches every suite through a runner setting rather than an import |
| `new-test` | `src/discount.test.ts` | 1 of 7 | a test file added by the diff, which has no history to be selected by |

## The strategies

| strategy | the rule |
|---|---|
| `all` | run every suite |
| `changed-tests` | run the test files that appear in the diff |
| `same-directory` | run the test files in the directory of a changed file |
| `importers-direct` | run the test files that import a changed file |
| `importers-transitive` | run the test files that reach a changed file through any chain of imports |
| `transitive-triggers` | as above, and run everything when a changed file is a config, setup, manifest or lockfile |
| `transitive-triggers-edges` | as above, over a graph that also carries derived snapshot edges and declared data-file edges |
| `coverage` | run the test files whose last recorded coverage includes a changed file |

`all` is the baseline every other row is measured against. The six after it are
things projects actually do — two of them are things projects do and should not,
and the matrix says which. `coverage` is what the serious tools do.

## The matrix

Each cell is the number of suites that strategy selected; **✗ marks a cell that
missed a suite which actually failed** — a green run on a broken change. The
`misses` column is the only one that can disqualify a row, and `suites run` is
the only reason anybody wants this.

| strategy | threshold | deep module | helper | plugin | data file | snapshot | setup | new test | misses | suites run |
|---|---|---|---|---|---|---|---|---|---|---|
| `all` | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 7 | **none** | 49/49 |
| `changed-tests` | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | 1 | **7** | 1/49 |
| `same-directory` | 5 | 5 | 0 ✗ | 1 | 0 ✗ | 0 ✗ | 0 ✗ | 6 | **4** | 17/49 |
| `importers-direct` | 1 ✗ | 1 ✗ | 4 | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | 1 | **6** | 7/49 |
| `importers-transitive` | 2 | 5 | 4 | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | 1 | **4** | 12/49 |
| `transitive-triggers` | 2 | 5 | 4 | 0 ✗ | 0 ✗ | 0 ✗ | 6 | 1 | **3** | 18/49 |
| `transitive-triggers-edges` | 2 | 5 | 4 | 1 | 1 | 1 | 6 | 1 | **none** | 21/49 |
| `coverage` | 2 | 4 | 4 | 1 | 0 ✗ | 0 ✗ | 0 ✗ | 0 ✗ | **4** | 11/49 |

## Selecting nothing is the cheapest possible answer and it reports green

`changed-tests` — "run the tests that changed", the selection a
`git diff --name-only | grep test` pipeline produces — runs **1 suite out of
49** across the catalogue and misses **seven faults out of eight**. It is
twenty times cheaper than the safe selector and it is not a selector at all: a
diff that changes a module and not its test selects nothing, so the suite passes
by running none of itself.

This is the shape of every bad answer below it. Cheapness and safety are
measured in different columns for a reason.

## One hop of the import graph is not the import graph

`importers-direct` asks which test files import the changed file. For
`src/pricing.ts` that is `pricing.test.ts` — and `cart.test.ts`, which reaches
it through `cart.ts`, fails and was not run. The same thing happens at
`src/money.ts`, two hops down.

The fix is not a bigger number: it is the transitive walk, which is five lines
and the difference between two misses and none on the three import-shaped
faults.

## Everything the import graph misses is a dependency that is not an import

`importers-transitive` is the first row that is not obviously wrong, and it
misses exactly four faults: the plugin loaded at run time, the data file, the
snapshot baseline, and the setup file. Not one of those is a bug in the walk.
Each is a real dependency that no import statement records, and so no amount of
parsing can find:

- **The plugin.** `fixture/src/rules/registry.ts` loads `*.rule.ts` with
  `readdir` and a specifier it builds at run time. `parseSpecifiers` finds
  nothing, correctly — `import(variable)` is unreadable by construction, and
  the shape is common: route tables, migrations, seeders, ESLint rule sets.
- **The data file.** `rates.ts` reads `data/rates.json` with `readFileSync`.
  The path is a string.
- **The snapshot.** `label.test.ts` depends on its baseline completely and
  names it nowhere. The relationship is a naming convention of the runner.
- **The setup file.** `setup.ts` reaches all six suites through `setupFiles` in
  a config. Nothing imports it, and changing it breaks five suites.

Two of those four are recoverable cheaply, and "cheaply" is worth being exact
about. `edges.ts` derives the snapshot edge from Vitest's own naming rule, so
there is nothing to maintain at all. `triggers.ts` does need a list — but a
bounded one: the configs, the setup files, the manifest, the lockfile and the
selector itself are a closed set that any repository can enumerate once, and
`check.ts` fails when a pattern in it stops matching anything.

The other two need a declaration per dependency. That list has no bound, and
nothing can audit it for the entry nobody wrote — which is the standing cost of
the technique rather than a detail of it, and the reason the last section of
this document says what it says.

## Coverage sees what ran, which is more than any parser can and less than enough

`coverage` records what each suite actually executed, so it sees the plugin
directory that defeats every parser — `registry.test.ts`'s coverage names both
rule files, with no declaration anywhere. It is also tighter than the graph on
`deep module` (4 suites against 5) because it does not follow type-only
imports, which cannot change a runtime result.

And it misses three faults the declared graph catches:

- **The data file**, because a JSON file nobody imported is not instrumented.
  Reading a file leaves no trace in a coverage report.
- **The snapshot baseline**, for the same reason.
- **The setup file**, because it is outside `coverage.include`. That one is
  worth being precise about: a coverage map's blind spots are exactly its
  include list. Widen the list to cover configs and setup files and this cell
  turns green — at which point the include list is doing `triggers.ts`'s job
  with less of the reasoning visible.

## A coverage map is one run stale, and the fix is not the map

A coverage map is recorded by a previous run, so a test file the diff *adds*
appears in no map, and a pure map lookup selects nothing for it. Every graph row
in the matrix covers that fault without a special case, because reverse
reachability includes its own seed: a changed test file is affected by its own
change.

Real coverage-based tools union the changed test files for exactly this reason.
The `coverage` row here is the map alone, so that the cell this union is
responsible for is visible rather than absorbed.

## Co-location flatters the cheapest heuristic

`same-directory` looks respectable in the table — safe on four faults, including
the plugin — and the reason is not the heuristic. It is that the fixture
co-locates its tests, which this repository and most modern ones do. Co-location
means the neighbours of a changed file usually include the suite that covers it.

It is still 17 suites against the safe selector's 21 for *four* misses rather
than none, and the one safe-looking cell it gets for free (`plugin`) is an
accident of the rule files living in the same directory as the suite that loads
them. Move them one directory down and the cell goes red without the heuristic
changing at all.

## The safe selector still runs two suites in five

`transitive-triggers-edges` is safe on all eight faults, and it runs **21 of 49**
suites — two in five. That is the honest headline, against a technique usually
sold with an order-of-magnitude saving.

The catalogue is adversarial on purpose, so two in five is close to a worst
case; this repository's own numbers are much better, because a repository is
mostly leaves. A one-module change to `flake/history.ts` selected 9 of the
213 suites this repository had when that was written, and `pnpm impact:check`
prints the figure for any diff rather than asking anyone to trust this sentence. But the two
numbers measure different things, and the fixture's is the one that generalises:
a change at the bottom of a dependency chain selects most of the suite, and no
selector can do better, because most of the suite genuinely depends on it.

## Nothing here can find an edge nobody declared

The audit in `repo.ts` catches a trigger pattern that matches no tracked file
and a declared edge whose ends have moved — both of which are silent, and both
of which turn into a suite that stops being selected. It cannot catch the edge
nobody wrote down. There is no version of this that can: a dependency expressed
as a string literal assembled at run time is not discoverable, and the failure
it produces is a green build.

That is why selection is wired into CI as fast feedback **beside** the full run
rather than instead of it. The `impact` job prints what it would have run and
runs it; `gates` runs every suite on every supported Node major and is what
blocks the merge. Reversing that trade is a decision about how much a silent
miss costs, and it is not one a pattern library should make for anybody.

## Using it

```bash
pnpm impact:check     # the selection for the current diff, and the configuration audit
pnpm impact:run       # run exactly that selection
```

`impact:check` diffs the working tree against the merge base with
`origin/main` (`IMPACT_BASE` overrides it, `GITHUB_BASE_REF` is used on a pull
request), builds the graph, prints the selection into `$GITHUB_STEP_SUMMARY`
when CI sets it, and writes the list to `impact/selection.txt`. It exits
non-zero on a stale trigger, a stale declared edge, or a selected file that
`vitest list` says the runner would not collect — never on a selection that
merely looks small. `IMPACT_SKIP_COLLECT=1` skips the collection, which is the
slow half.

Three outcomes, and the middle one matters:

- a list of suites — those run, and nothing else;
- **an empty list** — nothing in the diff reaches a suite. Legitimate for a
  documentation-only change, and also what a broken selector produces, which is
  why `check.ts` always prints its reasons;
- `ALL` — the diff could not be narrowed (a trigger fired, a path vanished, or a
  changed path is not in the graph), so the whole suite runs. A selector that
  cannot explain itself must not be the one deciding to skip.

To adopt it elsewhere, the files to copy are `graph.ts`, `select.ts`,
`triggers.ts` and `edges.ts`; the two lists to rewrite are `REPO_TRIGGERS` and
`REPO_EDGES`, which are specific to a repository and are the whole maintenance
burden.

## What is not measured here

- **Deletions and renames.** The importers of a deleted file are findable only
  in a tree that is no longer checked out, so `select.ts` runs everything and
  `select.test.ts` covers that rule directly. A fault that deleted a module
  would measure a full run against a full run.
- **Test selection below the file.** Everything here selects whole files.
  Selecting individual cases is possible and buys little: the process, the
  environment and the imports are most of a suite's cost.
- **Dependency upgrades.** A lockfile change is a trigger, which is the correct
  answer and an uninteresting measurement.
- **The other runners.** Playwright, the contract suites and the container
  suites each have their own config and their own exclusions. The selector reads
  the unit run's list from `vitest.config.ts`; pointing it at another config is
  a line of code and a different set of edges.
