"use client";

import { useEffect, useState } from "react";

/**
 * `value`, updated only after it has stopped changing for `delayMs`. Search boxes use it so a
 * list is fetched once per typed query instead of once per keystroke (each fetch costs Firestore
 * reads on the server).
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
