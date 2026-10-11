import {
  Cartesian3,
  Cartographic,
  GeocodeType,
  IonGeocoderService,
  Rectangle,
  Math as CesiumMath,
  type Scene,
} from "cesium";
import type { LatLng } from "../scene/geo";
import { ionToken } from "./terrain";

/**
 * Address lookup through Cesium ion's geocoder.
 *
 * The Viewer is constructed with `geocoder: false` because the app has its own
 * UI, but the underlying service is still available and already authenticated
 * by the ion token, so this adds no dependency.
 */

export interface GeocodeMatch {
  displayName: string;
  position: LatLng;
  /** True when the service returned an area rather than a point. */
  approximate: boolean;
}

export type GeocodeOutcome =
  | { status: "OK"; matches: GeocodeMatch[] }
  | { status: "NO_MATCH" }
  | { status: "UNCONFIGURED" }
  | { status: "FAILED"; message: string };

export class Geocoder {
  private service: IonGeocoderService | null;

  constructor(scene: Scene) {
    this.service = ionToken() ? new IonGeocoderService({ scene }) : null;
  }

  /** Resolves an address. Never throws; failure is a value, not an exception. */
  async search(query: string): Promise<GeocodeOutcome> {
    if (!this.service) return { status: "UNCONFIGURED" };

    let results;
    try {
      results = await this.service.geocode(query, GeocodeType.SEARCH);
    } catch (error) {
      return {
        status: "FAILED",
        message: error instanceof Error ? error.message : "Geocoding failed.",
      };
    }

    const matches = results
      .map(toMatch)
      .filter((match): match is GeocodeMatch => match !== null);

    return matches.length > 0 ? { status: "OK", matches } : { status: "NO_MATCH" };
  }
}

/**
 * ion returns either a point or a bounding rectangle. A rectangle is an area —
 * a suburb or a street rather than a building — so its centre is flagged as
 * approximate rather than being presented as the address itself.
 */
function toMatch(result: {
  displayName: string;
  destination: Rectangle | Cartesian3;
}): GeocodeMatch | null {
  const { destination, displayName } = result;

  if (destination instanceof Rectangle) {
    const centre = Rectangle.center(destination);
    return {
      displayName,
      position: {
        latitude: CesiumMath.toDegrees(centre.latitude),
        longitude: CesiumMath.toDegrees(centre.longitude),
      },
      approximate: true,
    };
  }

  if (destination instanceof Cartesian3) {
    const carto = Cartographic.fromCartesian(destination);
    if (!carto) return null;
    return {
      displayName,
      position: {
        latitude: CesiumMath.toDegrees(carto.latitude),
        longitude: CesiumMath.toDegrees(carto.longitude),
      },
      approximate: false,
    };
  }

  return null;
}
