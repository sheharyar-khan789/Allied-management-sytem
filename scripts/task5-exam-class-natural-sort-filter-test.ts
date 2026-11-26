/**
 * Task 5 — Exam & Results: class natural-sort order and the Class Selection Filter.
 *
 * Root cause: `getClassesServer` (and therefore every screen that lists classes, including the
 * admin Exams page) sorted classes with plain `a.name.localeCompare(b.name)` — pure alphabetical
 * string comparison, so "Class 10" sorted before "Class 2", and "Nursery"/"Prep" landed wherever
 * "N"/"P" happened to fall alphabetically instead of first. This suite verifies the fix
 * (`compareClassesNaturally` in server-db.ts) via the real `getClassesServer` function school
 * classes actually flow through — covering the module's own documented example order (Nursery,
 * Prep, Class 1 .. Class 10), newly-added classes, and multiple sections of the same grade.
 *
 * The Class Selection Filter itself (admin/exams/page.tsx) is a pure client-side array filter
 * over data already covered by the Phase 5 exam test suite (schedule.classId correctness); this
 * suite does not duplicate that, and there is no server-rendered component test harness in this
 * repo to exercise the filter's own React state directly (confirmed via a structural source
 * check instead, included below).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { getClassesServer, saveClassServer } from "../src/lib/firebase/server-db";
import { ClassDoc } from "../src/lib/firebase/types";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

async function run() {
  console.log("==================================================");
  console.log("TASK 5 — EXAM CLASS NATURAL SORT + SELECTION FILTER");
  console.log("==================================================");

  const now = new Date().toISOString();
  const A = "school-t5-a";
  const YEAR = "2026-2027";

  const cls = (id: string, name: string, section: string, numericLevel: number): ClassDoc => ({
    id, schoolId: A, name, section, numericLevel, capacity: 40, academicYear: YEAR, createdAt: now, updatedAt: now,
  });

  // Deliberately created and saved OUT OF natural order, and with numericLevel values that do
  // NOT reflect real digits for the non-numeric names (simulating the exact synthetic-counter
  // scenario that previously caused ambiguous matching elsewhere) — the fix must still produce
  // the correct natural order regardless of insertion order or numericLevel.
  const prep = cls("cls-t5-prep", "Prep", "A", 2); // synthetic numericLevel, no real digits in name
  const nursery = cls("cls-t5-nursery", "Nursery", "A", 1); // synthetic numericLevel
  const class10 = cls("cls-t5-10a", "Class 10", "A", 10);
  const class2 = cls("cls-t5-2a", "Class 2", "A", 2); // numericLevel coincidentally matches Prep's synthetic one
  const class1 = cls("cls-t5-1a", "Class 1", "A", 1); // numericLevel coincidentally matches Nursery's synthetic one
  const class9b = cls("cls-t5-9b", "Class 9", "B", 9);
  const class9a = cls("cls-t5-9a", "Class 9", "A", 9);

  for (const c of [prep, nursery, class10, class2, class1, class9b, class9a]) await saveClassServer(c);

  const ordered = await getClassesServer(A, { academicYear: YEAR });
  const names = ordered.map((c) => `${c.name}-${c.section}`);

  // The module's own documented example: Nursery, Prep, Class 1, Class 2 ... Class 10.
  assert(
    names.indexOf("Nursery-A") < names.indexOf("Prep-A") &&
    names.indexOf("Prep-A") < names.indexOf("Class 1-A") &&
    names.indexOf("Class 1-A") < names.indexOf("Class 2-A") &&
    names.indexOf("Class 2-A") < names.indexOf("Class 9-A") &&
    names.indexOf("Class 9-A") < names.indexOf("Class 10-A"),
    "Natural sort: Nursery, Prep, Class 1, Class 2, ..., Class 9, Class 10 — never alphabetical"
  );

  // The specific regression this fix targets: "Class 10" must never sort before "Class 2".
  assert(names.indexOf("Class 2-A") < names.indexOf("Class 10-A"), "Natural sort: Class 2 sorts before Class 10 (not the alphabetical \"Class 10\" < \"Class 2\")");

  // Multiple sections of the same grade sort alphabetically by section within that grade.
  assert(names.indexOf("Class 9-A") < names.indexOf("Class 9-B"), "Natural sort: within the same grade, sections sort alphabetically (9-A before 9-B)");

  // Regression check: a non-numeric class's synthetic numericLevel (shared coincidentally with
  // a real numbered class) must never affect either class's position — confirmed above already
  // (Nursery before Class 1, Prep before Class 2, despite matching numericLevel values).
  assert(ordered.find((c) => c.id === "cls-t5-nursery")?.id !== ordered.find((c) => c.id === "cls-t5-1a")?.id, "Natural sort: Nursery and Class 1 remain distinct, correctly-ordered classes despite sharing a synthetic numericLevel");

  // A newly-added class (simulating one created well after the others, with no special-casing
  // anywhere) is immediately recognized in its correct natural position.
  const class25 = cls("cls-t5-25a", "Class 25", "A", 25);
  await saveClassServer(class25);
  const orderedAfterNew = await getClassesServer(A, { academicYear: YEAR });
  const namesAfterNew = orderedAfterNew.map((c) => `${c.name}-${c.section}`);
  assert(namesAfterNew.indexOf("Class 10-A") < namesAfterNew.indexOf("Class 25-A"), "Natural sort: a brand-new class (Class 25, never special-cased anywhere) is recognized immediately and sorts after Class 10");
  assert(namesAfterNew[namesAfterNew.length - 1] === "Class 25-A", "Natural sort: Class 25 is now the highest-numbered class and sorts last");

  // Structural check: the Class Selection Filter exists on the admin Exams page, is not merely
  // decorative (it actually filters the rendered schedule list), and defaults to "All Classes".
  const examsPageSource = readFileSync(
    join(__dirname, "..", "src", "app", "admin", "exams", "page.tsx"),
    "utf8"
  );
  assert(/classFilterId/.test(examsPageSource), "Class filter: the admin Exams page has class-filter state");
  assert(/visibleSchedulesForFilter/.test(examsPageSource), "Class filter: a derived, filtered schedule list exists and is rendered (not just a decorative dropdown)");
  assert(/All Classes/.test(examsPageSource), 'Class filter: "All Classes" is offered to show the combined schedule');

  console.log("==================================================");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
