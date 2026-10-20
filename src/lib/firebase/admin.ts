import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import type { App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Storage } from "firebase-admin/storage";

let adminApp: App;

if (getApps().length === 0) {
  const resolvedProjectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  // Same fail-fast rationale as the client Firebase config (src/lib/firebase/config.ts): a
  // hardcoded "allied-school-system" fallback here would let a production deployment that
  // forgot FIREBASE_PROJECT_ID silently initialize the Admin SDK against a project that isn't
  // its own — including cases where real FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY credentials
  // are present but paired with the wrong project id. Local development keeps the placeholder
  // so a fresh clone still runs before Firebase is configured.
  if (process.env.NODE_ENV === "production" && !resolvedProjectId) {
    throw new Error(
      "Critical: Firebase Admin SDK is not configured for production. Set FIREBASE_PROJECT_ID " +
        "(see .env.example) instead of letting the app fall back to a placeholder project."
    );
  }
  const projectId = resolvedProjectId || "allied-school-system";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  if (clientEmail && privateKey) {
    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  } else {
    adminApp = initializeApp({
      projectId,
    });
  }
} else {
  adminApp = getApp();
}

export const hasAdminCredentials =
  (!!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY) ||
  !!process.env.FIRESTORE_EMULATOR_HOST ||
  !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
export const adminStorage: Storage = getStorage(adminApp);

/**
 * The Cloud Storage bucket uploads go to: FIREBASE_STORAGE_BUCKET, else the client's
 * NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (the same value the Firebase console shows as
 * "storageBucket"). Empty when neither is set — the name is never guessed from the project id,
 * because a guessed name points at a bucket that may not exist (or not belong to this project)
 * and turns a configuration gap into a confusing runtime failure. src/lib/storage.ts reports an
 * empty name as "storage not configured".
 */
export const storageBucketName = (process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "")
  .trim()
  .replace(/^gs:\/\//, "")
  .replace(/\/+$/, "");

export const adminBucket = storageBucketName ? adminStorage.bucket(storageBucketName) : null;

try {
  adminDb.settings({ ignoreUndefinedProperties: true });
} catch {
  // settings already frozen or applied
}
export { adminApp };
