/**
 * Every container image this directory can start, and the one place a tag is
 * allowed to appear.
 *
 * ---------------------------------------------------------------------------
 * Why a table rather than a string at each call site
 * ---------------------------------------------------------------------------
 * A container image is a dependency with no lockfile. `pnpm-lock.yaml` pins
 * every npm package to a resolved version and CI installs with
 * `--frozen-lockfile`; nothing does that for `postgres:17-alpine`, which is a
 * moving pointer that resolves to whatever was pushed last. The failure mode
 * is the one this repository keeps finding: a suite that was green for months
 * goes red on a morning nobody committed anything, and the diff that would
 * explain it does not exist.
 *
 * Pinning to an exact tag does not fix that — a tag is mutable — but it makes
 * the version a thing somebody chose, in a file, that a pull request can
 * change. `images.test.ts` enforces the two rules that keep it worth having:
 * every store names its image here and nowhere else, and no tag is `latest` or
 * a bare major.
 *
 * ---------------------------------------------------------------------------
 * On registry mirrors
 * ---------------------------------------------------------------------------
 * The names below are Docker Hub names, unprefixed, because that is what a
 * consumer copying this directory will have access to. An environment that
 * cannot reach Docker Hub — a corporate mirror, or a sandbox whose egress
 * policy blocks the Hub CDN — sets `TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX`
 * (e.g. `mirror.gcr.io/`) and Testcontainers rewrites every unqualified name,
 * including Ryuk's, on the way to the daemon. That is a property of the
 * environment rather than of the suite, so it belongs in an environment
 * variable and not in this table.
 */

/** The three stores this directory starts. */
export const STORE_NAMES = ['postgres', 'redis', 'kafka'] as const

export type StoreName = (typeof STORE_NAMES)[number]

export interface ImagePin {
  /** The image, exactly as it is passed to the container module. */
  readonly image: string
  /** Why this image and this tag, so a bump is a decision and not a reflex. */
  readonly why: string
}

/**
 * The pinned image per store.
 *
 * The Kafka pin is the one with a constraint behind it rather than a
 * preference: `@testcontainers/kafka` is written against Confluent Platform
 * images — it configures the broker through `KAFKA_*` environment variables,
 * replaces the entrypoint with a starter script and calls
 * `/etc/confluent/docker/run` — so `apache/kafka`, which is a third of the
 * size, is not a drop-in for it. The module also selects KRaft automatically
 * for tags `>= 8.0.0` and embedded ZooKeeper below that, so 8.0.0 is the
 * cheapest tag that starts one process instead of two.
 */
export const IMAGES: Readonly<Record<StoreName, ImagePin>> = {
  postgres: {
    image: 'postgres:17-alpine',
    why: 'The current major, on the alpine variant: 424MB against 662MB for the Debian one, and the entrypoint that decides readiness is the same shell script in both.',
  },
  redis: {
    image: 'redis:7.4-alpine',
    why: 'Pinned to a minor rather than to `7`, because the log line the wait strategy matches ("Ready to accept connections") is a property of a build, not of a major.',
  },
  kafka: {
    image: 'confluentinc/cp-kafka:8.0.0',
    why: '`@testcontainers/kafka` drives Confluent Platform images specifically, and 8.0.0 is the floor at which the module selects KRaft instead of starting an embedded ZooKeeper alongside the broker.',
  },
}

/** The image for a store. The only way to name one. */
export function imageFor(store: StoreName): string {
  return IMAGES[store].image
}

/**
 * Tags this table refuses, and the reason each is refused.
 *
 * `latest` is the obvious one. A bare major (`postgres:17`) is the one people
 * argue about: it is stable in the sense that matters for an application and
 * not in the sense that matters for a *test*, because the thing a suite here
 * depends on is not the SQL dialect — it is the entrypoint's startup sequence,
 * the log lines a wait strategy matches, and whether the image ships a
 * `HEALTHCHECK`. All three have moved inside a major.
 */
export const TAG_RULES = {
  noLatest: /(^|:)latest$/,
  /** A tag that is digits only, i.e. a major with nothing after it. */
  noBareMajor: /^\d+$/,
} as const

/** The tag part of an image reference, or `null` when it carries none. */
export function tagOf(image: string): string | null {
  const slash = image.lastIndexOf('/')
  const colon = image.lastIndexOf(':')

  return colon > slash ? image.slice(colon + 1) : null
}
