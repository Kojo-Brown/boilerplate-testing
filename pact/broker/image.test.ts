/**
 * Audits the broker image pin in `.github/workflows/ci.yml`.
 *
 * The same job `workflow-templates/actionPins.ts` does for `uses:` lines and
 * `patchedDeps.ts` does for the Storybook patch, and for the same reason: the
 * pin lives in a YAML file nothing typechecks, so a drift between the workflow
 * and `image.ts` changes what every number in `pact/README.md` was measured
 * against, silently.
 *
 * Read as text rather than parsed as YAML, like the audits it follows. What is
 * being checked is that a string appears where it should — a YAML parser would
 * add a dependency to assert less.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PACT_BROKER_DATABASE_IMAGE,
  PACT_BROKER_IMAGE,
  PACT_BROKER_PORT,
} from './image'

const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.github',
  'workflows',
  'ci.yml',
)

const workflow = readFileSync(WORKFLOW, 'utf8')

/** Lines mentioning the broker image, wherever they appear. */
function linesWith(fragment: string): string[] {
  return workflow.split('\n').filter((line) => line.includes(fragment))
}

/**
 * The same, minus YAML comments.
 *
 * The prose above the contracts job names `pactfoundation/pact-broker` while
 * explaining why it is a step rather than a service container, and a comment
 * cannot start a container. Auditing comments for a version pin would force the
 * tag into every sentence that mentions the broker, which is how an audit
 * teaches people to stop writing comments.
 */
function commandLinesWith(fragment: string): string[] {
  return linesWith(fragment).filter((line) => !line.trimStart().startsWith('#'))
}

describe('The broker image pin', () => {
  it('names an exact version rather than a floating tag', () => {
    expect(PACT_BROKER_IMAGE).toMatch(/^pactfoundation\/pact-broker:\d+\.\d+\.\d+-pactbroker\d+\.\d+\.\d+$/)
  })

  it('appears in the workflow that starts it', () => {
    expect(commandLinesWith(PACT_BROKER_IMAGE).length).toBeGreaterThan(0)
  })

  it('is pulled explicitly before it is run', () => {
    // Both a `docker pull` and a `docker run` mention it. Pulling first is
    // what makes a registry problem read as one.
    expect(commandLinesWith(`docker pull ${PACT_BROKER_IMAGE}`)).toHaveLength(1)
    expect(commandLinesWith(PACT_BROKER_IMAGE).length).toBeGreaterThanOrEqual(2)
  })

  it('is the only pactfoundation/pact-broker reference the workflow runs', () => {
    // A second, unpinned mention — a stray `latest` in a `docker run` — would
    // make the pin above true and meaningless.
    const mentions = commandLinesWith('pactfoundation/pact-broker')
    for (const line of mentions) {
      expect(line, `unpinned broker reference: ${line.trim()}`).toContain(PACT_BROKER_IMAGE)
    }
  })

  it('names the database image the broker stores into', () => {
    expect(commandLinesWith(PACT_BROKER_DATABASE_IMAGE).length).toBeGreaterThan(0)
  })

  it('exposes the broker on the port the suite is pointed at', () => {
    expect(workflow).toContain(`PACT_BROKER_PORT=${PACT_BROKER_PORT}`)
    expect(workflow).toContain(`PACT_BROKER_BASE_URL: http://127.0.0.1:${PACT_BROKER_PORT}`)
    expect(workflow).toContain(`http://127.0.0.1:${PACT_BROKER_PORT}/diagnostic/status/heartbeat`)
  })
})
