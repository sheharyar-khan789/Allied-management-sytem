/**
 * Changes the DISPLAY NAME of one existing administrator account — nothing else. UID, email,
 * password, role, school and permissions are left untouched, and no account is created.
 *
 * Reads Firebase Admin credentials from .env.local (values are never printed).
 *
 *   List administrators (read-only, default):
 *     npx tsx scripts/set-admin-display-name.ts
 *   Rename one administrator (writes to the configured Firebase project):
 *     npx tsx scripts/set-admin-display-name.ts --uid <uid> --name "Chaudhary Umar Rafique" --apply
 *
 * Without --apply the rename is only previewed. The new name shows in the admin sidebar and
 * dashboard within ~30 seconds (profile cache) and in the session after the next sign-in.
 */
import fs from "fs";
import path from "path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  const { adminDb, adminAuth, hasAdminCredentials } = await import("../src/lib/firebase/admin");
  if (!hasAdminCredentials) {
    console.error("No Firebase Admin credentials configured (.env.local). Nothing to do.");
    process.exit(1);
  }
  const uid = arg("uid");
  const name = (arg("name") || "").trim();
  const apply = process.argv.includes("--apply");

  if (!uid) {
    const snap = await adminDb.collection("users").where("role", "==", "ADMIN").get();
    console.log(`Administrator accounts: ${snap.size}`);
    for (const d of snap.docs) {
      const u = d.data();
      console.log(`- uid=${d.id}  name="${u.name || ""}"  email=${u.email || ""}  schoolId=${u.schoolId || ""}  status=${u.status || ""}`);
    }
    console.log('\nTo rename one: --uid <uid> --name "<new name>" --apply');
    return;
  }

  if (!name || name.length > 120) {
    console.error("--name is required (max 120 characters).");
    process.exit(1);
  }
  const ref = adminDb.collection("users").doc(uid);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error(`No user profile with uid ${uid}.`);
    process.exit(1);
  }
  const profile = doc.data() || {};
  if (profile.role !== "ADMIN") {
    console.error(`User ${uid} is not an administrator (role ${profile.role}); refusing to rename.`);
    process.exit(1);
  }
  console.log(`Account: uid=${uid} email=${profile.email} schoolId=${profile.schoolId}`);
  console.log(`Display name: "${profile.name || ""}" -> "${name}"`);
  if (!apply) {
    console.log("Preview only. Re-run with --apply to save.");
    return;
  }

  // Only the display-name field (plus updatedAt) is written.
  await ref.set({ name, updatedAt: new Date().toISOString() }, { merge: true });
  try {
    await adminAuth.updateUser(uid, { displayName: name });
    console.log("Firebase Authentication display name updated.");
  } catch (e: any) {
    if (e?.code === "auth/user-not-found") console.log("No Firebase Authentication account for this uid (profile updated only).");
    else throw e;
  }
  const after = (await ref.get()).data() || {};
  console.log(`Saved. Stored name is now "${after.name}" (email ${after.email}, role ${after.role} unchanged).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Failed:", e?.message || e);
    process.exit(1);
  });
