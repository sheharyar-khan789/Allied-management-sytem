import { NextResponse } from "next/server";
import { z, ZodTypeAny } from "zod";

/**
 * Shared request-body validation for API routes.
 *
 * Mass assignment: identity, tenancy, money-state and audit fields are always derived on the
 * server (from the session or the stored record). A client that sends one of them gets a 400
 * instead of having it silently ignored, so tampering is visible and tested.
 */
export const ALWAYS_SERVER_CONTROLLED = [
  "uid",
  "role",
  "schoolId",
  "studentIds",
  "parentUserIds",
  "userId",
  "passwordHash",
  "sessionsValidAfter",
  "revokedSessionIds",
  "mfaSecret",
  "mfaEnabled",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "recordedBy",
  "collectedBy",
  "evaluatedBy",
  "paidAmount",
  "balanceAmount",
  "totalExpected",
  "admissionNo",
  "challanNo",
  "receiptNo",
  "lockedAt",
  "sealedAt",
  "sealedBy",
  "isLocked",
  "locked",
] as const;

export function findForbiddenFields(body: unknown, extra: readonly string[] = []): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const keys = Object.keys(body as Record<string, unknown>);
  const forbidden = new Set<string>([...ALWAYS_SERVER_CONTROLLED, ...extra]);
  return keys.filter((k) => forbidden.has(k));
}

export function forbiddenFieldsResponse(fields: string[]): NextResponse {
  return NextResponse.json(
    { error: `These fields are set by the server and cannot be submitted: ${fields.join(", ")}.` },
    { status: 400 }
  );
}

/**
 * Parses a JSON body, rejects server-controlled fields, then validates with `schema`.
 * Returns either the parsed data or a ready-to-return 400 response.
 */
export async function parseJsonBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
  extraForbidden: readonly string[] = []
): Promise<{ ok: true; data: z.infer<S>; raw: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON request payload." }, { status: 400 }) };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, response: NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 }) };
  }
  const forbidden = findForbiddenFields(raw, extraForbidden);
  if (forbidden.length > 0) return { ok: false, response: forbiddenFieldsResponse(forbidden) };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return {
      ok: false,
      response: NextResponse.json({ error: `Invalid request: ${where}${first?.message || "invalid input"}` }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data, raw: raw as Record<string, unknown> };
}

/**
 * URLs this app stores and later renders (photos, receipts, documents, logos, result sheets).
 * Only https:// is accepted (uploads return Firebase Storage https URLs). Development without
 * Storage returns data: URIs for the allowed upload types, so those are accepted outside
 * production only. javascript:, data:text/html, http:, etc. are always rejected.
 */
export function isSafeStoredUrl(value: unknown, env: Record<string, string | undefined> = process.env): boolean {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  if (/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return env.NODE_ENV !== "production" && value.length <= 15 * 1024 * 1024;
  }
  if (value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export const safeUrl = z.string().refine((v) => isSafeStoredUrl(v), { message: "must be an https:// URL" });

export const idString = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/, "invalid id");
export const shortText = (max = 200) => z.string().trim().max(max);
export const money = z.coerce.number().finite().min(0).max(100_000_000);
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const monthName = z.enum(MONTH_NAMES);
export const year = z.coerce.number().int().min(2000).max(2100);

/** Mirrors StudentDoc["documents"]: only these fields are stored. */
export const documentsArray = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(128),
      name: z.string().trim().max(200),
      type: z.enum(["ID_CARD", "CERTIFICATE", "ADMISSION_FORM", "OTHER"]),
      url: safeUrl,
      uploadedAt: z.string().trim().max(40),
      size: z.number().nonnegative().max(50 * 1024 * 1024).optional(),
    })
  )
  .max(50);
