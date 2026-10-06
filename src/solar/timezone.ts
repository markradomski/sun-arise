import tzLookup from "tz-lookup";

/**
 * Civil timezone resolution: coordinates → IANA zone → UTC offset.
 *
 * Deliberately separate from the astronomical maths in `solarPosition`. That
 * function needs an offset to convert between civil and solar time; it should
 * not know *how* the offset was obtained. This module imports nothing from
 * `cesium/` or `state/`, in keeping with the rule that `solar/` stays portable
 * enough to move into a Web Worker.
 *
 * DST is handled by `Intl`, which resolves the offset for a specific instant
 * rather than assuming a fixed one per zone.
 */

export interface CivilZone {
  /** IANA identifier, e.g. "Australia/Sydney". */
  timeZone: string;
  /** Offset from UTC in hours at the given instant, DST included. */
  offsetHours: number;
  /** Short display name at that instant, e.g. "AEDT". */
  abbreviation: string;
}

export function timeZoneAt(latitude: number, longitude: number): string {
  try {
    return tzLookup(latitude, longitude);
  } catch {
    // tz-lookup throws on out-of-range input; fall back to nautical time.
    return nauticalZone(longitude);
  }
}

/**
 * UTC offset in hours for an instant in a zone, DST-correct.
 *
 * `longOffset` yields strings like "GMT+11:00" / "GMT-03:30" / "GMT".
 */
export function offsetHoursAt(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(date);

    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!match) return 0; // bare "GMT" means UTC

    const [, sign, hours, minutes] = match;
    const magnitude = Number(hours) + Number(minutes ?? 0) / 60;
    return sign === "-" ? -magnitude : magnitude;
  } catch {
    return 0;
  }
}

function abbreviationAt(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Full civil zone for a coordinate at an instant. */
export function civilZone(
  date: Date,
  latitude: number,
  longitude: number,
): CivilZone {
  const timeZone = timeZoneAt(latitude, longitude);
  return {
    timeZone,
    offsetHours: offsetHoursAt(date, timeZone),
    abbreviation: abbreviationAt(date, timeZone),
  };
}

export interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/**
 * Wall-clock fields for an instant in a zone.
 *
 * The app's clock stores an absolute instant; the UI shows civil time at the
 * *selected site*, not in the browser's own zone. Moving the house across a
 * timezone boundary therefore changes the displayed time without changing the
 * instant being simulated.
 */
export function civilParts(date: Date, timeZone: string): CivilParts {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);

    // Intl renders midnight as hour 24 in some locales/engines.
    const hour = get("hour") % 24;
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour,
      minute: get("minute"),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

/** Minutes past civil midnight at the site. */
export function civilMinutes(date: Date, timeZone: string): number {
  const { hour, minute } = civilParts(date, timeZone);
  return hour * 60 + minute;
}

/** Shift an instant so civil time at the site reads `minutes`, same civil day. */
export function withCivilMinutes(
  date: Date,
  timeZone: string,
  minutes: number,
): Date {
  const delta = minutes - civilMinutes(date, timeZone);
  return new Date(date.getTime() + delta * 60_000);
}

/** Shift an instant to a different civil date at the site, same time of day. */
export function withCivilDate(
  date: Date,
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const current = civilParts(date, timeZone);
  const fromUtc = Date.UTC(current.year, current.month - 1, current.day);
  const toUtc = Date.UTC(year, month - 1, day);
  const days = Math.round((toUtc - fromUtc) / 86_400_000);
  return new Date(date.getTime() + days * 86_400_000);
}

/** Longitude-derived zone, used only when a coordinate has no IANA match. */
function nauticalZone(longitude: number): string {
  const hours = Math.round(longitude / 15);
  if (hours === 0) return "UTC";
  // Etc/GMT zones use inverted signs by POSIX convention.
  return `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
}
