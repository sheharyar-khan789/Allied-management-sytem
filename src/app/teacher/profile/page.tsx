"use client";

import React from "react";
import ChangePasswordPanel from "@/components/ChangePasswordPanel";

/**
 * Teachers previously had no in-app way to change their own password while signed in — only an
 * admin-sent activation email or a self-service "forgot password" link at /login. This reuses
 * the same already-timeout-protected /api/auth/change-password endpoint the student portal uses.
 */
export default function TeacherAccountPage() {
  return (
    <div className="flex flex-col w-full max-w-2xl mx-auto gap-space-lg">
      <ChangePasswordPanel idPrefix="teacher" />
    </div>
  );
}
