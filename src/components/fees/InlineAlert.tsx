import React from "react";

export default function InlineAlert({ type, message }: { type: "success" | "error"; message: string }) {
  if (!message) return null;
  return (
    <p
      className={`text-xs font-semibold rounded-lg px-3 py-2 ${
        type === "success" ? "bg-tertiary-container/10 text-on-tertiary-container" : "bg-error-container text-on-error-container"
      }`}
    >
      {message}
    </p>
  );
}
