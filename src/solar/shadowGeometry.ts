import { solarPosition } from "./solarPosition";
import type { GeoPosition } from "../scene/types";

/**
 * Synthetic shadow geometry.
 *
 * Note this is a *proxy*, not a real shadow: Cesium's shadow map already casts
 * the true shadow onto the terrain. These polylines are a sun-path trace drawn
 * on top of it, useful because the real shadow is hard to read at low sun
 * angles and impossible to see all at once across a day.
 */

const MAX_SHADOW_LENGTH_METERS = 150;
const SHADOW_TRAIL_INTERVAL_MINUTES = 30;
const EARTH_RADIUS_METERS = 6_371_000;

export interface ShadowSegment {
  start: GeoPosition;
  end: GeoPosition;
}

export function visualShadow(
  date: Date,
  location: GeoPosition,
  heightMeters: number,
  utcOffsetHours: number,
): ShadowSegment | undefined {
  const sun = solarPosition(date, location.latitude, location.longitude, utcOffsetHours);
  if (sun.altitudeDeg <= 0) return undefined;

  const shadowLength = Math.min(
    heightMeters / Math.tan((sun.altitudeDeg * Math.PI) / 180),
    MAX_SHADOW_LENGTH_METERS,
  );
  const bearing = ((sun.azimuthDeg + 180) * Math.PI) / 180;
  const angularDistance = shadowLength / EARTH_RADIUS_METERS;
  const latitude = (location.latitude * Math.PI) / 180;
  const longitude = (location.longitude * Math.PI) / 180;

  const endLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const endLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(endLatitude),
    );

  return {
    start: { ...location, height: location.height + 0.2 },
    end: {
      latitude: (endLatitude * 180) / Math.PI,
      longitude: (endLongitude * 180) / Math.PI,
      height: location.height + 0.2,
    },
  };
}

export function dailyShadowTrail(
  date: Date,
  location: GeoPosition,
  heightMeters: number,
  utcOffsetHours: number,
): ShadowSegment[] {
  const samples = 1440 / SHADOW_TRAIL_INTERVAL_MINUTES;
  return Array.from({ length: samples }, (_, index) => {
    const sample = new Date(date);
    sample.setHours(0, index * SHADOW_TRAIL_INTERVAL_MINUTES, 0, 0);
    return visualShadow(sample, location, heightMeters, utcOffsetHours);
  }).filter((segment): segment is ShadowSegment => segment !== undefined);
}
