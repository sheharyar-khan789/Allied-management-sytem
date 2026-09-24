"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail as fbResetPassword,
  updatePassword as fbUpdatePassword,
  onAuthStateChanged
} from "firebase/auth";
import { auth, db } from "./config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { UserProfile, UserRole } from "./types";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole | null;
  schoolId: string | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<UserProfile>;
  signup: (fullName: string, email: string, pass: string, schoolName: string, registrationSecret?: string) => Promise<void>;
  logout: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changePassword: (newPass: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();

  // Sync auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const snap = await getDoc(userDocRef);
          if (snap.exists()) {
            const prof = snap.data() as UserProfile;
            setProfile(prof);
            // Client state managed in AuthContext; server session managed via allied_session HttpOnly cookie
            document.cookie = "session_user=; path=/; max-age=0";
          } else {
            setProfile(null);
          }
        } catch (e) {
          console.error("Error fetching user profile:", e);
          setProfile(null);
        }
      } else {
        setProfile(null);
        document.cookie = "session_user=; path=/; max-age=0";
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, pass: string): Promise<UserProfile> => {
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    const uid = userCredential.user.uid;
    const userDocRef = doc(db, "users", uid);
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) {
      throw new Error("User profile not found in Firestore.");
    }
    const prof = snap.data() as UserProfile;
    setProfile(prof);
    document.cookie = "session_user=; path=/; max-age=0";
    return prof;
  };

  const signup = async (
    fullName: string,
    email: string,
    pass: string,
    schoolName: string,
    registrationSecret?: string
  ): Promise<void> => {
    // 1. Create Firebase Auth user on client
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const idToken = await cred.user.getIdToken();

    // 2. Call server-side atomic registration endpoint (eliminates Firestore rules race conditions)
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName,
        email,
        password: pass,
        schoolName,
        idToken,
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

  useEffect(() => {
    if (!profile && !user) return;

    const IDLE_MS = 5 * 60 * 1000;
    const REFRESH_MS = 4 * 60 * 1000;
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
        void fetch("/api/auth/me", { credentials: "same-origin" });
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
  }, [profile, user, logout]);

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
