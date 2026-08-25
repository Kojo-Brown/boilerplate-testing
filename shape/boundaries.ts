/**
 * What a test reaches for, and which layer that puts it in.
 *
 * The pyramid and the honeycomb are both claims about a *ratio*, and a ratio
 * is only as honest as the thing being counted. "Unit test" is the vaguest
 * word in testing — every team means something slightly different by it, and
 * a policy stated over a word nobody has pinned down enforces nothing. So the
 * layer of a test is not declared by its author, its folder, or its filename.
 * It is derived, here, from a single mechanical question:
 *
 *     What is the widest real boundary this test can reach?
 *
 * "Reach" is transitive. A Playwright spec that imports `./fixtures`, which
 * re-exports `./auth`, which imports `@playwright/test`, drives a browser just
 * as surely as one that imports the browser directly — so `classify.ts` walks
 * the local import graph and unions what it finds. The layer is the widest
 * boundary in that union.
 *
 * ---------------------------------------------------------------------------
 * Why the table is closed
 * ---------------------------------------------------------------------------
 * Every external module reachable from a test file must appear below, either
 * as a boundary or explicitly as `pure`. A module that is missing is a
 * *failure*, not a pass — the same rule `workflow-templates/actionPins.ts`
 * applies to action pins, and for the same reason. The failure mode of an open
 * table is silent and one-directional: add a dependency that opens a socket,
 * and every test reaching it keeps counting as a unit test, so the ratio
 * improves on paper at the exact moment the suite gets slower. Forcing a new
 * dependency to be classified costs one line and one decision.
 *
 * ---------------------------------------------------------------------------
 * Why some keys carry a binding
 * ---------------------------------------------------------------------------
 * A module specifier is sometimes too coarse. `eslint` is the clear case: the
 * `ESLint` class reads config files and lints paths off disk, while
 * `RuleTester` and `Linter` lint source strings that are already in memory and
 * touch nothing. Same package, opposite answers. Keys may therefore be written
 * `module#Binding`, which wins over a bare `module` key when the test imports
 * that name. A module whose every use is a boundary needs no binding key.
 *
 * Bare `eslint` is deliberately absent: `import eslint from 'eslint'` or a
 * namespace import reaches both halves, and there is no honest answer for it,
 * so it fails the audit and whoever wrote it picks a side.
 */

/** The three layers a ratio policy is stated over. */
export const LAYERS = ['unit', 'integration', 'e2e'] as const

export type Layer = (typeof LAYERS)[number]

/**
 * Layers ordered by how much they can cost.
 *
 * The number is the tie-break when a test reaches several boundaries at once:
 * the widest wins. A Playwright spec that also reads a file off disk is an
 * end-to-end test, not a filesystem test.
 */
export const LAYER_RANK: Readonly<Record<Layer, number>> = {
  unit: 0,
  integration: 1,
  e2e: 2,
}

/**
 * How a module is classified.
 *
 * `pure` does not mean "has no side effects" — React renders into a DOM and
 * faker mutates a seeded PRNG. It means the module cannot reach outside the
 * test process's own memory, which is the property the ranking is about.
 */
export type ModuleClass =
  | { readonly kind: 'pure'; readonly why: string }
  | {
      readonly kind: 'boundary'
      /** The lowest layer a test reaching this module can be in. */
      readonly layer: Layer
      /** The real resource it reaches, for the report and the README. */
      readonly resource: string
      readonly why: string
    }

const pure = (why: string): ModuleClass => ({ kind: 'pure', why })

const boundary = (layer: Layer, resource: string, why: string): ModuleClass => ({
  kind: 'boundary',
  layer,
  resource,
  why,
})

/**
 * Every external module reachable from a test file in this repository.
 *
 * Keys are module specifiers exactly as written in an import, optionally
 * suffixed `#Binding` to classify one named export differently from the rest
 * of its module. Subpaths are distinct keys, which is why `msw` and `msw/node`
 * can disagree — the first defines request handlers as data, the second
 * installs an interceptor into Node's HTTP stack.
 */
export const MODULES: Readonly<Record<string, ModuleClass>> = {
  // -------------------------------------------------------------------------
  // Test runners and assertion libraries
  // -------------------------------------------------------------------------
  vitest: pure('The runner itself. Importing it says nothing about what a test reaches.'),
  '@playwright/test': boundary(
    'e2e',
    'browser + running application',
    'Drives a real browser against an application served over HTTP. This is the ' +
      'only module in the table that implies end-to-end on its own, and it is ' +
      'the one boundary nothing else in this repository can reach.',
  ),

  // -------------------------------------------------------------------------
  // Node built-ins
  // -------------------------------------------------------------------------
  // Only the ones that reach something. `node:path`, `node:url` and
  // `node:module` are string and URL manipulation with no I/O in the uses
  // here, and classifying them as boundaries would put most of the repository
  // in the middle band for computing a filename.
  'node:path': pure('Path string manipulation. Touches no filesystem.'),
  'node:url': pure('URL parsing and `fileURLToPath`. Touches no filesystem.'),
  'node:os': pure('Reads static host facts such as `tmpdir()`. No I/O.'),
  'node:module': pure(
    "`createRequire` builds a resolver; resolution itself is `require.resolve`'s " +
      'job and the callers here pair it with `node:fs`, which is already a boundary.',
  ),
  'node:fs': boundary(
    'integration',
    'filesystem',
    'Reads real files off disk. This is the classic line — Fowler\'s "a unit ' +
      'test does not touch the filesystem" — and it is the single rule that ' +
      "decides this repository's shape, because its audit suites read workflow " +
      'YAML, lockfiles and READMEs. See README.md for the argument, and for what ' +
      'changes if you disagree.',
  ),
  'node:fs/promises': boundary('integration', 'filesystem', 'As `node:fs`, promise-flavoured.'),
  'node:http': boundary(
    'integration',
    'TCP socket',
    'Binds or connects a real server. Even on loopback the test now depends on a ' +
      'port being free and a connection completing.',
  ),
  'node:https': boundary('integration', 'TCP socket', 'As `node:http`, with TLS.'),
  'node:net': boundary(
    'integration',
    'TCP socket',
    'Raw sockets, below the HTTP modules. Nothing here reaches it today; the ' +
      'entry exists so that the day something does, it is classified rather than ' +
      'failing the audit at an inconvenient moment.',
  ),
  'node:child_process': boundary(
    'integration',
    'child process',
    'Spawns another program. Its runtime, its exit code and its stdio are all ' +
      'now part of the test.',
  ),

  // -------------------------------------------------------------------------
  // HTTP and contract testing
  // -------------------------------------------------------------------------
  supertest: boundary(
    'integration',
    'TCP socket',
    'Issues real HTTP requests against a bound server. `createTestApp` binds up ' +
      'front precisely because supertest otherwise takes ownership of the socket.',
  ),
  superagent: boundary('integration', 'TCP socket', "supertest's underlying HTTP client."),
  '@pact-foundation/pact': boundary(
    'integration',
    'TCP socket + filesystem',
    'Starts a mock provider on a port and writes pact files to disk.',
  ),
  msw: pure(
    'The core package defines request handlers as data. Nothing is intercepted ' +
      'until a server or worker is started from them.',
  ),
  'msw/node': boundary(
    'integration',
    "Node's HTTP stack",
    'Installs an interceptor into the runtime, so every request in the process ' +
      'is routed through it for the lifetime of the suite.',
  ),

  // -------------------------------------------------------------------------
  // Linting, used as a subject rather than a tool
  // -------------------------------------------------------------------------
  // Deliberately no bare `eslint` key. A default or namespace import reaches
  // both halves of the package and has no honest single answer, so it fails
  // the audit rather than being guessed at.
  'eslint#ESLint': boundary(
    'integration',
    'filesystem + real config',
    "Resolves this repository's real flat config and lints real paths. That is " +
      'the whole point of `tdd/conventions/conventions.test.ts` — a rule wired to ' +
      'nothing must fail — and it is genuinely an integration test of the lint setup.',
  ),
  'eslint#RuleTester': pure(
    'Lints source strings held in memory. No config resolution, no disk, no ' +
      'process boundary — a rule unit test in the strictest sense.',
  ),
  'eslint#Linter': pure('Lints a string with an explicit inline config. In memory.'),
  'typescript-eslint': pure(
    'Used here for its config helpers and its parser. Turning source text into ' +
      'an AST is computation.',
  ),
  '@typescript-eslint/parser': pure(
    'Turning source text into an AST is computation. The parser reads no file ' +
      'itself — `shape/classify.ts` hands it a string it has already read, and ' +
      'the `filePath` option only tells it which dialect to parse.',
  ),

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
  // jsdom is a DOM implemented in the test process's own heap. It is not a
  // browser and crosses nothing, so a Testing Library test is a unit test
  // under the rule above. The pyramid's cost argument is about out-of-process
  // work, and there is none here.
  react: pure('Rendering into an in-process DOM.'),
  'react-dom': pure('Rendering into an in-process DOM.'),
  'react-dom/client': pure('Rendering into an in-process DOM.'),
  '@testing-library/react': pure('Renders into jsdom, which lives in this process.'),
  '@testing-library/user-event': pure('Dispatches DOM events into jsdom.'),
  '@testing-library/jest-dom': pure('Assertions over DOM nodes.'),
  'axe-core': pure('Walks an in-memory DOM tree and reports violations.'),
  '@reduxjs/toolkit': pure('In-memory state container.'),
  'react-redux': pure('In-memory state container bindings.'),
  '@tanstack/react-query': pure('Cache and state machine; the fetcher is injected.'),
  'react-router': pure('Routing with an in-memory history in tests.'),

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------
  '@faker-js/faker': pure('Seeded pseudo-random generation.'),
  '@prisma/client': boundary(
    'integration',
    'database',
    'Opens a connection to a real database. Nothing under test here does yet — ' +
      '`prisma/isolation.test.ts` tests the isolation helpers themselves and ' +
      'imports no client — but the entry exists so the day one does, the ratio ' +
      'moves on its own.',
  ),
}

/** A module the audit will not vouch for. */
export interface UnclassifiedModule {
  readonly specifier: string
  /** The imported name, or `null` for a side-effect import. */
  readonly binding: string | null
  /** Repo-relative path of the file that imports it. */
  readonly file: string
}

/**
 * Look a module up, preferring the `module#Binding` key when one exists.
 *
 * `binding` is `null` for a side-effect import (`import 'x'`), `'default'` for
 * a default import and `'*'` for a namespace import. None of those can match a
 * binding key, so they fall through to the bare specifier — which is exactly
 * why omitting the bare `eslint` key makes `import * as eslint from 'eslint'`
 * fail instead of resolving to whichever half was listed first.
 */
export function classifyModule(specifier: string, binding: string | null): ModuleClass | null {
  if (binding !== null) {
    const specific = MODULES[`${specifier}#${binding}`]

    if (specific !== undefined) {
      return specific
    }
  }

  return MODULES[specifier] ?? null
}

/**
 * The table key that actually matched, or `null` when nothing did.
 *
 * The census dedupes evidence on this rather than on the raw binding: a
 * Playwright spec importing `test`, `expect`, `Page` and `Browser` reaches one
 * boundary through four names, and reporting it four times would say nothing
 * except how many symbols the file happened to destructure.
 */
export function moduleKey(specifier: string, binding: string | null): string | null {
  if (binding !== null && MODULES[`${specifier}#${binding}`] !== undefined) {
    return `${specifier}#${binding}`
  }

  return MODULES[specifier] !== undefined ? specifier : null
}
