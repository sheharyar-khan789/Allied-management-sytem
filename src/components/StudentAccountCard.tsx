"use client";

import React, { useEffect, useState } from "react";

interface AccessEntry {
  teacherId: string;
  teacherName: string;
  employeeId?: string;
  reasons: { kind: "INCHARGE" | "SUBJECT" | "ASSIGNED_CLASS"; subjectName?: string }[];
}

const reasonLabel = (r: AccessEntry["reasons"][number]) =>
  r.kind === "INCHARGE" ? "Class incharge" : r.kind === "SUBJECT" ? `Teaches ${r.subjectName}` : "Granted class access";

/**
 * Admin-only account tools for one student: the sign-in address (change it safely), a password
 * reset (shown once, never stored), and which teachers' accounts can open this student.
 */
export default function StudentAccountCard({ studentId, loginEmail }: { studentId: string; loginEmail: string }) {
  const [email, setEmail] = useState(loginEmail || "");
  const [draft, setDraft] = useState(loginEmail || "");
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const [teachers, setTeachers] = useState<AccessEntry[] | null>(null);
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    fetch(`/api/students/${encodeURIComponent(studentId)}/teacher-access`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setTeachers(j.teachers || []) : setAccessError(j.error || "Could not load teacher access.")))
      .catch(() => setAccessError("Could not load teacher access."));
  }, [studentId]);

  const saveEmail = async () => {
    setSavingEmail(true);
    setEmailMsg(null);
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/login-email`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: draft }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailMsg({ ok: false, text: j.error || "Could not change the login email." });
      } else {
        setEmail(j.email);
        setDraft(j.email);
        setEmailMsg({ ok: true, text: j.unchanged ? "That is already the login email." : "Login email updated. The student must sign in again with it." });
      }
    } catch {
      setEmailMsg({ ok: false, text: "Could not change the login email." });
    } finally {
      setSavingEmail(false);
    }
  };

  const resetPassword = async () => {
    if (!window.confirm("Generate a new password for this student? Their current password stops working immediately.")) return;
    setResetting(true);
    setPwMsg(null);
    setNewPassword("");
    try {
      const res = await fetch("/api/students/passwords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: [studentId], mode: "random" }),
      });
      const j = await res.json().catch(() => ({}));
      const outcome = j.outcomes?.[0];
      if (res.ok && outcome?.status === "UPDATED") {
        setNewPassword(outcome.password || "");
        setPwMsg({
          ok: true,
          text:
            outcome.verified === false
              ? "Password changed, but the sign-in provider could not confirm it. Test the login before handing it over."
              : "Password changed. Copy it now — it is not stored and cannot be shown again.",
        });
      } else {
        setPwMsg({ ok: false, text: outcome?.reason || j.error || "The password was NOT changed." });
      }
    } catch {
      setPwMsg({ ok: false, text: "The password was NOT changed." });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-5 mt-6">
      <h3 className="font-headline-md text-sm font-bold text-on-surface border-b border-surface-container-low pb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary text-[18px]">manage_accounts</span>
        Login &amp; Access
      </h3>

      <div className="space-y-2 text-xs">
        <label htmlFor="student-login-email" className="block font-semibold text-on-surface">Login email</label>
        <div className="flex flex-wrap gap-2">
          <input id="student-login-email" type="email" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={254}
            className="flex-1 min-w-[16rem] h-9 px-3 rounded-lg bg-surface-container-low text-on-surface border border-outline-variant/40 font-mono" />
          <button type="button" onClick={saveEmail} disabled={savingEmail || !draft.trim() || draft.trim().toLowerCase() === email}
            className="px-4 h-9 rounded-lg bg-secondary text-on-secondary font-semibold disabled:opacity-50">
            {savingEmail ? "Saving..." : "Change"}
          </button>
        </div>
        <p className="text-[11px] text-on-surface-variant">Only the sign-in address changes; attendance, fees, marks and every other record stay linked to this student.</p>
        {emailMsg && <p className={`text-[11px] font-semibold ${emailMsg.ok ? "text-on-tertiary-container" : "text-error"}`}>{emailMsg.text}</p>}
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-on-surface">Password</span>
          <button type="button" onClick={resetPassword} disabled={resetting}
            className="px-4 h-9 rounded-lg bg-surface-container text-on-surface font-semibold hover:bg-surface-container-high disabled:opacity-50">
            {resetting ? "Resetting..." : "Reset password"}
          </button>
        </div>
        {newPassword && (
          <p className="p-2 rounded-lg bg-surface-container-low font-mono text-[12px] break-all select-all">{newPassword}</p>
        )}
        {pwMsg && <p className={`text-[11px] font-semibold ${pwMsg.ok ? "text-on-tertiary-container" : "text-error"}`}>{pwMsg.text}</p>}
      </div>

      <div className="space-y-2 text-xs">
        <span className="block font-semibold text-on-surface">Teachers who can open this student</span>
        {accessError ? (
          <p className="text-[11px] text-error">{accessError}</p>
        ) : teachers === null ? (
          <p className="text-[11px] text-on-surface-variant">Loading...</p>
        ) : teachers.length === 0 ? (
          <p className="text-[11px] text-on-surface-variant">No teacher is assigned to this student&apos;s class yet (incharge, subject teacher or granted access).</p>
        ) : (
          <ul className="divide-y divide-surface-container-low">
            {teachers.map((t) => (
              <li key={t.teacherId} className="py-1.5 flex flex-wrap justify-between gap-2">
                <span className="font-semibold text-on-surface">{t.teacherName}</span>
                <span className="text-on-surface-variant">{t.reasons.map(reasonLabel).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
