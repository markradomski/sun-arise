import type { SolarPosition } from "../types";

/**
 * Compact NOAA-style solar position approximation.
 * Good enough for an interactive visual MVP; replace with a higher precision
 * ephemeris if the product later makes quantitative claims.
 */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86400000);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function solarPosition(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
  utcOffsetHours: number
): SolarPosition {
  const n = dayOfYear(date);
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  // Local civil time, used for sunrise/sunset which are reported in local minutes.
  const minutes = utcMinutes + utcOffsetHours * 60;
  const gamma = (2 * Math.PI / 365) * (n - 1 + (minutes / 60 - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // NOAA builds true solar time from UTC: local_time + eqTime + 4*lng - 60*offset
  // reduces to utcMinutes + eqTime + 4*lng. Using local `minutes` here would
  // apply the timezone offset a second time.
  const trueSolarMinutes = (utcMinutes + eqTime + 4 * longitudeDeg + 1440) % 1440;
  const hourAngleDeg = trueSolarMinutes / 4 < 0
    ? trueSolarMinutes / 4 + 180
    : trueSolarMinutes / 4 - 180;

  const lat = latitudeDeg * Math.PI / 180;
  const ha = hourAngleDeg * Math.PI / 180;

  const cosZenith = clamp(
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha),
    -1,
    1
  );
  const zenith = Math.acos(cosZenith);
  const altitudeDeg = 90 - zenith * 180 / Math.PI;

  let azimuthDeg =
    Math.atan2(
      Math.sin(ha),
      Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)
    ) * 180 / Math.PI + 180;

  azimuthDeg = (azimuthDeg + 360) % 360;

  const solarNoon = 720 - 4 * longitudeDeg - eqTime + utcOffsetHours * 60;
  const cosH =
    (Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat) * Math.cos(decl))) -
    Math.tan(lat) * Math.tan(decl);

  const hourAngle = Math.acos(clamp(cosH, -1, 1)) * 180 / Math.PI;
  const sunriseMinutes = solarNoon - hourAngle * 4;
  const sunsetMinutes = solarNoon + hourAngle * 4;

  return { azimuthDeg, altitudeDeg, sunriseMinutes, sunsetMinutes };
}

export function formatClockMinutes(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}