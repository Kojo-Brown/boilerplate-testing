/**
 * A model of Playwright's shard partition, written out so it can be wrong.
 *
 * ---------------------------------------------------------------------------
 * Why a model and not a description
 * ---------------------------------------------------------------------------
 * "Sharding splits the tests across N machines" is true and useless: it does
 * not say what a *test* is for this purpose, and the answer — which is not the
 * test — decides whether adding a second machine halves your wall clock or
 * buys you nothing. So the algorithm is reimplemented here from what
 * `playwright test --list --shard=k/n` actually does, and `partition.test.ts`
 * runs the real CLI over `fixture/` and compares every assignment. When
 * Playwright changes how it shards, that comparison fails and this file is the
 * thing that has to be re-derived — which is the point. A README sentence
 * about sharding cannot notice a version bump.
 *
 * ---------------------------------------------------------------------------
 * The two halves
 * ---------------------------------------------------------------------------
 * 1. {@link groupsOf} — tests are collected into *groups* that are never split.
 *    A group is what Playwright will hand to one worker, so it is also the
 *    atom of sharding.
 * 2. {@link shardOf} — the groups are laid end to end in run order and cut
 *    into N contiguous runs of tests. A group lands in the shard whose slice
 *    contains the group's *first* test, and brings the rest of its tests with
 *    it, however far past the boundary they reach.
 *
 * Every unevenness in a sharded run comes from the interaction of those two:
 * the cut points are computed from the test count, but the cuts can only fall
 * between groups.
 *
 * ---------------------------------------------------------------------------
 * Scope
 * ---------------------------------------------------------------------------
 * The grouping rules below cover the file shapes in `fixture/specs/`, which is
 * every shape `grouping.ts` makes a claim about. Playwright has two further
 * branches this model does not implement — a file mixing parallel and
 * non-parallel tests (its `general` group is emitted before its parallel ones,
 * regardless of declaration order) and `repeatEach`, which multiplies the
 * worker hash rather than the group. Neither is in the fixture, so neither is
 * claimed.
 */

/** How a spec file's root suite is declared. */
export type FileMode =
  /** Plain `test()` calls at the top level of the file. */
  | 'sequential'
  /** Everything wrapped in `test.describe.parallel`. */
  | 'parallel'
  /** Everything wrapped in `test.describe.serial`. */
  | 'serial'

/** One spec file, described by the two things that decide how it groups. */
export interface SpecFile {
  /** Path relative to `testDir`, which is also the order key. */
  readonly file: string
  /** Test titles in declaration order. */
  readonly titles: readonly string[]
  readonly mode: FileMode
  /** Whether the file declares a `beforeAll` or `afterAll` outside a describe. */
  readonly hasAllHooks: boolean
}

/** A run of tests Playwright will not split across workers, and so not across shards. */
export interface Group {
  readonly project: string
  readonly file: string
  readonly testIds: readonly string[]
}

/** `project › file › title` — the identity `partition.test.ts` compares on. */
export function testId(project: string, file: string, title: string): string {
  return `${project} › ${file} › ${title}`
}

/**
 * The groups one project contributes, in run order.
 *
 * `shardTotal` is a parameter of *grouping*, not only of the cut, and that is
 * the least guessable thing here: Playwright sizes the chunks of a
 * parallel-file-with-hooks by the shard count, so asking for more shards
 * changes what the groups are before it changes where they are cut.
 */
export function groupsOf(
  project: string,
  files: readonly SpecFile[],
  options: { readonly fullyParallel: boolean; readonly shardTotal: number },
): Group[] {
  const groups: Group[] = []

  for (const file of files) {
    const ids = file.titles.map((title) => testId(project, file.file, title))
    const whole = (): void => {
      groups.push({ project, file: file.file, testIds: ids })
    }

    // A serial block is one worker's work by definition, and stays one group
    // whether or not the run is otherwise fully parallel.
    if (file.mode === 'serial') {
      whole()
      continue
    }

    // Not parallel: the file is the unit, which is the default and the source
    // of every badly balanced shard anyone has ever looked at.
    if (file.mode === 'sequential' && !options.fullyParallel) {
      whole()
      continue
    }

    // Parallel with a file-level hook: the hook has to run once per group, so
    // Playwright makes as few groups as the shard count can use.
    if (file.hasAllHooks) {
      const size = Math.ceil(ids.length / options.shardTotal)

      for (let at = 0; at < ids.length; at += size) {
        groups.push({ project, file: file.file, testIds: ids.slice(at, at + size) })
      }

      continue
    }

    // Parallel with no hook: every test is its own group, and the file is free
    // to be split across shards.
    for (const id of ids) {
      groups.push({ project, file: file.file, testIds: [id] })
    }
  }

  return groups
}

/**
 * The sizes of the N slices the group list is cut into.
 *
 * `floor(total / N)` each, with the remainder handed to the *first* shards one
 * test at a time — so shard 1 is never smaller than shard N, before grouping
 * pushes anything around.
 */
export function shardSizes(total: number, shards: number): number[] {
  const sizes = Array.from({ length: shards }, () => Math.floor(total / shards))
  // Hoisted: the remainder has to be measured before any of it is handed out,
  // or the loop shrinks its own bound and stops one shard short.
  const remainder = total - sizes.reduce((a, b) => a + b, 0)

  for (let at = 0; at < remainder; at += 1) {
    sizes[at % shards] = (sizes[at % shards] ?? 0) + 1
  }

  return sizes
}

/** The 1-based shard each group is assigned to, given the whole ordered group list. */
export function shardOf(groups: readonly Group[], shards: number): number[] {
  const total = groups.reduce((count, group) => count + group.testIds.length, 0)
  const sizes = shardSizes(total, shards)

  const assignment: number[] = []
  let seen = 0
  let shard = 1
  let boundary = sizes[0] ?? 0

  for (const group of groups) {
    // Empty slices are possible — `shardSizes(4, 6)` produces two of them —
    // so this advances past every boundary the running count has cleared,
    // not just one.
    while (shard < shards && seen >= boundary) {
      shard += 1
      boundary += sizes[shard - 1] ?? 0
    }

    assignment.push(shard)
    seen += group.testIds.length
  }

  return assignment
}

/** The test ids one shard runs, in run order. */
export function partition(groups: readonly Group[], shard: number, shards: number): string[] {
  const assignment = shardOf(groups, shards)

  return groups.flatMap((group, at) => (assignment[at] === shard ? [...group.testIds] : []))
}

// ---------------------------------------------------------------------------
// Projects, and the one that is not sharded
// ---------------------------------------------------------------------------

/** One entry of a config's `projects` array, reduced to what sharding reads. */
export interface ProjectSpec {
  readonly name: string
  readonly files: readonly SpecFile[]
  /** `dependencies` from the project config. */
  readonly dependencies?: readonly string[]
}

/**
 * The projects that get cut up, and the ones that get copied.
 *
 * Playwright detaches every project that appears in another project's
 * `dependencies`, shards what is left, and then re-attaches each dependency in
 * full to whatever survived. So a dependency project is not divided by the
 * shard count — it is *multiplied* by it, minus the shards that happen to hold
 * none of its dependents.
 */
export function dependencyNames(projects: readonly ProjectSpec[]): Set<string> {
  return new Set(projects.flatMap((project) => project.dependencies ?? []))
}

/** The test ids one shard runs, dependency projects included, in project order. */
export function shardContents(
  projects: readonly ProjectSpec[],
  shard: number,
  shards: number,
  options: { readonly fullyParallel: boolean },
): string[] {
  const dependencies = dependencyNames(projects)
  const sharded = projects.filter((project) => !dependencies.has(project.name))

  const groups = sharded.flatMap((project) =>
    groupsOf(project.name, project.files, { ...options, shardTotal: shards }),
  )

  const kept = new Set(partition(groups, shard, shards))
  const runs = new Set(
    sharded
      .filter((project) =>
        project.files.some((file) =>
          file.titles.some((title) => kept.has(testId(project.name, file.file, title))),
        ),
      )
      .map((project) => project.name),
  )

  return projects.flatMap((project) => {
    if (!dependencies.has(project.name)) {
      return project.files.flatMap((file) =>
        file.titles
          .map((title) => testId(project.name, file.file, title))
          .filter((id) => kept.has(id)),
      )
    }

    // A dependency runs whole, in every shard that kept a test of a project
    // depending on it.
    const needed = [...runs].some((name) =>
      (projects.find((candidate) => candidate.name === name)?.dependencies ?? []).includes(
        project.name,
      ),
    )

    return needed
      ? project.files.flatMap((file) =>
          file.titles.map((title) => testId(project.name, file.file, title)),
        )
      : []
  })
}
