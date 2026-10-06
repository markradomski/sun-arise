export type Season = "SUMMER" | "EQUINOX" | "WINTER";

export const SEASONS: Season[] = ["SUMMER", "EQUINOX", "WINTER"];

/**
 * Representative dates for seasonal comparison.
 *
 * Solstice dates drift by a day either side between years; these are the
 * nominal dates, which is the right resolution for comparing sun angle and day
 * length rather than for ephemeris work.
 */
const JUNE_SOLSTICE = { month: 5, day: 21 };
const DECEMBER_SOLSTICE = { month: 11, day: 21 };
const MARCH_EQUINOX = { month: 2, day: 20 };
const SEPTEMBER_EQUINOX = { month: 8, day: 22 };

export function isNorthern(latitude: number): boolean {
  return latitude >= 0;
}

/**
 * The civil date representing `season` at a site, as an instant at local noon
 * so the surrounding day is unambiguous whatever the UTC offset.
 */
export function seasonalDate(
  season: Season,
  latitude: number,
  year: number,
  utcOffsetHours: number,
): Date {
  const northern = isNorthern(latitude);
  const { month, day } = (() => {
    switch (season) {
      case "SUMMER":
        return northern ? JUNE_SOLSTICE : DECEMBER_SOLSTICE;
      case "WINTER":
        return northern ? DECEMBER_SOLSTICE : JUNE_SOLSTICE;
      case "EQUINOX":
        // Either equinox gives equal day length; each hemisphere takes its own
        // spring one so the label matches the season the site is entering.
        return northern ? MARCH_EQUINOX : SEPTEMBER_EQUINOX;
    }
  })();

  return new Date(Date.UTC(year, month, day, 12 - utcOffsetHours, 0, 0, 0));
}

export const SEASON_LABELS: Record<Season, string> = {
  SUMMER: "Summer",
  EQUINOX: "Equinox",
  WINTER: "Winter",
};
