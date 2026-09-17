/**
 * The shipped workflow templates, read as data and compared with the matrix.
 *
 * ---------------------------------------------------------------------------
 * What this gate is for
 * ---------------------------------------------------------------------------
 * `workflow-templates/preview-environment.yml` and
 * `workflow-templates/preview-reconcile.yml` are the `namespace-reconciled`
 * row of `README.md` written out as two files somebody can copy. A pair of
 * files claiming to be the top-scoring wiring is a claim that decays: somebody
 * changes the corpus, or adds a control, or reorders the strategies, and the
 * templates quietly become the advice that used to be best.
 *
 * So the templates are parsed, the controls they carry are derived, and
 * `workflows.test.ts` compares those with whatever wiring actually tops the
 * matrix today. The measurement and the copyable artefact fail together or not
 * at all.
 *
 * ---------------------------------------------------------------------------
 * What it does not claim
 * ---------------------------------------------------------------------------
 * Five of the seven controls are readable from a workflow file. Two are not:
 * `namespaced` and `seedPolicy` are properties of a provisioner the template
 * cannot contain, because every reader's is different — the templates leave
 * `run:` bodies marked TODO and there is no honest way to read a control out
 * of a placeholder.
 *
 * {@link AUDITED_CONTROLS} is therefore explicit about which five are checked,
 * and `workflows.test.ts` asserts the *shape* of the other two rather than
 * their content: the destroy job is one step, because one delete that cascades
 * is what an owned namespace buys, and the deploy job has a seeding step of
 * its own, because a preview pointed at a shared database does not have one.
 * That is weaker than the other five and it is labelled as such rather than
 * dressed up.
 *
 * ---------------------------------------------------------------------------
 * The reader
 * ---------------------------------------------------------------------------
 * A targeted line reader, not a YAML parser, and it follows the precedent
 * `workflow-templates/actionPins.ts` sets for the same reason: the repository
 * has no YAML dependency, these two documents are ours, and the alternative is
 * adding a parser to check two files. It reads by indentation and fails loudly
 * on anything it does not recognise, so a template it cannot understand is a
 * red test rather than a silently empty result.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { DeployTrigger, PrEvent, ReaperBasis, Wiring } from './strategies.ts'

/**
 * The five controls, in the shape both a template and a wiring can be read
 * into, so the two are comparable without inventing values for the two a
 * template cannot state.
 */
export interface ImplementedControls {
  readonly trigger: DeployTrigger
  readonly deployOn: readonly PrEvent[]
  readonly teardownOnClose: boolean
  readonly cancelInFlight: boolean
  /** `null` when no scheduled sweep exists. A TTL is not read: see `reaperOf`. */
  readonly reaperBasis: ReaperBasis | null
}

/** Project a wiring onto the five controls a workflow file can show. */
export const controlsOf = (wiring: Wiring): ImplementedControls => ({
  trigger: wiring.trigger,
  deployOn: wiring.deployOn,
  teardownOnClose: wiring.teardownOnClose,
  cancelInFlight: wiring.cancelInFlight,
  reaperBasis: wiring.reaper?.basis ?? null,
})

const TEMPLATE_DIR = fileURLToPath(new URL('../workflow-templates/', import.meta.url))

export const DEPLOY_TEMPLATE = 'preview-environment.yml'
export const RECONCILE_TEMPLATE = 'preview-reconcile.yml'

export const readTemplate = (file: string): string => readFileSync(TEMPLATE_DIR + file, 'utf8')

const indentOf = (line: string): number => line.length - line.trimStart().length

const isBlankOrComment = (line: string): boolean => {
  const trimmed = line.trim()

  return trimmed === '' || trimmed.startsWith('#')
}

/**
 * The lines of a block introduced by `key:` at the given indentation.
 *
 * Returns `null` when the key is absent, which callers distinguish from an
 * empty block: `concurrency:` missing and `concurrency:` present but empty
 * are different bugs.
 */
export function blockUnder(text: string, key: string, indent: number): readonly string[] | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => indentOf(line) === indent && line.trim().startsWith(`${key}:`))

  if (start === -1) return null

  const body: string[] = []

  for (const line of lines.slice(start + 1)) {
    if (isBlankOrComment(line)) continue
    if (indentOf(line) <= indent) break

    body.push(line)
  }

  return body
}

/** A scalar written as `key: value` somewhere in a block. */
export function scalarIn(lines: readonly string[], key: string): string | null {
  const found = lines.find((line) => line.trim().startsWith(`${key}:`))

  if (found === undefined) return null

  return found.trim().slice(key.length + 1).trim()
}

/** The top-level `on:` keys — the events the workflow is wired to. */
export function triggers(text: string): readonly string[] {
  const block = blockUnder(text, 'on', 0)

  if (block === null) throw new Error('workflow has no `on:` block')

  return block
    .filter((line) => indentOf(line) === 2 && line.trim().endsWith(':'))
    .map((line) => line.trim().slice(0, -1))
}

/** The `types: [...]` list, which is what decides when a deploy is attempted. */
export function eventTypes(text: string): readonly string[] {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith('types:'))

  if (line === undefined) return []

  const inner = /\[(?<list>[^\]]*)\]/u.exec(line)?.groups?.['list']

  if (inner === undefined) throw new Error('`types:` is not an inline list this reader can follow')

  return inner
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export interface Concurrency {
  readonly group: string
  readonly cancelInProgress: boolean
}

/** The workflow-level `concurrency:` block. */
export function concurrency(text: string): Concurrency | null {
  const block = blockUnder(text, 'concurrency', 0)

  if (block === null) return null

  const group = scalarIn(block, 'group')
  const cancel = scalarIn(block, 'cancel-in-progress')

  if (group === null) throw new Error('`concurrency:` has no `group:`')

  return { group, cancelInProgress: cancel === 'true' }
}

export interface JobSummary {
  readonly id: string
  /** The `if:` expression, folded onto one line, or `null` when the job is unconditional. */
  readonly condition: string | null
  /** Every `- name:` in the job's `steps:`, in order. */
  readonly stepNames: readonly string[]
}

/** Every job in the file, with the two things this audit reads. */
export function jobs(text: string): readonly JobSummary[] {
  const block = blockUnder(text, 'jobs', 0)

  if (block === null) throw new Error('workflow has no `jobs:` block')

  const ids = block
    .filter((line) => indentOf(line) === 2 && line.trim().endsWith(':'))
    .map((line) => line.trim().slice(0, -1))

  return ids.map((id) => {
    const body = blockUnder(text, id, 2) ?? []
    const raw = scalarIn(body, 'if')

    return {
      id,
      condition: raw === null ? null : foldCondition(body, raw),
      stepNames: (blockUnder(body.join('\n'), 'steps', 4) ?? [])
        .filter((line) => line.trim().startsWith('- name:'))
        .map((line) => line.trim().slice('- name:'.length).trim()),
    }
  })
}

/**
 * Join a block-scalar `if:` into one line.
 *
 * A condition worth reading is usually written `if: >-` across several lines,
 * and a reader that only took the first line would see `>-` and conclude the
 * job is unconditional — the most dangerous possible misreading here, since
 * the fork gate is exactly such a condition.
 */
function foldCondition(body: readonly string[], raw: string): string {
  if (raw !== '>-' && raw !== '>' && raw !== '|' && raw !== '|-') return raw

  const start = body.findIndex((line) => line.trim().startsWith('if:'))
  const baseIndent = indentOf(body[start] ?? '')
  const parts: string[] = []

  for (const line of body.slice(start + 1)) {
    if (isBlankOrComment(line)) continue
    if (indentOf(line) <= baseIndent) break

    parts.push(line.trim())
  }

  if (parts.length === 0) throw new Error('`if:` opens a block scalar with nothing in it')

  return parts.join(' ')
}

/** The five controls a workflow file can honestly be read for. */
export const AUDITED_CONTROLS = [
  'trigger',
  'deployOn',
  'teardownOnClose',
  'cancelInFlight',
  'reaper',
] as const

export type AuditedControl = (typeof AUDITED_CONTROLS)[number]

const EVENT_BY_TYPE: Readonly<Record<string, PrEvent>> = {
  opened: 'opened',
  synchronize: 'synchronize',
  reopened: 'synchronize',
  labeled: 'labeled',
}

/** The job that deploys: the one that is not gated on the pull request closing. */
const deployJob = (summaries: readonly JobSummary[]): JobSummary => {
  const found = summaries.find((job) => job.condition?.includes("action != 'closed'") === true)

  if (found === undefined) throw new Error('no deploy job: expected one gated on `action != \'closed\'`')

  return found
}

const destroyJob = (summaries: readonly JobSummary[]): JobSummary | undefined =>
  summaries.find((job) => job.condition?.includes("action == 'closed'") === true)

/**
 * Which trigger the deploy job amounts to.
 *
 * `pull_request_target` plus a condition that names both the head repository
 * and the label is the gate; `pull_request_target` on its own is not, however
 * carefully the surrounding comments describe the risk.
 */
function triggerOf(text: string, summaries: readonly JobSummary[]): DeployTrigger {
  const on = triggers(text)

  if (on.includes('pull_request') && !on.includes('pull_request_target')) return 'pull_request'
  if (!on.includes('pull_request_target')) throw new Error('deploy template is wired to no pull-request event')

  const condition = deployJob(summaries).condition ?? ''
  const gated =
    condition.includes('head.repo.full_name == github.repository') &&
    condition.includes('labels.*.name')

  return gated ? 'labelled' : 'pull_request_target'
}

/**
 * How the reconciling workflow decides an environment is finished with.
 *
 * Read from what its script actually asks: a step that queries pull request
 * state reconciles, and one that compares a creation time to a TTL does not.
 * `null` when the file is not scheduled at all, because a sweep nothing runs
 * is not a reaper.
 */
function reaperOf(text: string): ReaperBasis | null {
  if (!triggers(text).includes('schedule')) return null

  if (text.includes('--json state')) return 'open-prs'

  return 'age'
}

/** The controls the two templates implement, as far as a workflow file shows them. */
export function implementedControls(
  deployText: string = readTemplate(DEPLOY_TEMPLATE),
  reconcileText: string = readTemplate(RECONCILE_TEMPLATE),
): ImplementedControls {
  const summaries = jobs(deployText)
  const group = concurrency(deployText)
  const types = eventTypes(deployText)
  const deployOn: PrEvent[] = []

  for (const type of types) {
    const event = EVENT_BY_TYPE[type]

    if (event !== undefined && !deployOn.includes(event)) deployOn.push(event)
  }

  return {
    trigger: triggerOf(deployText, summaries),
    deployOn,
    teardownOnClose: destroyJob(summaries) !== undefined,
    // A group that varies per workflow does not cancel a deploy when a close
    // arrives, which is the whole of `zombie-deploy`. It is not
    // `cancel-in-progress` in any sense the matrix measures.
    cancelInFlight:
      group !== null && group.cancelInProgress && !group.group.includes('github.workflow'),
    reaperBasis: reaperOf(reconcileText),
  }
}

/** The deploy job of a template, for tests that read its steps. */
export const deployJobOf = (deployText: string = readTemplate(DEPLOY_TEMPLATE)): JobSummary =>
  deployJob(jobs(deployText))

/** The destroy job of a template, for tests that read its steps. */
export const destroyJobOf = (deployText: string = readTemplate(DEPLOY_TEMPLATE)): JobSummary | undefined =>
  destroyJob(jobs(deployText))
