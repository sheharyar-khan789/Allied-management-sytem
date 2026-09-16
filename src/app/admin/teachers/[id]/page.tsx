"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";

export default function TeacherProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [teacher, setTeacher] = useState<any>(null);
  const [availableClasses, setAvailableClasses] = useState<any[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessSaved, setAccessSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/teachers/${id}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Faculty profile could not be loaded.");
        }
        return json;
      })
      .then((json) => {
        setTeacher(json.teacher);
        setAvailableClasses(json.availableClasses || []);
        setSelectedClassIds(json.teacher?.assignedClassIds || []);
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const toggleClass = (classId: string) => {
    setAccessSaved(false);
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((c) => c !== classId) : [...prev, classId]
    );
  };

  const saveClassAccess = async () => {
    setAccessError("");
    setAccessSaved(false);
    setSavingAccess(true);
    try {
      const res = await fetch(`/api/teachers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedClassIds: selectedClassIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update class access.");
      }
      setTeacher((prev: any) => ({ ...prev, assignedClassIds: selectedClassIds }));
      setAccessSaved(true);
    } catch (err: any) {
      setAccessError(err.message);
    } finally {
      setSavingAccess(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-secondary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-on-surface-variant">Loading teacher profile...</p>
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-error">
          {loadError || "Faculty profile not found"}
        </p>
        <Link href="/admin/teachers" className="text-xs text-secondary hover:underline">
          ← Back to Teachers Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Teacher Profile Banner */}
      <div className="p-6 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-primary text-white flex items-center justify-center font-headline-lg text-2xl font-bold shadow-md">
            {teacher.firstName.charAt(0)}
            {teacher.lastName.charAt(0)}
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
                {teacher.firstName} {teacher.lastName}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold font-mono">
                {teacher.employeeId}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-tertiary-container/10 text-on-tertiary-container font-label-sm text-xs font-bold">
                {teacher.status}
              </span>
            </div>
            <p className="font-body-md text-xs text-on-surface-variant font-medium">
              {teacher.designation} • {teacher.qualification} • {teacher.phone} • {teacher.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/teachers"
            className="px-4 py-2 rounded-lg bg-surface-container text-on-surface font-semibold text-xs hover:bg-surface-container-high shadow-sm flex items-center gap-1.5 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Back to Directory</span>
          </Link>
        </div>
      </div>

      {/* Grid: Details & Workload */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Taught Subjects & Classes */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">menu_book</span>
              Assigned Subjects & Classes
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container text-xs font-bold text-secondary">
              {teacher.taughtSubjects?.length || 0} Allocations
            </span>
          </div>

          <div className="space-y-2">
            {teacher.taughtSubjects?.map((sub: any) => (
              <div
                key={sub.id}
                className="p-3 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-on-surface">{sub.name}</div>
                  <div className="text-[10px] text-on-surface-variant font-mono">Code: {sub.code}</div>
                </div>
                <span className="px-2 py-1 rounded bg-surface-container font-semibold text-primary">
                  {sub.class?.name}-{sub.class?.section}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Class Access Control */}
        <div className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-4">
          <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
            <h3 className="font-headline-md text-sm font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[18px]">lock_person</span>
              Class Access
            </h3>
            <span className="px-2 py-0.5 rounded bg-surface-container text-xs font-bold text-secondary">
              {selectedClassIds.length} Assigned
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-on-surface-variant">
            Controls which classes this teacher can take attendance for, enter marks for, write
            observations on, and view students in.
          </p>

          {selectedClassIds.length === 0 && (
            <div
              role="status"
              className="p-3 rounded-lg bg-error-container/20 border border-error/30 text-[11px] leading-relaxed text-on-error-container"
            >
              <span className="font-bold">No classes assigned.</span> While this list is empty
              this teacher is <span className="font-bold">unrestricted</span> and can access every
              class in the school. Select the classes they actually teach to limit their access.
            </div>
          )}

          <fieldset className="space-y-2 max-h-72 overflow-y-auto">
            <legend className="sr-only">Classes this teacher may access</legend>
            {availableClasses.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-2">
                No classes have been created for this school yet.
              </p>
            ) : (
              availableClasses.map((cls: any) => {
                const inputId = `class-access-${cls.id}`;
                return (
                  <div
                    key={cls.id}
                    className="flex items-center gap-2.5 p-2.5 rounded-lg bg-surface-container-low/60 border border-surface-container-high/40"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={selectedClassIds.includes(cls.id)}
                      onChange={() => toggleClass(cls.id)}
                      className="h-4 w-4 shrink-0 accent-secondary"
                    />
                    <label
                      htmlFor={inputId}
                      className="text-xs font-semibold text-on-surface cursor-pointer"
                    >
                      {cls.displayName}
                    </label>
                  </div>
                );
              })
            )}
          </fieldset>

          {accessError && (
            <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              <span>{accessError}</span>
            </div>
          )}
          {accessSaved && (
            <div role="status" className="p-2.5 rounded bg-tertiary-container/20 text-on-tertiary-container text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              <span>Class access updated.</span>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-surface-container-low">
            <button
              type="button"
              onClick={saveClassAccess}
              disabled={savingAccess || availableClasses.length === 0}
              className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold text-xs hover:bg-secondary/90 disabled:opacity-50"
            >
              {savingAccess ? "Saving..." : "Save Class Access"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
