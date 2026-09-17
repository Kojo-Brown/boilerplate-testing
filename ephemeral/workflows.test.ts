// @vitest-environment node
/**
 * The templates, checked against the row of the matrix they claim to be.
 *
 * The first describe is the gate this file exists for: whatever wiring tops
 * the matrix today is read out of the run, projected onto the five controls a
 * workflow file can show, and compared with what the two templates actually
 * say. Nothing here names `namespace-reconciled` as a constant — if the corpus
 * changes and some other wiring wins, this fails and the templates have to
 * move.
 *
 * The rest tests the reader, including on inputs that are wrong in the two
 * ways that matter: a concurrency group that varies per workflow, and a fork
 * gate that is only a comment.
 */

import { describe, expect, it } from 'vitest'

import { derive } from './matrix.ts'
import { STRATEGIES, strategyByKey } from './strategies.ts'
import {
  blockUnder,
  concurrency,
  controlsOf,
  DEPLOY_TEMPLATE,
  deployJobOf,
  destroyJobOf,
  eventTypes,
  implementedControls,
  jobs,
  readTemplate,
  RECONCILE_TEMPLATE,
  triggers,
} from './workflows.ts'

const deployText = readTemplate(DEPLOY_TEMPLATE)
const reconcileText = readTemplate(RECONCILE_TEMPLATE)

const topScoring = (): string => {
  const scores = derive().scores
  const ranked = [...scores.entries()].sort(([, left], [, right]) => right.handled - left.handled)
  const best = ranked[0]

  if (best === undefined) throw new Error('the matrix produced no scores')

  return best[0]
}

describe('the shipped templates', () => {
  it('implement the wiring that tops the matrix, on every control a workflow file can show', () => {
    expect(implementedControls()).toEqual(controlsOf(strategyByKey(topScoring()).wiring))
  })

  it('differ from the standard answer on the controls the README says they do', () => {
    const standard = controlsOf(strategyByKey('on-close').wiring)
    const shipped = implementedControls()

    expect(shipped.trigger).not.toBe(standard.trigger)
    expect(shipped.cancelInFlight).not.toBe(standard.cancelInFlight)
    expect(shipped.reaperBasis).not.toBe(standard.reaperBasis)
  })

  it('name a wiring that exists in the strategy table', () => {
    const keys = STRATEGIES.map((strategy) => strategy.key)

    expect(keys).toContain(topScoring())
  })
})

describe('the deploy template', () => {
  it('shares one concurrency group between deploying and destroying', () => {
    const group = concurrency(deployText)

    expect(group?.cancelInProgress).toBe(true)
    expect(group?.group).toContain('github.event.number')
  })

  /** The mitigation applied and not working, which is the point of the finding. */
  it('keeps `github.workflow` out of that group, or the close cannot cancel a deploy', () => {
    expect(concurrency(deployText)?.group).not.toContain('github.workflow')
  })

  it('gates a fork on a label as well as on the head repository', () => {
    const condition = deployJobOf(deployText).condition ?? ''

    expect(condition).toContain('head.repo.full_name == github.repository')
    expect(condition).toContain("contains(github.event.pull_request.labels.*.name, 'preview')")
  })

  it('builds the head commit rather than the base, which is what the label gate is for', () => {
    expect(deployText).toContain('ref: ${{ github.event.pull_request.head.sha }}')
  })

  it('deploys on open, push, reopen and label, and destroys on close', () => {
    expect(eventTypes(deployText)).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'labeled',
      'closed',
    ])
  })

  /**
   * The weaker of the two shape checks, and labelled as such in `workflows.ts`:
   * the provisioner is a TODO, so what is read is that teardown is a single
   * step. One delete that cascades is the whole benefit of an owned namespace,
   * and a destroy job that grew a list of deletes has stopped having it.
   */
  it('tears down in exactly one step', () => {
    expect(destroyJobOf(deployText)?.stepNames).toHaveLength(1)
  })

  it('seeds the environment in a step of its own, which a preview on a shared database has no need of', () => {
    const names = deployJobOf(deployText).stepNames.join(' | ')

    expect(names).toContain('Seed this environment')
  })

  it('asks for no more permission than it uses', () => {
    const permissions = blockUnder(deployText, 'permissions', 0) ?? []

    expect(permissions.map((line) => line.trim())).toEqual([
      'contents: read',
      'pull-requests: write',
      'id-token: write',
    ])
  })
})

describe('the reconcile template', () => {
  it('runs on a schedule and can be triggered by hand', () => {
    expect(triggers(reconcileText)).toEqual(['schedule', 'workflow_dispatch'])
  })

  it('decides on pull request state rather than on age', () => {
    expect(implementedControls().reaperBasis).toBe('open-prs')
  })

  it('does not cancel itself, because two sweeps racing is harmless and a cancelled one is not', () => {
    expect(concurrency(reconcileText)?.cancelInProgress).toBe(false)
  })

  it('reads only what it needs from the repository', () => {
    const permissions = blockUnder(reconcileText, 'permissions', 0) ?? []

    expect(permissions.map((line) => line.trim())).toEqual([
      'contents: read',
      'pull-requests: read',
      'id-token: write',
    ])
  })
})

describe('the reader', () => {
  it('folds a block-scalar condition onto one line rather than reading it as `>-`', () => {
    expect(deployJobOf(deployText).condition).not.toBe('>-')
    expect(deployJobOf(deployText).condition).toContain('&&')
  })

  it('finds both jobs and their steps', () => {
    const summaries = jobs(deployText)

    expect(summaries.map((job) => job.id)).toEqual(['deploy', 'destroy'])
    expect(summaries[0]?.stepNames.length).toBeGreaterThan(1)
  })

  it('reports a missing block as absent rather than as empty', () => {
    expect(blockUnder(deployText, 'defaults', 0)).toBeNull()
    expect(blockUnder(deployText, 'permissions', 0)).not.toBeNull()
  })

  it('refuses a workflow with no `on:` block', () => {
    expect(() => triggers('name: Nothing\njobs:\n  build:\n    runs-on: ubuntu-latest\n')).toThrow(
      'no `on:` block',
    )
  })

  it('refuses a deploy template with no deploy job', () => {
    const broken = deployText.replace("github.event.action != 'closed' &&", "false &&")

    expect(() => implementedControls(broken, reconcileText)).toThrow('no deploy job')
  })

  it('reads a per-workflow concurrency group as no cancellation at all', () => {
    const broken = deployText.replace(
      'group: preview-${{ github.event.number }}',
      'group: ${{ github.workflow }}-${{ github.event.number }}',
    )

    expect(implementedControls(broken, reconcileText).cancelInFlight).toBe(false)
  })

  it('reads a fork gate that is only a comment as no gate', () => {
    const broken = deployText.replace(
      "(github.event.pull_request.head.repo.full_name == github.repository ||\n       contains(github.event.pull_request.labels.*.name, 'preview'))",
      'true',
    )

    expect(implementedControls(broken, reconcileText).trigger).toBe('pull_request_target')
  })

  it('reads a sweep that compares ages as a TTL reaper rather than a reconciler', () => {
    const broken = reconcileText.replaceAll('--json state', '--created-before')

    expect(implementedControls(deployText, broken).reaperBasis).toBe('age')
  })

  it('reads an unscheduled sweep as no reaper at all', () => {
    const broken = reconcileText.replace('  schedule:', '  push:')

    expect(implementedControls(deployText, broken).reaperBasis).toBeNull()
  })
})
