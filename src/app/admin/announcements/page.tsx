"use client";

import React, { useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

type Announcement = {
  id: string;
  title: string;
  message: string;
  audience: "EVERYONE" | "TEACHERS" | "STUDENTS" | "PARENTS";
  status: "DRAFT" | "PUBLISHED";
  publishedAt?: string | null;
  createdAt: string;
  createdByName?: string;
};

const emptyForm = {
  title: "",
  message: "",
  audience: "EVERYONE" as Announcement["audience"],
  status: "PUBLISHED" as Announcement["status"],
};

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/announcements");
    const json = await res.json();
    if (json.success) setItems(json.announcements);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/announcements", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not save announcement.");
        return;
      }
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    const res = await fetch(`/api/announcements?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold text-on-surface">Announcements</h1>
        <p className="text-xs text-on-surface-variant mt-0.5">
          School-scoped notices. Audience controls who can see published items in-app.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-5 rounded-xl bg-surface-container-lowest shadow-sm border border-surface-container-high/40 space-y-3 text-xs"
      >
        <h3 className="font-headline-md text-sm font-bold">{editingId ? "Edit announcement" : "Create announcement"}</h3>
        {error && <p className="text-error">{error}</p>}
        <input
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Title"
          className="w-full h-9 px-3 rounded-lg bg-surface-container-low"
        />
        <textarea
          required
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          placeholder="Message"
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-surface-container-low"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value as Announcement["audience"] })}
            className="h-9 px-3 rounded-lg bg-surface-container-low"
          >
            <option value="EVERYONE">Everyone</option>
            <option value="TEACHERS">Teachers</option>
            <option value="STUDENTS">Students</option>
            <option value="PARENTS">Parents</option>
          </select>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Announcement["status"] })}
            className="h-9 px-3 rounded-lg bg-surface-container-low"
          >
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft / unpublished</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-secondary text-on-secondary font-semibold">
            {saving ? "Saving..." : editingId ? "Update" : "Publish"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="px-4 py-2 rounded-lg bg-surface-container font-semibold">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container-high/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-on-surface-variant">Loading announcements...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-on-surface-variant">No announcements yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-surface-container-low uppercase text-[11px] font-bold text-on-surface-variant">
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Audience</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 px-4">
                      <p className="font-bold">{a.title}</p>
                      <p className="text-on-surface-variant line-clamp-2 mt-0.5">{a.message}</p>
                    </td>
                    <td className="py-3 px-4">{a.audience}</td>
                    <td className="py-3 px-4">{a.status}</td>
                    <td className="py-3 px-4">{formatDate(a.publishedAt || a.createdAt)}</td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="text-secondary font-semibold"
                        onClick={() => {
                          setEditingId(a.id);
                          setForm({
                            title: a.title,
                            message: a.message,
                            audience: a.audience,
                            status: a.status,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="text-error font-semibold" onClick={() => handleDelete(a.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
