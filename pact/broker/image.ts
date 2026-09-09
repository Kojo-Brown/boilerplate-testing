/**
 * The broker image CI runs, pinned here rather than only in the workflow.
 *
 * Same reasoning as `containers/images.ts`: a tag that lives only in a YAML
 * file drifts, and the drift is invisible until a run behaves differently for
 * reasons nobody connects to an image. `image.test.ts` reads
 * `.github/workflows/ci.yml` and fails if the two disagree.
 *
 * The tag encodes both versions the image carries — the Docker image's own
 * `2.143.0` and the `pact_broker` gem's `2.121.0` inside it — and the second
 * is the one that matters, because every broker behaviour `pipeline/` relies
 * on is a property of that application: `POST /contracts/publish`,
 * `deployedOrReleased` selectors, the pending calculation, and
 * `can-i-deploy`'s wording.
 *
 * `latest` would be the wrong pin for the same reason `containers/` pins its
 * three: a matrix whose cells are derived from a broker's answers is a
 * measurement of that broker's version.
 */

/** The image `.github/workflows/ci.yml` starts for the contracts job. */
export const PACT_BROKER_IMAGE = 'pactfoundation/pact-broker:2.143.0-pactbroker2.121.0'

/** The Postgres the broker stores its data in, as a CI service container. */
export const PACT_BROKER_DATABASE_IMAGE = 'postgres:17-alpine'

/** The port the broker listens on, and the one `PACT_BROKER_BASE_URL` names. */
export const PACT_BROKER_PORT = 9292
