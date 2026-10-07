"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  User,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail as fbResetPassword,
  updatePassword as fbUpdatePassword,
  onAuthStateChanged
} from "firebase/auth";
import { auth } from "./config";
import { UserProfile, UserRole } from "./types";
import { usePathname, useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole | null;
  schoolId: string | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  signup: (fullName: string, email: string, pass: string, schoolName: string, registrationSecret?: string) => Promise<void>;
  logout: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (newPass: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * The signed-in profile, sanitised by the server (no password hash, 2FA secret or revocation
 * state). Profiles are never read from Firestore in the browser: the rules deny it, because a
 * profile holds the admin's TOTP secret.
 */
async function fetchServerProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.user as UserProfile) || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();
  const pathname = usePathname();
  const onPortalPage = /^\/(admin|teacher|student|parent|print)(\/|$)/.test(pathname || "");

  // Sync auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Client state managed in AuthContext; server session managed via allied_session HttpOnly cookie
        setProfile(await fetchServerProfile());
        document.cookie = "session_user=; path=/; max-age=0";
      } else {
        setProfile(null);
        document.cookie = "session_user=; path=/; max-age=0";
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Firebase client sign-in only; the caller then exchanges the ID token for the server session
  // at /api/auth/login, which loads the profile and enforces 2FA.
  const login = async (email: string, pass: string): Promise<void> => {
    await signInWithEmailAndPassword(auth, email, pass);
    document.cookie = "session_user=; path=/; max-age=0";
  };

  const signup = async (
    fullName: string,
    email: string,
    pass: string,
    schoolName: string,
    registrationSecret?: string
  ): Promise<void> => {
    // The server creates the Firebase Auth account (Admin SDK) together with the school and
    // profile. Creating it here in the browser required Firebase's public self-sign-up to stay
    // enabled for the whole project, which lets anyone with the public web API key create
    // accounts; with server-side creation it can be turned off in the Firebase console.
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName,
        email,
        password: pass,
        schoolName,
        registrationSecret,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "School registration failed.");
    }

    setProfile(data.user);
    document.cookie = "session_user=; path=/; max-age=0";
  };

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    await fbSignOut(auth);
    setUser(null);
    setProfile(null);
    document.cookie = "session_user=; path=/; max-age=0";
    router.push("/login");
  }, [router]);

  const sendPasswordReset = async (email: string): Promise<void> => {
    await fbResetPassword(auth, email);
  };

  const changePassword = async (newPass: string): Promise<void> => {
    if (!auth.currentUser) throw new Error("No authenticated user.");
    await fbUpdatePassword(auth.currentUser, newPass);
  };

  // Keeps the server session (allied_session cookie, 5-minute idle timeout) alive while the
  // user is active, and signs out after 5 idle minutes. This used to run only when the Firebase
  // *client* SDK had a signed-in user — but the server session is established by
  // /api/auth/login and works without one (the login page explicitly falls back to it), so for
  // those sessions nothing ever refreshed the cookie and the next save after 5 minutes on one
  // page failed with 401. It now runs on every portal page.
  useEffect(() => {
    if (!onPortalPage) return;

    const IDLE_MS = 5 * 60 * 1000;
    const REFRESH_MS = 2 * 60 * 1000;
    let lastActivity = Date.now();
    let lastRefresh = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let signedOut = false;

    const idleLogout = () => {
      if (signedOut) return;
      signedOut = true;
      void logout();
    };

    const onActivity = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastActivity >= IDLE_MS) {
        idleLogout();
        return;
      }
      lastActivity = now;
      clearTimeout(timer);
      timer = setTimeout(idleLogout, IDLE_MS);
      if (now - lastRefresh >= REFRESH_MS) {
        lastRefresh = now;
        fetch("/api/auth/me", { credentials: "same-origin" })
          .then((res) => {
            if (res.status === 401) idleLogout();
          })
          .catch(() => {
            // Network blip: the next activity retries.
          });
      }
    };

    const events: Array<keyof WindowEventMap> = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    events.forEach((eventName) => window.addEventListener(eventName, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onActivity);
    onActivity();

    return () => {
      clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, onActivity));
      document.removeEventListener("visibilitychange", onActivity);
    };
  }, [onPortalPage, logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role: profile?.role || null,
        schoolId: profile?.schoolId || null,
        loading,
        login,
        signup,
        logout,
        sendPasswordReset,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
