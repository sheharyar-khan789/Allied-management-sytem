"use client";

import React, { useEffect, useState } from "react";

export default function ClassesAndSubjectsPage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<any>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState("");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("A");
  const [roomNumber, setRoomNumber] = useState("");
  const [capacity, setCapacity] = useState("30");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  // Subject management state
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<any>(null);
  const [subjectFormLoading, setSubjectFormLoading] = useState(false);
  const [subjectError, setSubjectError] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectClassId, setSubjectClassId] = useState("");
  const [subjectTeacherId, setSubjectTeacherId] = useState("");
  const [subjectCredits, setSubjectCredits] = useState("3");

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
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchClasses();
    fetchTeachers();
  }, []);

  const openCreateModal = () => {
    setEditingClass(null);
    setClassName("");
    setSection("A");
    setRoomNumber("");
    setCapacity("30");
    setSelectedTeacherId("");
    setError("");
    setClassModalOpen(true);
  };

  const openEditModal = (cls: any) => {
    setEditingClass(cls);
    setClassName(cls.name || "");
    setSection(cls.section || "A");
    setRoomNumber(cls.roomNumber !== "-" ? cls.roomNumber : "");
    setCapacity(String(cls.capacity || 30));
    setSelectedTeacherId(cls.classTeacherId || "");
    setError("");
    setClassModalOpen(true);
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFormLoading(true);

    try {
      const method = editingClass ? "PUT" : "POST";
      const payload: any = {
        name: className,
        section,
        roomNumber,
        capacity: Number(capacity),
        classTeacherId: selectedTeacherId || null,
      };
      if (editingClass) {
        payload.id = editingClass.id;
      }

      const res = await fetch("/api/classes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${editingClass ? "update" : "create"} class.`);
      }

      setClassModalOpen(false);
      fetchClasses();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setFormLoading(false);
    }
  };

  const openCreateSubjectModal = (preselectedClassId?: string) => {
    setEditingSubject(null);
    setSubjectName("");
    setSubjectCode("");
    setSubjectClassId(preselectedClassId || classes[0]?.id || "");
    setSubjectTeacherId("");
    setSubjectCredits("3");
    setSubjectError("");
    setSubjectModalOpen(true);
  };

  const openEditSubjectModal = (sub: any, cls: any) => {
    setEditingSubject(sub);
    setSubjectName(sub.name || "");
    setSubjectCode(sub.code || "");
    setSubjectClassId(sub.classId || cls.id || "");
    setSubjectTeacherId(sub.teacherId || "");
    setSubjectCredits(String(sub.credits || 3));
    setSubjectError("");
    setSubjectModalOpen(true);
  };

  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubjectError("");

    if (!subjectName.trim()) {
      setSubjectError("Subject name is required.");
      return;
    }

    if (!subjectClassId) {
      setSubjectError("Please select a class for this subject.");
      return;
    }

    setSubjectFormLoading(true);

    try {
      const method = editingSubject ? "PUT" : "POST";
      const payload: any = {
        name: subjectName.trim(),
        code: subjectCode.trim(),
        classId: subjectClassId,
        teacherId: subjectTeacherId || null,
        credits: Number(subjectCredits) || 3,
      };

      if (editingSubject) {
        payload.id = editingSubject.id;
      }

      const res = await fetch("/api/subjects", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${editingSubject ? "update" : "create"} subject.`);
      }

      setSubjectModalOpen(false);
      fetchClasses();
    } catch (err: any) {
      setSubjectError(err.message || "An unexpected error occurred.");
    } finally {
      setSubjectFormLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    if (!confirm("Are you sure you want to delete this subject?")) return;

    try {
      const res = await fetch(`/api/subjects?id=${encodeURIComponent(subjectId)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete subject.");
        return;
      }

      fetchClasses();
    } catch (err: any) {
      console.error(err);
      alert("Failed to delete subject.");
    }
  };

  const handleDeleteClass = async (classId: string, displayName: string) => {
    if (!confirm(`Are you sure you want to delete class "${displayName}"? This action cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/classes?id=${encodeURIComponent(classId)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete class.");
        return;
      }

      fetchClasses();
    } catch (err: any) {
      console.error(err);
      alert("Failed to delete class.");
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCreateSubjectModal()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-high text-on-surface font-label-md text-xs font-semibold hover:bg-surface-container-highest shadow-sm transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">menu_book</span>
            <span>Add Subject</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all self-start sm:self-auto"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Create New Class</span>
          </button>
        </div>
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
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-[11px] font-bold text-on-surface">
                      Section {cls.section}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditModal(cls)}
                      className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-secondary transition-colors"
                      title="Edit Class Cohort"
                      aria-label={`Edit ${cls.displayName}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClass(cls.id, cls.displayName)}
                      className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-error transition-colors"
                      title="Delete Class Cohort"
                      aria-label={`Delete ${cls.displayName}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
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

                {/* Subjects Section */}
                <div className="mt-4 pt-3 border-t border-surface-container-low">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">
                      Curriculum Subjects ({cls.subjects.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => openCreateSubjectModal(cls.id)}
                      className="text-[11px] font-semibold text-secondary hover:underline flex items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      <span>Add Subject</span>
                    </button>
                  </div>

                  {cls.subjects.length === 0 ? (
                    <div className="mt-2 py-3 px-3 rounded-lg bg-surface-container-low/50 border border-dashed border-outline-variant/40 text-center">
                      <p className="text-[11px] text-on-surface-variant italic">No subjects assigned</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 mt-2 max-h-48 overflow-y-auto pr-1">
                      {cls.subjects.map((sub: any) => (
                        <div
                          key={sub.id}
                          className="p-2 rounded-lg bg-surface-container-low/80 border border-surface-container-high/40 flex items-center justify-between text-xs"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-semibold text-on-surface truncate">{sub.name}</span>
                            <span className="text-[10px] text-on-surface-variant font-mono">
                              {sub.code ? `${sub.code} • ` : ""}Teacher:{" "}
                              <span
                                className={
                                  sub.teacherName && sub.teacherName !== "Unassigned"
                                    ? "text-primary font-medium"
                                    : "text-error"
                                }
                              >
                                {sub.teacherName || "Unassigned"}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditSubjectModal(sub, cls)}
                              className="p-1 rounded hover:bg-surface-container text-secondary"
                              title="Edit Subject & Teacher"
                              aria-label={`Edit ${sub.name}`}
                            >
                              <span className="material-symbols-outlined text-[15px]">edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubject(sub.id)}
                              className="p-1 rounded hover:bg-surface-container text-error/80 hover:text-error"
                              title="Delete Subject"
                              aria-label={`Delete ${sub.name}`}
                            >
                              <span className="material-symbols-outlined text-[15px]">delete</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
              <h3 id="create-class-heading" className="font-headline-md text-sm font-bold text-on-surface">
                {editingClass ? "Edit Class Cohort" : "Create New Class Cohort"}
              </h3>
              <button
                onClick={() => setClassModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-error-container/30 border border-error/30 text-error text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleSaveClass} className="space-y-3 text-xs">
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
                  {formLoading ? (editingClass ? "Updating..." : "Creating...") : (editingClass ? "Update Class" : "Save Class")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Subject Modal */}
      {subjectModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="subject-modal-heading"
            className="bg-surface-container-lowest rounded-xl max-w-md w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="subject-modal-heading" className="font-headline-md text-sm font-bold text-on-surface">
                {editingSubject ? "Edit Subject & Teacher Assignment" : "Add Subject to Class"}
              </h3>
              <button
                onClick={() => setSubjectModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {subjectError && (
              <div className="p-2.5 rounded-lg bg-error-container/30 border border-error/30 text-error text-xs">
                {subjectError}
              </div>
            )}

            <form onSubmit={handleSaveSubject} className="space-y-3 text-xs">
              <div>
                <label htmlFor="subject-name" className="block font-semibold text-on-surface mb-1">
                  Subject Name *
                </label>
                <input
                  id="subject-name"
                  type="text"
                  required
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  placeholder="e.g. Mathematics, English, General Science"
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="subject-code" className="block font-semibold text-on-surface mb-1">
                  Subject Code
                </label>
                <input
                  id="subject-code"
                  type="text"
                  value={subjectCode}
                  onChange={(e) => setSubjectCode(e.target.value)}
                  placeholder="e.g. MTH-10, ENG-09 (optional)"
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div>
                <label htmlFor="subject-class" className="block font-semibold text-on-surface mb-1">
                  Target Class Cohort *
                </label>
                <select
                  id="subject-class"
                  required
                  value={subjectClassId}
                  onChange={(e) => setSubjectClassId(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40 font-semibold"
                >
                  <option value="">Select a class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="subject-teacher" className="block font-semibold text-on-surface mb-1">
                  Assigned Subject Teacher
                </label>
                <select
                  id="subject-teacher"
                  value={subjectTeacherId}
                  onChange={(e) => setSubjectTeacherId(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                >
                  <option value="">Unassigned</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName} ({t.designation})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-on-surface-variant mt-0.5">
                  Assigns this educator to teach this curriculum subject and grants them grading/attendance access.
                </p>
              </div>

              <div>
                <label htmlFor="subject-credits" className="block font-semibold text-on-surface mb-1">
                  Weekly Periods / Credits
                </label>
                <input
                  id="subject-credits"
                  type="number"
                  min="1"
                  max="10"
                  value={subjectCredits}
                  onChange={(e) => setSubjectCredits(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setSubjectModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={subjectFormLoading}
                  className="px-4 py-1.5 rounded bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 disabled:opacity-50"
                >
                  {subjectFormLoading
                    ? (editingSubject ? "Updating..." : "Saving...")
                    : (editingSubject ? "Update Subject" : "Save Subject")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
