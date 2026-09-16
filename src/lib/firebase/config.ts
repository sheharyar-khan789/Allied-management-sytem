import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, Firestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, FirebaseStorage, connectStorageEmulator } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider, AppCheck } from "firebase/app-check";

// In production these NEXT_PUBLIC_FIREBASE_* values are inlined into the client bundle at
// build time — there is no "runtime" moment where they could be supplied later. Previously,
// every field silently fell back to a fake, hardcoded "allied-school-system" project if its
// env var was missing, which meant a deployment that forgot even one of these variables would
// still build and deploy successfully, then silently point every browser's Firebase Auth /
// Firestore client at a project that doesn't belong to this school (or, worse, one that
// happens to exist and is controlled by someone else) — failing silently and confusingly at
// runtime instead of loudly at build time. This mirrors the identical fail-fast convention
// already used server-side for the Admin SDK (see assertProductionDbReady in server-db.ts).
// Local development keeps the placeholder fallback so a fresh clone still runs before Firebase
// is configured.
const clientEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (process.env.NODE_ENV === "production") {
  const missing = Object.entries(clientEnv)
    .filter(([, val]) => !val)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Critical: Firebase client is not configured for production. Missing environment ` +
        `variable(s): ${missing.join(", ")}. Set these (see .env.example) instead of letting ` +
        `the app fall back to a placeholder Firebase project.`
    );
  }
}

const firebaseConfig = {
  apiKey: clientEnv.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDummyApiKeyForLocalDevAndTest123456",
  authDomain: clientEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "allied-school-system.firebaseapp.com",
  projectId: clientEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "allied-school-system",
  storageBucket: clientEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "allied-school-system.appspot.com",
  messagingSenderId: clientEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "102938475612",
  appId: clientEnv.NEXT_PUBLIC_FIREBASE_APP_ID || "1:102938475612:web:a1b2c3d4e5f6g7h8",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-ALLIEDSCH01"
};

// Initialize Firebase Client App Singleton
const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);

// Optional Firebase App Check Initialization
let appCheck: AppCheck | null = null;
if (typeof window !== "undefined") {
  const recaptchaKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_KEY;
  if (recaptchaKey && recaptchaKey !== "none") {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn("Firebase App Check initialization skipped:", e);
    }
  }
}

export { app, auth, db, storage, appCheck, firebaseConfig };
