# Completion report — exams, accounts and permissions work

Branch: `claude/affectionate-volta-547myj`. Everything below was checked with the repository's own
commands against the **in-memory store** (no Firebase project was reachable). Items that need a real
Firebase project are listed under "Verify on staging".

## Commands run (all passed)
| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | no errors (pre-existing `<img>` / hook-dependency warnings only) |
| `npm test` (8 suites) | all pass: 30, 84, 86, 134, 25, 75, 145, 44, 48 tests, 0 failures |
| `npm run build` | passes (with placeholder `FIREBASE_*` / `NEXT_PUBLIC_FIREBASE_*` env values) |
| `npm run test:rules` | **not run** — needs the Firebase emulator |

## Per phase
| Phase | State | Where / evidence |
|---|---|---|
| 1 Exam documents, schedules | Done | `src/lib/storage.ts`, `src/app/api/upload/route.ts`, `src/app/api/exams/route.ts`. Bucket-missing is now reported as "storage not set up" (HTTP 503) instead of a generic failure; replacing/clearing/deleting cleans up the old file only inside the caller's own school folder. `scripts/exams-results-observations-test.ts` |
| 2 Marks persistence | Done | Unsaved marks are "not recorded", never 0; blanks create no result; all-or-nothing save; server computes grade/percentage; re-grade on max change |
| 3 Categories + teacher permissions | Done | Six categories, admin toggles in Settings, enforced in `PUT /api/exams`; Final Term read-only by default |
| 4 Timetable | Already on `main` | `src/lib/timetable-import.ts` — parallel sections allowed; teacher, room and duplicate conflicts refused |
| 5 Observations | Done | `src/app/admin/observations/page.tsx`, `src/app/api/observations/route.ts` — filters, full text, edit history, delete |
| 6 Teacher ↔ student access | Done | `src/lib/student-teacher-access.ts`, `GET /api/students/[id]/teacher-access`, card on the student page |
| 7 Report cards, principal | Done | Head name from Settings only; "not configured" message otherwise |
| 8 Teacher delete / re-enrol | Already on `main` | `src/lib/teacher-lifecycle.ts` |
| 9 Student login IDs | Done | `src/lib/student-login-id.ts`, atomic `counters` collection, `PUT /api/students/[id]/login-email`, Settings section |
| 10 Password reset | Done | `POST /api/students/passwords`, roster checkboxes + `StudentBulkPasswordPanel`, per-student card |
| 11 Cross-module | Covered by the suites above | exam → schedule → teacher marks → publish → report card → principal name is exercised in the exams suite; enrolment/teacher access, timetable and teacher lifecycle in theirs. **No browser run.** |

## Decisions that differ from the brief
* **Login IDs are not `@gmail.com`.** They are `<prefix><campus><number>@<school domain>`. A generated Gmail address is not a mailbox the school controls (reset mail would go to strangers). Confirmed with the school owner.
* **`student@1` is opt-in only.** It needs an explicit confirmation, is stored only as a bcrypt hash, and the app cannot force a change at first login; the default is a unique random password per student.
* **Midterm** is a separate sixth category.

## Verify on staging (needs real Firebase)
1. Upload a PDF to an exam; refresh and sign in again; replace it; delete it. If you get "Document storage is not set up", enable Cloud Storage for the project or set `FIREBASE_STORAGE_BUCKET` to the real bucket name (`<project>.firebasestorage.app` or `<project>.appspot.com`).
2. Reset one student's password, then sign in with the new one and confirm the old one fails.
3. Change one student's login email; sign in with the new address; confirm marks/attendance still show.
4. Enrol two students quickly; confirm consecutive login IDs.
5. Run `npm run test:rules` where the Firebase emulator is installed.
