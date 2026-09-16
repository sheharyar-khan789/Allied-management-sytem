"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type LinkedChild = {
  id: string;
  fullName: string;
  admissionNo: string;
  rollNo: string;
  classId: string;
  className: string;
  section: string;
  status: string;
};

export type ChildPayload = {
  student: any;
  attendance: any;
  fees: any;
  results: any[];
  academics: any;
  school: any;
  announcements?: any[];
};

export function useParentChild(options?: { loadAcademic?: boolean }) {
  const loadAcademic = options?.loadAcademic !== false;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("studentId") || "";

  const [children, setChildren] = useState<LinkedChild[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [payload, setPayload] = useState<ChildPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/parent/children")
      .then((res) => res.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success && Array.isArray(d.children)) {
          setChildren(d.children);
        } else {
          setError(d?.error || "Unable to load linked children.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load linked children.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!children.length) {
      setPayload(null);
      setSelectedId("");
      return;
    }

    if (requestedId && !children.some((c) => c.id === requestedId)) {
      setError("This student is not linked to your parent account.");
      setPayload(null);
      setSelectedId("");
      return;
    }

    const soleLinkedId = children.length === 1 ? children[0].id : "";
    const id = requestedId || soleLinkedId;
    setSelectedId(id);

    if (!id) {
      setPayload(null);
      setError("");
      setLoading(false);
      return;
    }

    if (!loadAcademic) {
      setError("");
      setLoading(false);
      return;
    }

    setError("");
    setLoading(true);

    let cancelled = false;
    fetch(`/api/parent/child/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const d = await res.json();
        if (cancelled) return;
        if (res.status === 403 || !d?.success) {
          setError(d?.error || "You cannot view this student.");
          setPayload(null);
          return;
        }
        setPayload(d);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load child records.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [children, requestedId, loadAcademic]);

  const selectChild = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("studentId", id);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return { children, selectedId, payload, loading, error, selectChild };
}

export function ChildSelector({
  linkedChildren,
  selectedId,
  onSelect,
}: {
  linkedChildren: LinkedChild[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (linkedChildren.length === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <label htmlFor="parent-child-1" className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Child
      </label>
      <select id="parent-child-1"
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="h-9 min-w-[220px] px-3 rounded-lg bg-surface-container-low text-on-surface text-xs font-semibold border border-transparent focus:border-outline-variant/50 focus:outline-none"
      >
        {linkedChildren.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName} • {c.className || "Class"} • Adm {c.admissionNo}
          </option>
        ))}
      </select>
    </div>
  );
}
