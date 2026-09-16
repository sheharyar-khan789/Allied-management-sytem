"use client";

import React, { useEffect, useState } from "react";

export default function ClassesAndSubjectsPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [className, setClassName] = useState("Class 11");
  const [section, setSection] = useState("A");
  const [roomNumber, setRoomNumber] = useState("Room 205");
  const [capacity, setCapacity] = useState("30");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  const fetchClasses = async () => {
    try {
      const res = await fetch("/api/classes");
      const json = await res.json();
      if (json.success) {
        setClasses(json.classes);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTeachers = async () => {
    try {
      const res = await fetch("/api/teachers");
      const json = await res.json();
      if (json.success) {
        setTeachers(json.teachers);
        if (json.teachers.length > 0) setSelectedTeacherId(json.teachers[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchClasses();
    fetchTeachers();
  }, []);

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: className,
          section,
          roomNumber,
          capacity: Number(capacity),
          classTeacherId: selectedTeacherId || null,
        }),
      });

      if (res.ok) {
        setClassModalOpen(false);
        fetchClasses();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">
              Classes & Curriculum Subjects
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {classes.length} Active Cohorts
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Configure academic cohorts, section divisions, assigned class teachers, and subject syllabi.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setClassModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span>Create New Class</span>
        </button>
      </div>

      {/* Grid of Classes */}
      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading academic cohorts...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {classes.map((cls) => (
            <div
              key={cls.id}
              className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                {/* Card Top */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center font-headline-lg text-base font-bold">
                      {cls.name.split(" ")[1] || "C"}
                    </div>
                    <div>
                      <h3 className="font-headline-md text-base font-bold text-on-surface">
                        {cls.displayName}
                      </h3>
                      <span className="text-[11px] text-on-surface-variant font-mono">
                        {cls.roomNumber || "Campus Wing"}
                      </span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-[11px] font-bold text-on-surface">
                    Section {cls.section}
                  </span>
                </div>

                {/* Class Teacher */}
                <div className="mt-4 p-2.5 rounded-lg bg-surface-container-low/80 flex items-center justify-between text-xs">
                  <span className="text-on-surface-variant font-medium">Class Incharge:</span>
                  <span className="font-bold text-primary">{cls.classTeacherName}</span>
                </div>

                {/* Capacity Bar */}
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-on-surface-variant">Enrolled Students</span>
                    <span className="font-bold text-on-surface">
                      {cls.studentCount} / {cls.capacity}
                    </span>
                  </div>
                  <div className="w-full bg-surface-container-high rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-secondary h-full rounded-full"
                      style={{ width: `${Math.min(100, (cls.studentCount / cls.capacity) * 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Subjects Preview */}
                <div className="mt-4 pt-3 border-t border-surface-container-low">
                  <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">
                    Syllabus Subjects ({cls.subjects.length})
                  </span>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {cls.subjects.slice(0, 5).map((sub: any) => (
                      <span
                        key={sub.id}
                        className="px-2 py-0.5 rounded bg-surface-container text-[10px] font-medium text-on-surface"
                      >
                        {sub.name}
                      </span>
                    ))}
                    {cls.subjects.length > 5 && (
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-bold text-on-surface-variant">
                        +{cls.subjects.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-surface-container-low flex items-center justify-between text-xs">
                <span className="text-on-tertiary-container font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-on-tertiary-container"></span>
                  Active Session
                </span>
                <span className="font-mono text-on-surface-variant text-[11px]">ID: {cls.id.slice(-6)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Class Modal */}
      {classModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-class-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="create-class-heading" className="font-headline-md text-sm font-bold text-on-surface">Create New Class Cohort</h3>
              <button
                onClick={() => setClassModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateClass} className="space-y-3 text-xs">
              <div>
                <label htmlFor="classes-class-name-1" className="block font-semibold text-on-surface mb-1">Class Name *</label>
                <input id="classes-class-name-1"
                  type="text"
                  required
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="e.g. Class 11"
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="classes-section-2" className="block font-semibold text-on-surface mb-1">Section *</label>
                <select id="classes-section-2"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-semibold"
                >
                  <option value="A">Section A</option>
                  <option value="B">Section B</option>
                  <option value="C">Section C</option>
                </select>
              </div>

              <div>
                <label htmlFor="classes-room-wing-3" className="block font-semibold text-on-surface mb-1">Room / Wing</label>
                <input id="classes-room-wing-3"
                  type="text"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="e.g. Room 205"
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="classes-student-capacity-4" className="block font-semibold text-on-surface mb-1">Student Capacity</label>
                <input id="classes-student-capacity-4"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="30"
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="classes-class-incharge-teacher-5" className="block font-semibold text-on-surface mb-1">Class Incharge / Teacher</label>
                <select id="classes-class-incharge-teacher-5"
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  <option value="">Unassigned</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName} ({t.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setClassModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {formLoading ? "Creating..." : "Save Class"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
