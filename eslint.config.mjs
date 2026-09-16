import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  // Base-level Next.js config: catches real correctness/accessibility/React issues.
  // The stricter "next/typescript" ruleset (which flags every pre-existing `any`) was
  // deliberately not enabled here — this repo has no prior ESLint history, and retyping
  // hundreds of pre-existing `any` usages across unrelated files is a large-scale rewrite
  // outside the scope of this change, not a real bug being fixed.
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
