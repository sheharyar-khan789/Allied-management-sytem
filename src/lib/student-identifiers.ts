import { StudentDoc } from "@/lib/firebase/types";
import {
  allocateSeededCounterBlockServer,
  getStudentByAdmissionNoServer,
  getStudentsServer,
  raiseCounterToAtLeastServer,
} from "@/lib/firebase/server-db";

/**
 * Student admission numbers (STD-YYYY-NNN): one school-wide sequence across every session, drawn
 * from an atomic counter (`counters/{schoolId}__admissionNo`, same `{ next }` format as the login-ID
 * counter) so concurrent enrollments/imports can never be handed the same number.
 *
 * Before this, the next number was "highest issued + 1" from a full roster read on every
 * enrollment: two simultaneous enrollments got the same number, and every enrollment cost one
 * Firestore read per student in the school. The roster is now read once per school, when the
 * counter is first created, so it continues from the numbers already issued.
 */

export const admissionCounterKey = (schoolId: string) => `${schoolId}__admissionNo`;
const ADMISSION_RE = /^STD-\d{4}-(\d+)$/;

export function admissionSequenceOf(admissionNo: string | undefined | null): number {
  const m = ADMISSION_RE.exec(admissionNo || "");
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function formatAdmissionNo(year: number, sequence: number): string {
  return `STD-${year}-${sequence.toString().padStart(3, "0")}`;
}

export function highestAdmissionSequence(students: Pick<StudentDoc, "admissionNo">[]): number {
  return students.reduce((max, st) => Math.max(max, admissionSequenceOf(st.admissionNo)), 0);
}

/** First value for a new counter: one past the highest number issued in any session. */
async function rosterSeed(schoolId: string, roster?: Pick<StudentDoc, "admissionNo">[]): Promise<number> {
  const all = roster ?? (await getStudentsServer(schoolId, undefined, undefined, undefined, undefined, { allSessions: true }));
  return highestAdmissionSequence(all) + 1;
}

/**
 * Reserves `count` admission numbers. Numbers already in use (typed in by hand, kept from an
 * import, or issued by an older server during a rollout) are skipped — checked against
 * `alsoTaken` and, unless the caller passes the complete roster there (`roster`), one exact
 * database lookup each.
 */
export async function allocateAdmissionNumbers(
  schoolId: string,
  count: number,
  options: { year?: number; alsoTaken?: Set<string>; roster?: Pick<StudentDoc, "admissionNo">[] } = {}
): Promise<string[]> {
  const year = options.year ?? new Date().getFullYear();
  const taken = options.alsoTaken ?? new Set<string>();
  const out: string[] = [];
  for (let attempt = 0; out.length < count; attempt++) {
    if (attempt >= 20) throw new Error("Could not allocate free admission numbers.");
    const need = count - out.length;
    const start = await allocateSeededCounterBlockServer(admissionCounterKey(schoolId), need, () => rosterSeed(schoolId, options.roster));
    for (let seq = start; seq < start + need; seq++) {
      const candidate = formatAdmissionNo(year, seq);
      if (taken.has(candidate.toLowerCase())) continue;
      if (!options.roster && (await getStudentByAdmissionNoServer(schoolId, candidate))) continue;
      taken.add(candidate.toLowerCase());
      out.push(candidate);
    }
  }
  return out;
}

/**
 * After keeping manually given numbers (import), make sure the counter will never reissue them.
 * The counter is initialised from the roster first, so raising it can never skip that seeding.
 */
export async function reserveGivenAdmissionNumbers(
  schoolId: string,
  given: string[],
  roster?: Pick<StudentDoc, "admissionNo">[]
): Promise<void> {
  const highest = given.reduce((max, no) => Math.max(max, admissionSequenceOf(no)), 0);
  if (highest <= 0) return;
  await allocateSeededCounterBlockServer(admissionCounterKey(schoolId), 0, () => rosterSeed(schoolId, roster));
  await raiseCounterToAtLeastServer(admissionCounterKey(schoolId), highest + 1);
}
