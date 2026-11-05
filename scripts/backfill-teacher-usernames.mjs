// Safe backfill of login usernames for EXISTING teachers who have none.
//
//   node scripts/backfill-teacher-usernames.mjs [--school <schoolId>] [--out report.json]
//       DRY RUN (default). Reads only. Writes a report of the usernames it WOULD assign and changes
//       nothing in Firebase.
//
//   node scripts/backfill-teacher-usernames.mjs --apply --report report.json
//       Applies a report that a person has approved: open the report file, review/edit the
//       proposed usernames and set  "approved": true  at the top. Without that flag nothing runs.
//
// What it touches: users/{uid}.username, teachers/{id}.username and the usernames/{username} lock
// (created only if absent). It never changes an e-mail, a uid, a password, a Firebase Auth account
// or a session, and never forces a password change. Every proposed username is re-validated and
// re-checked for uniqueness at apply time, so a stale report cannot create a duplicate.
//
// Requires the same Firebase credentials as the app (.env.local in the project folder).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const appDir = process.cwd();
const require = createRequire(path.join(appDir, "package.json"));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const env = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const app = initializeApp({
  credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }),
  projectId: env.FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);

// Same policy as src/lib/username.ts (keep in sync).
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9]|[._-](?=[a-z0-9]))*$/;
const RESERVED = new Set(["admin", "administrator", "root", "system", "support", "teacher", "student", "parent", "principal", "null", "undefined", "api", "login", "logout", "test"]);
const validUsername = (u) => typeof u === "string" && u.length >= 3 && u.length <= 30 && !u.includes("@") && USERNAME_RE.test(u) && !RESERVED.has(u);

function candidates(teacher) {
  const local = String(teacher.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9._-]+/g, ".").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/([._-])[._-]+/g, "$1");
  const parts = String(teacher.fullName || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const fromName = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || "teacher";
  return [local, fromName].map((c) => c.slice(0, 26)).filter((c) => c.length >= 3);
}

if (flag("--apply")) {
  const reportPath = opt("--report");
  if (!reportPath) { console.error("--apply needs --report <approved report file>."); process.exit(2); }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.approved !== true) { console.error('Refusing to apply: the report is not approved. Review it, then set "approved": true.'); process.exit(2); }
  let applied = 0, skipped = 0;
  for (const e of report.assignments) {
    const username = String(e.proposedUsername || "").trim().toLowerCase();
    if (!validUsername(username)) { console.log(`SKIP ${e.teacherId}: "${username}" is not a valid username.`); skipped++; continue; }
    const teacherRef = db.collection("teachers").doc(e.teacherId);
    const userRef = db.collection("users").doc(e.uid);
    const lockRef = db.collection("usernames").doc(username);
    try {
      await db.runTransaction(async (tx) => {
        const [t, u, lock] = await Promise.all([tx.get(teacherRef), tx.get(userRef), tx.get(lockRef)]);
        if (!t.exists || !u.exists) throw new Error("teacher or login no longer exists");
        if (t.data().schoolId !== e.schoolId || u.data().schoolId !== e.schoolId || u.data().role !== "TEACHER") throw new Error("school/role mismatch");
        if (u.data().username || t.data().username) throw new Error("already has a username");
        if (lock.exists) throw new Error("username already taken");
        tx.create(lockRef, { id: username, username, uid: e.uid, schoolId: e.schoolId, teacherId: e.teacherId, createdAt: new Date().toISOString() });
        tx.set(userRef, { username }, { merge: true });
        tx.set(teacherRef, { username }, { merge: true });
      });
      console.log(`OK   ${e.teacherId}: ${username}`);
      applied++;
    } catch (err) {
      console.log(`SKIP ${e.teacherId} (${username}): ${err.message}`);
      skipped++;
    }
  }
  console.log(`\nApplied ${applied}, skipped ${skipped}.`);
  process.exit(0);
}

// ---- dry run ----
const school = opt("--school");
const out = opt("--out") || `teacher-username-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
let q = db.collection("teachers");
if (school) q = q.where("schoolId", "==", school);
const teachers = (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const taken = new Set((await db.collection("usernames").get()).docs.map((d) => d.id));
const assignments = [];
const problems = [];
for (const t of teachers) {
  if (t.username) continue;
  if (!t.userId) { problems.push({ teacherId: t.id, name: t.fullName, reason: "no login account (userId) — nothing to attach a username to" }); continue; }
  const userSnap = await db.collection("users").doc(t.userId).get();
  if (!userSnap.exists) { problems.push({ teacherId: t.id, name: t.fullName, reason: "login profile missing" }); continue; }
  if (userSnap.data().username) continue;
  let pick = null;
  for (const base of candidates(t)) {
    for (let n = 0; n < 200 && !pick; n++) {
      const c = n === 0 ? base : `${base}${n + 1}`.slice(0, 30);
      if (validUsername(c) && !taken.has(c)) pick = c;
    }
    if (pick) break;
  }
  if (!pick) { problems.push({ teacherId: t.id, name: t.fullName, reason: "no valid unique username could be proposed" }); continue; }
  taken.add(pick);
  assignments.push({ teacherId: t.id, uid: t.userId, schoolId: t.schoolId, name: t.fullName, email: t.email, status: t.status, proposedUsername: pick });
}
const report = {
  approved: false,
  note: 'DRY RUN. Nothing was changed. Review "assignments" (edit any proposedUsername), then set "approved": true and run with --apply --report <this file>.',
  generatedAt: new Date().toISOString(),
  scope: school || "all schools",
  totals: { teachers: teachers.length, alreadyHaveUsername: teachers.filter((t) => t.username).length, toAssign: assignments.length, problems: problems.length },
  assignments,
  problems,
};
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.totals));
console.log(`Report written to ${out} (not approved; nothing changed).`);
process.exit(0);
