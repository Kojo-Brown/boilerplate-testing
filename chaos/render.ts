/**
 * Rendering the measurement as the tables `README.md` publishes.
 *
 * The document does not contain a table somebody typed. It contains the output
 * of these functions, and `readme.test.ts` compares the two as text — the
 * discipline `flake/`, `trace/`, `lighthouse/` and `impact/` established here.
 * There is no version of that test which agrees with a published table holding
 * a wrong cell.
 *
 * The findings below are held to the same standard in both directions: each is
 * a predicate over the measured tables plus the heading the README must carry,
 * so a finding that stops being true fails the audit, and a heading with no
 * finding behind it fails too. `findings.test.ts` goes one further and moves a
 * single cell under each one, requiring it to notice — a predicate that passes
 * whatever the table says is decoration.
 */

import { CATEGORIES, FAULTS, FAULT_IDS, type FaultId } from './faults.ts'
import { LAYERS, type LayerId } from './layers.ts'
import { sameCell, type Cell, type Table } from './outcomes.ts'
import { TABLES, TOTAL_CELLS } from './matrix.ts'
import { BREAKER_THRESHOLD, MAX_ATTEMPTS, POLICIES, POLICY_IDS, SERIES_LENGTH, type PolicyId } from './policies.ts'
import { BUDGET_MS, INJECTED_MS } from './timings.ts'

/** The runtime every cell was measured against. */
export const MEASURED_AGAINST = 'Node 22.22.0, whose `fetch` is undici'

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`

const divider = (count: number): string => `|${'---|'.repeat(count)}`

/** Short column heads, because nine full fault ids do not fit in a row. */
const SHORT: Readonly<Record<FaultId, string>> = {
  healthy: 'healthy',
  'slow-headers': 'slow hdrs',
  'slow-body': 'slow body',
  'error-500': '500',
  'transient-500': '500 once',
  'malformed-body': 'bad body',
  'connection-refused': 'refused',
  'reset-mid-body': 'reset',
  'black-hole': 'black hole',
}

const show = (cell: Cell): string => `${cell.outcome} · ${cell.band} · ${String(cell.requests)}`

/** The fault catalogue, grouped by the three categories the SPEC item names. */
export function renderFaults(): string {
  return [
    row(['fault', 'category', 'what the origin does']),
    divider(3),
    ...CATEGORIES.flatMap((category) =>
      FAULTS.filter((fault) => fault.category === category).map((fault) =>
        row([`\`${fault.id}\``, category, fault.injects]),
      ),
    ),
  ].join('\n')
}

/** The wiring catalogue: what each row is, and what it is sold as. */
export function renderPolicies(): string {
  return [
    row(['wiring', 'what it is', 'what it claims']),
    divider(3),
    ...POLICIES.map((policy) => row([`\`${policy.id}\``, policy.wiring, policy.claims])),
  ].join('\n')
}

/** One layer's cells, as `outcome · band · requests`. */
export function renderTable(layer: LayerId, tables: Tables = TABLES): string {
  return [
    row(['wiring', ...FAULT_IDS.map((fault) => SHORT[fault])]),
    divider(FAULT_IDS.length + 1),
    ...POLICY_IDS.map((policy) =>
      row([`\`${policy}\``, ...FAULT_IDS.map((fault) => show(at(tables, layer, policy, fault)))]),
    ),
  ].join('\n')
}

/** Every policy/fault pair the two layers disagree about. */
export function disagreements(
  tables: Tables = TABLES,
): readonly { readonly policy: PolicyId; readonly fault: FaultId }[] {
  return POLICY_IDS.flatMap((policy) =>
    FAULT_IDS.filter(
      (fault) => !sameCell(at(tables, 'socket', policy, fault), at(tables, 'fetch-stub', policy, fault)),
    ).map((fault) => ({ policy, fault })),
  )
}

/**
 * The disagreement table: the truth beside the imitation, for the cells where
 * they differ.
 *
 * Rendered from `disagreements()` rather than written out, so a thirteenth
 * disagreement appears in the README the moment it appears in the measurement
 * instead of waiting for somebody to notice.
 */
export function renderDisagreements(tables: Tables = TABLES): string {
  return [
    row(['wiring', 'fault', '`socket` says', '`fetch-stub` says']),
    divider(4),
    ...disagreements(tables).map(({ policy, fault }) =>
      row([
        `\`${policy}\``,
        `\`${fault}\``,
        show(at(tables, 'socket', policy, fault)),
        show(at(tables, 'fetch-stub', policy, fault)),
      ]),
    ),
  ].join('\n')
}

/** The two layers, and what each costs. */
export function renderLayers(): string {
  return [
    row(['layer', 'how the fault is produced', 'what it costs']),
    divider(3),
    ...LAYERS.map((layer) => row([`\`${layer.id}\``, layer.injects, layer.cost])),
  ].join('\n')
}

/**
 * A claim the README makes, and the measurement it has to survive.
 *
 * `holds` takes the tables rather than reading the module's, and that is the
 * difference between a predicate and a decoration: `findings.test.ts` hands
 * each one a copy of the measurement with a single cell moved and requires it
 * to return false. A finding that closed over `TABLES` could be a function
 * returning `true` and no test in this repository would notice.
 */
export interface Finding {
  /** The heading the README must carry, verbatim. */
  readonly heading: string
  /** True when the measurement still supports it. */
  readonly holds: (tables: Tables) => boolean
}

/** Both layers' cells, as the findings and the renderer read them. */
export type Tables = Readonly<Record<LayerId, Table>>

const at = (tables: Tables, layer: LayerId, policy: PolicyId, fault: FaultId): Cell =>
  tables[layer][policy][fault]

/** Faults where two wirings' cells differ, at one layer. */
const differingFaults = (
  tables: Tables,
  layer: LayerId,
  left: PolicyId,
  right: PolicyId,
): readonly FaultId[] =>
  FAULT_IDS.filter((fault) => !sameCell(at(tables, layer, left, fault), at(tables, layer, right, fault)))

/** The wirings whose only timeout is an `AbortSignal` handed to the transport. */
const SIGNAL_WIRINGS: readonly PolicyId[] = ['signal-timeout', 'retry-5xx', 'retry-any', 'breaker']

/**
 * Every wiring that has a timeout at all — the five rows below `bare`.
 *
 * Derived rather than listed, so that a seventh wiring joins it by being
 * declared rather than by somebody remembering to add it here.
 */
const TIMEOUT_WIRINGS: readonly PolicyId[] = POLICY_IDS.filter((policy) => policy !== 'bare')

/** The faults that are made of waiting rather than of an event. */
const WAITING_FAULTS: readonly FaultId[] = ['slow-headers', 'slow-body', 'black-hole']

export const FINDINGS: readonly Finding[] = [
  {
    heading: 'One fault in nine separates a timeout that works from one that does not',
    holds: (tables) => {
      const differing = differingFaults(tables, 'socket', 'race-timeout', 'signal-timeout')

      return (
        differing.length === 1 &&
        differing[0] === 'slow-body' &&
        at(tables, 'socket', 'race-timeout', 'slow-body').outcome === 'ok' &&
        at(tables, 'socket', 'race-timeout', 'slow-body').band === 'waited-out' &&
        at(tables, 'socket', 'signal-timeout', 'slow-body').outcome === 'aborted' &&
        at(tables, 'socket', 'signal-timeout', 'slow-body').band === 'prompt'
      )
    },
  },
  {
    heading: 'A wiring with no status check hands the error payload back as data',
    holds: (tables) =>
      FAULT_IDS.filter((fault) => at(tables, 'socket', 'bare', fault).outcome === 'wrong-body').join() ===
      ['error-500', 'transient-500'].join(),
  },
  {
    heading: 'Retrying on any error changes no outcome and triples the requests',
    holds: (tables) => {
      const sameVerdict = FAULT_IDS.every(
        (fault) =>
          at(tables, 'socket', 'retry-any', fault).outcome === at(tables, 'socket', 'retry-5xx', fault).outcome &&
          at(tables, 'socket', 'retry-any', fault).band === at(tables, 'socket', 'retry-5xx', fault).band,
      )
      const costlier = FAULT_IDS.filter(
        (fault) =>
          at(tables, 'socket', 'retry-any', fault).requests ===
          at(tables, 'socket', 'retry-5xx', fault).requests * MAX_ATTEMPTS,
      )

      return sameVerdict && costlier.length === 6
    },
  },
  {
    heading: 'The breaker row says nothing about the dependency',
    holds: (tables) => {
      const open = FAULT_IDS.filter((fault) => at(tables, 'socket', 'breaker', fault).outcome === 'breaker-open')

      // Constant in the outcome column, and separated from the row above it
      // only by how many requests it made.
      const costOnly = open.every(
        (fault) =>
          at(tables, 'socket', 'breaker', fault).requests === BREAKER_THRESHOLD &&
          at(tables, 'socket', 'retry-any', fault).requests !== BREAKER_THRESHOLD,
      )

      return open.length === 7 && costOnly
    },
  },
  {
    heading: 'The cheap injection layer is faithful about events and backwards about waiting',
    holds: (tables) => {
      const differing = disagreements(tables)

      return (
        differing.length === SIGNAL_WIRINGS.length * WAITING_FAULTS.length &&
        differing.every(
          ({ policy, fault }) => SIGNAL_WIRINGS.includes(policy) && WAITING_FAULTS.includes(fault),
        )
      )
    },
  },
  {
    heading: 'At the stub layer the broken wiring is the only one that looks correct',
    // Stated over the band rather than the outcome, because the five wirings
    // with a timeout do not all end the call the same way — `breaker` reports
    // `breaker-open` where the others report `aborted` — and what the claim is
    // about is whether the call ended at all. `prompt` is exactly that: the
    // wiring settled before the injected fault could have elapsed.
    holds: (tables) => {
      const promptly = (layer: LayerId): readonly PolicyId[] =>
        TIMEOUT_WIRINGS.filter((policy) => at(tables, layer, policy, 'slow-headers').band === 'prompt')

      return (
        // At the socket layer every wiring with a timeout catches it, so
        // nothing distinguishes the broken one from the correct ones...
        promptly('socket').join() === TIMEOUT_WIRINGS.join() &&
        // ...and at the stub layer the broken one is the only survivor.
        promptly('fetch-stub').join() === ['race-timeout'].join()
      )
    },
  },
  {
    heading: 'A breaker cannot open against a dependency that never answers',
    holds: (tables) =>
      at(tables, 'socket', 'breaker', 'black-hole').outcome === 'breaker-open' &&
      at(tables, 'fetch-stub', 'breaker', 'black-hole').outcome === 'hung' &&
      at(tables, 'fetch-stub', 'breaker', 'black-hole').requests === SERIES_LENGTH,
  },
]

/** The numbers the prose quotes, in one place so the README cannot invent one. */
export const QUOTED = {
  cells: TOTAL_CELLS,
  budgetMs: BUDGET_MS,
  injectedMs: INJECTED_MS,
  attempts: MAX_ATTEMPTS,
  series: SERIES_LENGTH,
  disagreements: disagreements().length,
} as const

/** `TABLES` re-exported so the README audit reads one module, not three. */
export { TABLES }
