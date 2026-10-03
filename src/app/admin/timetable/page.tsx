"use client";

import React, { useEffect, useMemo, useState } from "react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const EMPTY_SLOT = {
  id: "",
  classId: "",
  subjectId: "",
  teacherId: "",
  dayOfWeek: "Monday",
  periodName: "",
  startTime: "",
  endTime: "",
  roomNo: "",
  topic: "",
};

export default function TimetableManagementPage() {
  const [slots, setSlots] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filterClassId, setFilterClassId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_SLOT);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSlots = async () => {
    const res = await fetch("/api/timetable");
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || "Failed to load the timetable.");
    setSlots(Array.isArray(json.timetable) ? json.timetable : []);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [clsRes, tchRes] = await Promise.all([fetch("/api/classes"), fetch("/api/teachers")]);
        const [clsJson, tchJson] = await Promise.all([clsRes.json().catch(() => ({})), tchRes.json().catch(() => ({}))]);
        if (!clsRes.ok || !clsJson.success) throw new Error(clsJson.error || "Failed to load classes.");
        if (!tchRes.ok || !tchJson.success) throw new Error(tchJson.error || "Failed to load teachers.");
        setClasses(clsJson.classes || []);
        setTeachers(tchJson.teachers || []);
        await fetchSlots();
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load the timetable.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const visible = useMemo(
    () =>
      slots.filter(
        (t) =>
          (!filterClassId || t.classId === filterClassId) &&
          (!filterTeacherId || t.teacherId === filterTeacherId) &&
          (!filterDay || t.dayOfWeek === filterDay)
      ),
    [slots, filterClassId, filterTeacherId, filterDay]
  );
  const days = DAYS.map((day) => ({ day, items: visible.filter((t) => t.dayOfWeek === day) })).filter((d) => d.items.length > 0);

  const formClass = classes.find((c) => c.id === form.classId);
  const formSubjects: any[] = formClass?.subjects || [];

  const openCreate = () => {
    setForm({ ...EMPTY_SLOT, classId: filterClassId, dayOfWeek: filterDay || "Monday" });
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (t: any) => {
    setForm({
      id: t.id,
      classId: t.classId || "",
      subjectId: t.subjectId || "",
      teacherId: t.teacherId || "",
      dayOfWeek: t.dayOfWeek || "Monday",
      periodName: t.periodName || "",
      startTime: t.startTime || "",
      endTime: t.endTime || "",
      roomNo: t.roomNo && t.roomNo !== "-" ? t.roomNo : "",
      topic: t.topic || "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const handleSubjectChange = (subjectId: string) => {
    // Default the teacher to the subject's allocated teacher; the admin can still change it.
    const subject = formSubjects.find((s) => s.id === subjectId);
    setForm({ ...form, subjectId, teacherId: subject?.teacherId || form.teacherId });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      setFormError("End time must be after start time.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/timetable", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save the timetable slot.");
      setModalOpen(false);
      await fetchSlots();
    } catch (err: any) {
      setFormError(err?.message || "Failed to save the timetable slot.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: any) => {
    if (!confirm(`Remove ${t.subjectName} for ${t.className} on ${t.dayOfWeek} ${t.startTime}–${t.endTime}?`)) return;
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/timetable?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to delete the timetable slot.");
      setSlots((prev) => prev.filter((s) => s.id !== t.id));
    } catch (err: any) {
      alert(err?.message || "Failed to delete the timetable slot.");
    } finally {
      setDeletingId(null);
    }
  };

  const inputClass = "w-full h-8 px-3 rounded bg-surface-container-low text-on-surface border border-outline-variant/40";
  const filterClass =
    "h-9 px-3 rounded-lg bg-surface-container-low text-xs font-bold text-on-surface border border-outline-variant/40 focus:outline-none focus:ring-2 focus:ring-secondary/20";

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Timetable</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-secondary/10 text-secondary font-label-sm text-xs font-bold">
              {slots.length} Periods
            </span>
          </div>
          <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
            Schedule weekly periods by class, subject, teacher, day and time. Teachers see only their own periods.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          disabled={loading || !!loadError}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all self-start sm:self-auto disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span>Add Period</span>
        </button>
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-lg bg-error-container text-on-error-container text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{loadError}</span>
        </div>
      )}

      {/* Filters */}
      <div className="p-4 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="timetable-filter-class" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Class</label>
          <select id="timetable-filter-class" value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)} className={filterClass}>
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="timetable-filter-teacher" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Teacher</label>
          <select id="timetable-filter-teacher" value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)} className={filterClass}>
            <option value="">All Teachers</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.fullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="timetable-filter-day" className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Day</label>
          <select id="timetable-filter-day" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} className={filterClass}>
            <option value="">All Days</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center space-y-3 bg-surface-container-lowest rounded-xl">
          <div className="w-8 h-8 border-3 border-secondary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-on-surface-variant">Loading timetable...</p>
        </div>
      ) : !loadError && days.length === 0 ? (
        <div className="p-12 text-center space-y-2 bg-surface-container-lowest rounded-xl border border-surface-container-high/40">
          <span className="material-symbols-outlined text-4xl text-outline-variant">calendar_month</span>
          <p className="text-sm font-semibold text-on-surface">
            {slots.length === 0 ? "No timetable periods yet" : "No periods match these filters"}
          </p>
          <p className="text-xs text-on-surface-variant">
            {slots.length === 0 ? "Use Add Period to schedule the first class period." : "Change or clear the filters above."}
          </p>
        </div>
      ) : (
        days.map(({ day, items }) => (
          <section key={day} className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-container-low border-b border-surface-container-high/40 flex items-center">
              <h2 className="font-headline-md text-sm font-bold text-on-surface">{day}</h2>
              <span className="ml-auto text-[11px] text-on-surface-variant">{items.length} {items.length === 1 ? "period" : "periods"}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-on-surface-variant font-label-sm text-[11px] uppercase tracking-wider border-b border-surface-container-high/40">
                    <th className="py-2.5 px-4 font-bold">Period</th>
                    <th className="py-2.5 px-4 font-bold">Time</th>
                    <th className="py-2.5 px-4 font-bold">Class</th>
                    <th className="py-2.5 px-4 font-bold">Subject</th>
                    <th className="py-2.5 px-4 font-bold">Teacher</th>
                    <th className="py-2.5 px-4 font-bold">Room</th>
                    <th className="py-2.5 px-4 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low">
                  {items.map((t) => (
                    <tr key={t.id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="py-2.5 px-4 font-semibold text-on-surface">{t.periodName}</td>
                      <td className="py-2.5 px-4 font-mono text-on-surface">{t.startTime} – {t.endTime}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-surface-container text-[11px] font-bold text-primary">{t.className}</span>
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-on-surface">{t.subjectName}</td>
                      <td className={`py-2.5 px-4 ${t.teacherId ? "text-on-surface" : "text-error font-semibold"}`}>
                        {t.teacherId ? t.teacherName : "Unassigned"}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-on-surface-variant">{t.roomNo && t.roomNo !== "-" ? t.roomNo : "—"}</td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(t)}
                            className="p-1.5 rounded-lg hover:bg-surface-container text-secondary transition-colors inline-block"
                            title="Edit Period"
                            aria-label={`Edit ${t.subjectName} period`}
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t)}
                            disabled={deletingId === t.id}
                            className="p-1.5 rounded-lg hover:bg-error-container text-on-surface-variant hover:text-error transition-colors inline-block disabled:opacity-50"
                            title="Delete Period"
                            aria-label={`Delete ${t.subjectName} period`}
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="timetable-slot-heading"
            className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-5 shadow-2xl border border-surface-container-high space-y-4 max-h-[90vh] overflow-y-auto my-8"
          >
            <div className="flex items-center justify-between border-b border-surface-container-low pb-2">
              <h3 id="timetable-slot-heading" className="font-headline-md text-sm font-bold text-on-surface">
                {form.id ? "Edit Timetable Period" : "Add Timetable Period"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-on-surface-variant hover:text-on-surface" aria-label="Close">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {formError && (
              <div role="alert" className="p-2.5 rounded bg-error-container text-on-error-container text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="slot-class" className="block font-semibold text-on-surface mb-1">Class *</label>
                  <select
                    id="slot-class"
                    required
                    value={form.classId}
                    onChange={(e) => setForm({ ...form, classId: e.target.value, subjectId: "" })}
                    className={inputClass}
                  >
                    <option value="">Select class</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="slot-subject" className="block font-semibold text-on-surface mb-1">Subject *</label>
                  <select
                    id="slot-subject"
                    required
                    value={form.subjectId}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    disabled={!form.classId}
                    className={inputClass}
                  >
                    <option value="">{form.classId && formSubjects.length === 0 ? "No subjects in this class" : "Select subject"}</option>
                    {formSubjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label htmlFor="slot-teacher" className="block font-semibold text-on-surface mb-1">Teacher</label>
                  <select
                    id="slot-teacher"
                    value={form.teacherId}
                    onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Subject&apos;s allocated teacher</option>
                    {teachers.filter((t) => t.status === "ACTIVE" || t.id === form.teacherId).map((t) => (
                      <option key={t.id} value={t.id}>{t.fullName} ({t.employeeId})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="slot-day" className="block font-semibold text-on-surface mb-1">Day *</label>
                  <select
                    id="slot-day"
                    required
                    value={form.dayOfWeek}
                    onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}
                    className={inputClass}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="slot-period" className="block font-semibold text-on-surface mb-1">Period *</label>
                  <input
                    id="slot-period"
                    type="text"
                    required
                    value={form.periodName}
                    onChange={(e) => setForm({ ...form, periodName: e.target.value })}
                    placeholder="e.g. Period 1"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="slot-start" className="block font-semibold text-on-surface mb-1">Start Time *</label>
                  <input
                    id="slot-start"
                    type="time"
                    required
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="slot-end" className="block font-semibold text-on-surface mb-1">End Time *</label>
                  <input
                    id="slot-end"
                    type="time"
                    required
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="slot-room" className="block font-semibold text-on-surface mb-1">Room</label>
                  <input
                    id="slot-room"
                    type="text"
                    value={form.roomNo}
                    onChange={(e) => setForm({ ...form, roomNo: e.target.value })}
                    placeholder={formClass?.roomNumber ? `Default: ${formClass.roomNumber}` : "e.g. R-101"}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="slot-topic" className="block font-semibold text-on-surface mb-1">Topic</label>
                  <input
                    id="slot-topic"
                    type="text"
                    value={form.topic}
                    onChange={(e) => setForm({ ...form, topic: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container-low">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold hover:bg-secondary/90 shadow-sm disabled:opacity-50"
                >
                  {saving ? "Saving..." : form.id ? "Save Changes" : "Add Period"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
