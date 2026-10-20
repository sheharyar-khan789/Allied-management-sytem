/**
 * CSP nonce / rendering-mode guard. The middleware sends every page it matches a nonce-based
 * script-src ('nonce-…' 'strict-dynamic'); Next.js can only put that per-request nonce on its
 * <script> tags when the page renders per request. A statically prerendered public page is
 * served with un-nonced scripts, the browser blocks all of them, and the page never hydrates —
 * which is what kept /reset-password on "Loading password reset..." and what the registration
 * page was exposed to.
 *
 * This checks the route configuration in source. It does not run a browser; the served HTML is
 * checked separately against a production build (see the release report).
 */
import { readFileSync } from "fs";
import path from "path";
import * as loginLayout from "../src/app/login/layout";
import * as registerLayout from "../src/app/register-institution-x7k2p/layout";
import * as resetPage from "../src/app/reset-password/page";

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

console.log("==================================================");
console.log("CSP NONCE / RENDER MODE");
console.log("==================================================");

assert((loginLayout as any).dynamic === "force-dynamic", "/login renders per request (nonce on its scripts)");
assert((registerLayout as any).dynamic === "force-dynamic", "/register-institution-x7k2p renders per request (nonce on its scripts)");
assert((resetPage as any).dynamic === "force-dynamic", "/reset-password renders per request (nonce on its scripts)");

// Every public page in the middleware matcher must be covered above. Role portals (/admin,
// /teacher, /student, /parent, /print) read the session cookie and "/" redirects by session, so
// they are always rendered per request.
const middlewareSource = readFileSync(path.join(__dirname, "../src/middleware.ts"), "utf8");
const matcherBlock = /matcher:\s*\[([\s\S]*?)\]/.exec(middlewareSource)?.[1] || "";
const matched = Array.from(matcherBlock.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
const sessionRendered = ["/", "/api/:path*", "/admin/:path*", "/teacher/:path*", "/student/:path*", "/parent/:path*", "/print/:path*"];
const covered = ["/login", "/register-institution-x7k2p", "/reset-password"];
const uncovered = matched.filter((m) => !sessionRendered.includes(m) && !covered.includes(m));
assert(matched.length > 0, "Middleware matcher was found and parsed");
assert(uncovered.length === 0, `Every public page under the nonce CSP is forced to render per request${uncovered.length ? ` (missing: ${uncovered.join(", ")})` : ""}`);

// The policy itself stays strict: nonce + strict-dynamic, no 'unsafe-inline' for scripts in production.
assert(/script-src 'self' 'nonce-\$\{nonce\}' 'strict-dynamic'`/.test(middlewareSource), "Production script-src is still nonce + strict-dynamic");
const scriptDirectives = middlewareSource.match(/`script-src[^`]*`/g) || [];
assert(scriptDirectives.length >= 2 && scriptDirectives.every((d) => !d.includes("'unsafe-inline'")), "script-src never allows 'unsafe-inline'");

console.log(`\nCSP render-mode tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
