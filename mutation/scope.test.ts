// @vitest-environment node
//
// Reads the repository off disk — the scope table's modules, the Stryker
// config, the workflow, package.json — and resolves them relative to
// `import.meta.url`, which the project-default jsdom environment rewrites.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { coveringSuites, externalsReachedBy, suitesReaching } from './reach'
import { SCOPE, entryFor, scopedModules } from './scope'
import strykerConfig from './stryker.config'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (file: string): string => readFileSync(join(repoRoot, file), 'utf8')

const suites = coveringSuites(scopedModules())

// ---------------------------------------------------------------------------
// The table against the repository
// ---------------------------------------------------------------------------

describe('the scope table', () => {
  it('names a module that exists for every entry', () => {
    for (const entry of SCOPE) {
      expect(existsSync(join(repoRoot, entry.module))).toBe(true)
    }
  })

  it('names source modules rather than test files', () => {
    // Mutating a test file scores the tests of the tests, which nothing here
    // has, so every mutant would survive and the floor would be unreachable.
    for (const entry of SCOPE) {
      expect(entry.module).not.toMatch(/\.(test|spec)\.tsx?$/)
    }
  })

  it('looks an entry up by module and reports nothing for one that is not scoped', () => {
    expect(entryFor(SCOPE[0]?.module ?? '')).toBe(SCOPE[0])
    expect(entryFor('not/in/scope.ts')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The table against Stryker's config
// ---------------------------------------------------------------------------

describe('stryker.config.ts', () => {
  it('mutates exactly the modules in the scope table', () => {
    // Not "contains" — equality in both directions. A glob wider than the
    // table produces rows nothing gates; narrower, and a floor sits in the
    // file enforcing nothing. `policy.ts` fails a run either way, three
    // minutes in; this fails it in `pnpm test`.
    expect(strykerConfig.mutate).toEqual(scopedModules())
  })

  it('names the vitest runner plugin instead of relying on the default glob', () => {
    // Stryker's default is a glob over `node_modules/@stryker-mutator/*`,
    // which under pnpm's symlinked layout finds nothing and reports a missing
    // plugin as though the install were broken.
    expect(strykerConfig.plugins).toContain('@stryker-mutator/vitest-runner')
  })

  it('runs the tests through the mutation project rather than the root config', () => {
    expect(strykerConfig.vitest?.configFile).toBe('mutation/vitest.config.ts')
  })

  it('analyses coverage per test, which the attribution is derived from', () => {
    // Without `perTest` there is no `coveredBy`, so `report.ts` cannot say
    // which suites reach a mutant and every run pays for every test.
    expect(strykerConfig.coverageAnalysis).toBe('perTest')
  })

  it('writes the JSON report where the gate reads it from', () => {
    expect(strykerConfig.jsonReporter?.fileName).toBe('reports/mutation/mutation.json')
    expect(read('mutation/check.ts')).toContain('reports/mutation/mutation.json')
  })

  it('leaves the break threshold unset, so one gate owns the exit code', () => {
    // Stryker exiting non-zero on its own threshold would make a score below
    // the floor indistinguishable from a crash, and `check.ts` would have to
    // guess which happened.
    expect(strykerConfig.thresholds?.break).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The table against the Vitest project the run executes
// ---------------------------------------------------------------------------

describe('vitest.config.ts', () => {
  const source = read('mutation/vitest.config.ts')

  it('derives its include list rather than listing suites by hand', () => {
    // Read as text rather than imported: importing it would pull `vitest/config`
    // into this test file's import graph, and `shape/boundaries.ts` classifies
    // what test files reach. A config is not a boundary and should not make
    // this suite look like one.
    expect(source).toContain('coveringSuites(scopedModules()')
  })

  it('pins the `vitest` specifier so the repository’s own vitest/ cannot shadow it', () => {
    // Removing this alias does not degrade anything gracefully: every worker
    // dies in the dry run with a message that names neither Stryker nor the
    // directory. See the config's own header.
    expect(source).toContain('/^vitest$/')
    expect(source).toContain("import.meta.resolve('vitest')")
  })

  it('has a directory at vitest/ for that alias to be about', () => {
    // If this ever stops being true the alias is dead weight and should go,
    // rather than sitting there as an unexplained line.
    expect(existsSync(join(repoRoot, 'vitest'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// What the run loads
// ---------------------------------------------------------------------------

describe('the suites a mutation run loads', () => {
  it('covers every scoped module', () => {
    const found = suitesReaching(scopedModules())

    for (const entry of SCOPE) {
      expect(found.get(entry.module) ?? []).not.toHaveLength(0)
    }
  })

  it('loads nothing that does not reach a scoped module', () => {
    // The dry run pays for every test in the project once. A suite in the
    // include list that cannot touch a mutant is pure cost.
    const found = suitesReaching(scopedModules())
    const union = new Set([...found.values()].flat())

    expect([...suites].sort()).toEqual([...union].sort())
  })

  it('needs no DOM, which is what `environment: node` claims', () => {
    // The list is the DOM-dependent modules this repository actually has, so
    // it is an early warning rather than a proof; the authoritative check is
    // that the run itself fails. Failing here costs a second in `pnpm test`
    // instead of three minutes in a job about mutation scores.
    const needsDom = [
      '@testing-library/react',
      '@testing-library/user-event',
      '@testing-library/jest-dom',
      'react-dom',
      'react-dom/client',
      'jsdom',
      'axe-core',
    ]
    const reached = externalsReachedBy(suites.map((suite) => join(repoRoot, suite)))

    expect(needsDom.filter((module) => reached.has(module))).toEqual([])
  })

  it('is every suite Vitest would run for these modules, including the indirect ones', () => {
    // Named explicitly because it is the assertion the whole derivation
    // exists for. `property/detection.test.ts` and `property/faults.test.ts`
    // reach `availability.ts` without naming it; listing suites by hand
    // leaves them out, and the module's score reads 81.05% instead of 83.66%.
    expect(suites).toContain('property/detection.test.ts')
    expect(suites).toContain('property/faults.test.ts')
  })
})

// ---------------------------------------------------------------------------
// The gate's wiring
// ---------------------------------------------------------------------------

describe('the mutation gate', () => {
  it('is a package script', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

    expect(packageJson.scripts['mutation:check']).toBe('node mutation/check.ts')
  })

  it('runs in CI', () => {
    expect(read('.github/workflows/ci.yml')).toContain('pnpm mutation:check')
  })

  it('pins Stryker exactly, because every floor is relative to its mutators', () => {
    // A caret range here would let a minor release add a mutator, change the
    // denominator of every score in `README.md` and move four floors, with no
    // diff to review — the same argument `property/` makes for pinning
    // fast-check, where a seed is only meaningful against one generator.
    const packageJson = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>
    }

    for (const [name, range] of Object.entries(packageJson.devDependencies)) {
      if (name.startsWith('@stryker-mutator/')) {
        expect(range).toMatch(/^\d+\.\d+\.\d+$/)
      }
    }

    expect(Object.keys(packageJson.devDependencies)).toContain('@stryker-mutator/core')
  })

  it('keeps Stryker’s sandbox and report out of the repository', () => {
    // Both are regenerated, and the sandbox is a full copy of the tree —
    // committing it would double every file in the repository.
    const gitignore = read('.gitignore')

    expect(gitignore).toContain('.stryker-tmp/')
    expect(gitignore).toContain('reports/')
  })

  it('keeps Stryker’s sandbox out of every tool that walks the tree', () => {
    // A crashed run leaves `.stryker-tmp/` behind holding a copy of the whole
    // repository, and each of these fails differently and confusingly for it:
    // the census silently doubles every count, `tsc` reports each error twice
    // from a path nobody edits, and ESLint refuses to lint anything at all
    // because the copy contains a second `tsconfig.json` ("multiple candidate
    // TSConfigRootDirs are present"). None of the three names Stryker.
    expect(read('shape/classify.ts')).toContain("'.stryker-tmp',")
    expect(read('tsconfig.json')).toContain('".stryker-tmp"')
    expect(read('eslint.config.js')).toContain("'.stryker-tmp/**',")
  })
})
