import type { GeoPosition } from "../scene/types";
import { pointExposure, type BoxOccluder } from "./exposure";
import { seasonalDate, SEASONS, type Season } from "./seasons";
import { offsetHoursAt, timeZoneAt } from "./timezone";

export interface SeasonalPoint {
  season: Season;
  date: Date;
  daylightMinutes: number;
  directSunMinutes: number;
  directSunFraction: number;
}

/**
 * Direct sun at one location on each seasonal preset date.
 *
 * Evaluates the point three times rather than building three exposure fields:
 * a single point against a day of sun samples is cheap, and the grid is not
 * needed to answer a question about one place.
 *
 * Each season resolves its own UTC offset, because a site on daylight saving
 * sits at a different offset in summer than in winter.
 */
export function seasonalPointExposure(
  point: GeoPosition,
  occluders: BoxOccluder[],
  year: number,
): SeasonalPoint[] {
  const timeZone = timeZoneAt(point.latitude, point.longitude);

  return SEASONS.map((season) => {
    const approximate = seasonalDate(season, point.latitude, year, 0);
    const utcOffsetHours = offsetHoursAt(approximate, timeZone);
    const date = seasonalDate(season, point.latitude, year, utcOffsetHours);
    const exposure = pointExposure(point, occluders, date, { utcOffsetHours });

    return {
      season,
      date,
      daylightMinutes: exposure.daylightMinutes,
      directSunMinutes: exposure.directSunMinutes,
      directSunFraction: exposure.directSunFraction,
    };
  });
}
