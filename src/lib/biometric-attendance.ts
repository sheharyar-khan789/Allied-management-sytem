import type { TeacherAttendanceDoc } from "./firebase/types";
import { zonedDateParts, DEFAULT_SCHOOL_TIMEZONE } from "./lesson-plan-schedule";
import { teacherAttendanceIdFor } from "./teacher-attendance";

/**
 * Biometric attendance compatibility layer (Phase 11) — a provider-independent adapter, NOT a
 * connector to any real device. No biometric machine model has been supplied, so this
 * deliberately does not invent a vendor API, push/poll protocol, authentication scheme, or event
 * wire format: all of that is vendor-specific and would be guessed. What exists here is the
 * generic shape a real connector would plug into, fully implemented and tested with simulated
 * events only (never written to production data by this code — nothing in src/app/api calls
 * this file yet; wiring a live HTTP endpoint to it is the next step once a vendor is chosen).
 *
 * Required from the hardware vendor before a real connector can be built:
 *  - Manufacturer and exact model.
 *  - Push (webhook) or poll: if push, the exact request format and how to verify it's really
 *    the device/vendor (shared secret, HMAC signature, mutual TLS, IP allowlist, ...); if poll,
 *    the API endpoint, auth method, and rate limits.
 *  - The event payload format: field names/types for device id, the device's own per-user id,
 *    event timestamp (and its timezone/offset), and event type (check-in/check-out/single punch).
 *  - Whether the device can replay/resend an event (and if so, whether it reuses the same event
 *    id or not) — needed to tune duplicate detection beyond the eventId check below.
 *  - Offline behavior: does the device buffer events during a network outage and send them all
 *    once reconnected, and if so, in what order and with what original timestamps?
 *  - Multi-device support: can one teacher enroll on more than one device/location?
 *
 * Never required, never stored: fingerprint images or templates. The device itself matches the
 * fingerprint to its own enrolled "device user id" and only ever sends that opaque id onward —
 * this layer stores that id and the resulting attendance event, nothing biometric.
 */

/** The normalized shape any vendor's real payload must be translated into before reaching
 *  `resolveBiometricEvent`. A real adapter (vendor-specific, not written here) parses the
 *  device's own wire format into this. */
export interface BiometricEvent {
  schoolId: string;
  deviceId: string;
  /** The device's own enrolled user id — never a name, never biometric data. */
  deviceUserId: string;
  /** The vendor's own unique id for this punch, for duplicate-event detection. If a vendor does
   *  not provide one, the adapter must synthesize a stable one (e.g. deviceId+deviceUserId+
   *  timestamp) — never accept events with no way to detect a resend. */
  eventId: string;
  /** ISO 8601 instant, any offset — converted to the school's local calendar date below. */
  timestampUtc: string;
}

/** Looks up which teacher a device-reported user id belongs to. Returns null for an
 *  unrecognized (deviceId, deviceUserId) pair — the event is then rejected, never guessed. */
export interface DeviceUserDirectory {
  resolveTeacherId(schoolId: string, deviceId: string, deviceUserId: string): string | null;
}

export type BiometricEventOutcome =
  | { ok: true; teacherId: string; date: string; checkInTime: string }
  | { ok: false; reason: "UNMAPPED_DEVICE_USER" | "DUPLICATE_EVENT" | "SCHOOL_MISMATCH" | "SUPERSEDED_BY_CORRECTION" };

/**
 * Pure resolution step (no Firestore access): validates the event, maps it to a real teacher,
 * and computes the school-local date/time it represents. The caller (ingestBiometricEventServer,
 * a thin server-db wrapper — not implemented here since there is no live endpoint yet) is
 * responsible for the actual read/write and for honoring DUPLICATE_EVENT / SUPERSEDED_BY_CORRECTION.
 */
export function resolveBiometricEvent(
  event: BiometricEvent,
  directory: DeviceUserDirectory,
  existingByEventId: ReadonlySet<string>,
  existingRecordForDate: TeacherAttendanceDoc | undefined,
  timezone: string = DEFAULT_SCHOOL_TIMEZONE
): BiometricEventOutcome {
  if (existingByEventId.has(event.eventId)) {
    return { ok: false, reason: "DUPLICATE_EVENT" };
  }

  const teacherId = directory.resolveTeacherId(event.schoolId, event.deviceId, event.deviceUserId);
  if (!teacherId) {
    return { ok: false, reason: "UNMAPPED_DEVICE_USER" };
  }

  const { date } = zonedDateParts(timezone, new Date(event.timestampUtc));
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(event.timestampUtc));
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const checkInTime = `${hour}:${minute}`;

  // A deliberate admin correction for this exact date is never silently overwritten by a
  // biometric event that arrives afterwards (e.g. a delayed/offline-buffered punch).
  if (existingRecordForDate?.source === "ADMIN_CORRECTION") {
    return { ok: false, reason: "SUPERSEDED_BY_CORRECTION" };
  }

  return { ok: true, teacherId, date, checkInTime };
}

/** Builds the attendance document a resolved, accepted event should be written as — the
 *  earliest check-in of the day wins if more than one punch arrives for the same date. */
export function buildBiometricAttendanceDoc(
  event: BiometricEvent,
  outcome: Extract<BiometricEventOutcome, { ok: true }>,
  existingRecordForDate: TeacherAttendanceDoc | undefined,
  teacherName: string | undefined,
  now: string
): TeacherAttendanceDoc {
  const keepsEarlierCheckIn =
    existingRecordForDate?.source === "BIOMETRIC" &&
    existingRecordForDate.status === "PRESENT" &&
    existingRecordForDate.checkInTime &&
    existingRecordForDate.checkInTime <= outcome.checkInTime;

  return {
    id: teacherAttendanceIdFor(event.schoolId, outcome.teacherId, outcome.date),
    schoolId: event.schoolId,
    teacherId: outcome.teacherId,
    teacherName,
    date: outcome.date,
    status: "PRESENT",
    source: "BIOMETRIC",
    checkInTime: keepsEarlierCheckIn ? existingRecordForDate!.checkInTime : outcome.checkInTime,
    deviceId: event.deviceId,
    eventId: event.eventId,
    recordedBy: existingRecordForDate?.recordedBy,
    createdAt: existingRecordForDate?.createdAt || now,
    updatedAt: now,
  };
}
