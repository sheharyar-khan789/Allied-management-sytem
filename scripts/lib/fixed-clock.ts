/**
 * Deterministic clock for test suites: from the moment it is installed, `new Date()` and
 * `Date.now()` report `startISO` plus however much real time has elapsed since. Time still
 * advances normally (ordering, TTLs and timestamps behave as in production); only the starting
 * instant is fixed, so date-dependent rules can be tested on any day of the week.
 *
 * Application code is untouched — it keeps reading the (now pinned) server clock exactly as it
 * does in production.
 */
export function installFixedClock(startISO: string): () => void {
  const RealDate = Date;
  const start = RealDate.parse(startISO);
  if (Number.isNaN(start)) throw new Error(`installFixedClock: invalid instant ${startISO}`);
  const offset = start - RealDate.now();

  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [string | number | Date]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = PinnedDate as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}
