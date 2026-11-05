"use client";

import React, { useEffect, useMemo, useState } from "react";

/**
 * Subject-wise student allocation (Part 12): for a class with one or more optional/elective
 * subjects (flagged on the Classes & Subjects page), lets the Admin pick exactly which students
 * take each one — e.g. Biology for one Class 9 student, Computer for another, both staying
 * enrolled in the same class/section. Nothing here creates or moves students between classes;
 * it only sets StudentDoc.optionalSubjectIds, validated server-side in PUT /api/students/[id].
 */

interface Student {
  id: string;
  fullName: string;
  rollNumber: string;
  admissionNumber: string;
  status: string;
  optionalSubjectIds: string[];
}

interface OptionalSubject {
  id: string;
  name: string;
}

interface ClassRow {
  id: string;
  displayName: string;
  subjects: { id: string; name: string; isOptional: boolean }[];
}

export default function SubjectAllocationPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  // studentId -> set of optional subject ids currently checked in this view (seeded from the
  // server on load, edited locally, only written back on Save).
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [original, setOriginal] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    fetch("/api/classes")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setClasses(json.classes);
        else setError(json.error || "Could not load classes.");
      })
      .catch(() => setError("Could not load classes. Check your connection and try again."))
      .finally(() => setLoadingClasses(false));
  }, []);

  const classesWithOptionalSubjects = useMemo(
    () => classes.filter((c) => c.subjects?.some((s) => s.isOptional)),
    [classes]
  );
  const activeClass = classes.find((c) => c.id === selectedClassId);
  const optionalSubjects: OptionalSubject[] = useMemo(
    () => (activeClass?.subjects || []).filter((s) => s.isOptional).map((s) => ({ id: s.id, name: s.name })),
    [activeClass]
  );

  const loadStudents = (classId: string) => {
    if (!classId) return;
    setLoadingStudents(true);
    setError("");
    setNotice("");
    fetch(`/api/students?classId=${encodeURIComponent(classId)}&status=ACTIVE`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) {
          setError(json.error || "Could not load students for this class.");
          return;
        }
        const list: Student[] = json.students;
        setStudents(list);
        const seeded: Record<string, Set<string>> = {};
        for (const s of list) seeded[s.id] = new Set(s.optionalSubjectIds || []);
        setSelections(seeded);
        setOriginal(Object.fromEntries(Object.entries(seeded).map(([id, set]) => [id, new Set(set)])));
      })
      .catch(() => setError("Could not load students. Check your connection and try again."))
      .finally(() => setLoadingStudents(false));
  };

  useEffect(() => {
    if (selectedClassId) loadStudents(selectedClassId);
    else {
      setStudents([]);
      setSelections({});
      setOriginal({});
    }
  }, [selectedClassId]);

  const toggle = (studentId: string, subjectId: string) => {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[studentId] || []);
      if (set.has(subjectId)) set.delete(subjectId);
      else set.add(subjectId);
      next[studentId] = set;
      return next;
    });
    setNotice("");
  };

  const changedStudentIds = useMemo(
    () =>
      Object.keys(selections).filter((id) => {
        const a = Array.from(selections[id] || []).sort().join(",");
        const b = Array.from(original[id] || []).sort().join(",");
        return a !== b;
      }),
    [selections, original]
  );

  const handleSave = async () => {
    if (changedStudentIds.length === 0) return;
    setSaving(true);
    setError("");
    setNotice("");
    const results = await Promise.all(
      changedStudentIds.map(async (studentId) => {
        try {
          const res = await fetch(`/api/students/${studentId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ optionalSubjectIds: Array.from(selections[studentId] || []) }),
          });
          const json = await res.json().catch(() => ({}));
          return { studentId, ok: res.ok && json.success, error: json.error };
        } catch {
          return { studentId, ok: false, error: "Network error." };
        }
      })
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      const names = failed.map((f) => students.find((s) => s.id === f.studentId)?.fullName || f.studentId);
      setError(`Could not save allocation for: ${names.join(", ")}. ${failed[0].error || ""}`.trim());
    } else {
      setNotice(`Saved subject allocation for ${changedStudentIds.length} student${changedStudentIds.length === 1 ? "" : "s"}.`);
    }
    // Re-seed from the server regardless, so the view reflects what's actually stored.
    loadStudents(selectedClassId);
    setSaving(false);
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-surface">Subject Allocation</h1>
        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
          Assign optional/elective subjects (e.g. Biology, Computer) to individual students — compulsory subjects
          already include everyone in the class and need no allocation here. Mark a subject optional on the
          Classes &amp; Subjects page first.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/10 border border-error/30 text-error text-xs font-bold">{error}</div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-tertiary-container/10 border border-on-tertiary-container/30 text-on-tertiary-container text-xs font-bold">
          {notice}
        </div>
      )}

      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40">
        <label htmlFor="subject-alloc-class" className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">
          Class
        </label>
        {loadingClasses ? (
          <p className="text-xs text-on-surface-variant italic">Loading classes...</p>
        ) : classesWithOptionalSubjects.length === 0 ? (
          <p className="text-xs text-on-surface-variant italic">
            No class has an optional subject yet. Go to Classes &amp; Subjects and mark a subject (e.g. Biology or
            Computer) as optional to allocate it here.
          </p>
        ) : (
          <select
            id="subject-alloc-class"
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40"
          >
            <option value="">Select a class…</option>
            {classesWithOptionalSubjects.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        )}
      </div>

      {selectedClassId && (
        loadingStudents ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
            <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-on-surface-variant">Loading students...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="p-8 text-center text-xs text-on-surface-variant bg-surface-container-lowest rounded-xl">
            No active students enrolled in this class.
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="p-4 border-b border-surface-container-high/40 flex flex-wrap items-center justify-between gap-3 text-xs">
              <p className="text-on-surface-variant">
                Check each optional subject a student takes. {changedStudentIds.length} pending change
                {changedStudentIds.length === 1 ? "" : "s"}.
              </p>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || changedStudentIds.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : `Save ${changedStudentIds.length || ""} Change${changedStudentIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                    <th className="py-3 px-4 font-bold">Roll #</th>
                    <th className="py-3 px-4 font-bold">Student</th>
                    {optionalSubjects.map((s) => (
                      <th key={s.id} className="py-3 px-4 font-bold text-center">{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {students
                    .slice()
                    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }))
                    .map((st) => {
                      const isChanged = changedStudentIds.includes(st.id);
                      return (
                        <tr key={st.id} className={isChanged ? "bg-secondary/5" : "hover:bg-surface-container-low/40"}>
                          <td className="py-2 px-4 font-mono font-bold text-on-surface">{st.rollNumber}</td>
                          <td className="py-2 px-4 font-bold text-on-surface">{st.fullName}</td>
                          {optionalSubjects.map((s) => (
                            <td key={s.id} className="py-2 px-4 text-center">
                              <input
                                type="checkbox"
                                aria-label={`${st.fullName} takes ${s.name}`}
                                checked={selections[st.id]?.has(s.id) || false}
                                onChange={() => toggle(st.id, s.id)}
                                className="h-4 w-4"
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
