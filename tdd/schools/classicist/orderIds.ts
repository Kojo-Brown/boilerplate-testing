/**
 * Order numbers.
 *
 * A real implementation, not a port, and that is the point of it being in this
 * folder at all: the classicist tests use this class, the same one the
 * composition root would use in production. Its output is deterministic
 * without anybody having to stub it — `ORD-1`, `ORD-2` — so the tests get
 * predictable ids and still exercise the code that will really run.
 *
 * Per-instance counters are enough for a single process. A real shop would put
 * a persistent sequence behind this, which is the moment it would earn an
 * interface — and not before.
 */

export class SequentialOrderIds {
  private issued = 0

  constructor(private readonly prefix: string = 'ORD') {}

  next(): string {
    this.issued += 1
    return `${this.prefix}-${this.issued}`
  }
}
