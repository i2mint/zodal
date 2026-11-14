/**
 * Conditional writes (zodal#118): read an item with an opaque version, and update or delete it
 * only if nobody wrote it since. `update` is last-write-wins, which a record several clients
 * write cannot accept (a lock racing an update ends with the lock gone).
 *
 * The version is opaque (`string | number`), so an HTTP `ETag`, a database `version` column or
 * an in-memory counter all fit. A provider that implements the three methods reports
 * `capabilities.versioned: true`.
 */

/** An opaque version: compared only for equality. */
export type Version = string | number;

/** An item with the version it was read at. */
export interface Versioned<T> {
  item: T;
  version: Version;
}

/** A conditional write lost: the item changed (or vanished) since `expected` was read. */
export class WriteConflict extends Error {
  constructor(
    readonly id: string,
    readonly expected: Version,
    /** The current version, or `undefined` when the item no longer exists. */
    readonly actual: Version | undefined,
  ) {
    super(
      actual === undefined
        ? `Write conflict on ${JSON.stringify(id)}: it was deleted since version ${JSON.stringify(expected)} was read`
        : `Write conflict on ${JSON.stringify(id)}: expected version ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
    this.name = 'WriteConflict';
  }
}

/** Whether an error is a {@link WriteConflict} (also across package copies, by name). */
export function isWriteConflict(error: unknown): error is WriteConflict {
  return error instanceof WriteConflict || (error as { name?: unknown } | null)?.name === 'WriteConflict';
}
