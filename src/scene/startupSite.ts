import { PROPOSED_LULWORTH_CAMERA } from "../optics/camera";
import type { GeoPosition } from "./types";

/**
 * Where this build opens.
 *
 * Sun Arise opens on its Sydney demonstration scene. This build opens on the
 * site being evaluated, and both workflows share it: the house under analysis
 * and the camera under consideration stand on the same ground.
 *
 * The choice lives here, in one module, rather than spread through App, so
 * that Sun Arise changes can be merged in without quietly reinstating Sydney.
 * `startupSite.test.ts` fails if a merge ever does.
 *
 * The coordinate is not restated: it is the mount under evaluation, so the
 * proposal in `optics/camera` remains the only place it is written down.
 */

export interface StartupMount {
  /** Degrees clockwise from true north. */
  bearingDeg: number;
  /** Degrees below horizontal, positive down. */
  tiltDeg: number;
  /** Metres above sampled terrain, independent of the house. */
  mountHeightMeters: number;
}

export interface StartupSite {
  /** Shown in the panel heading, so it never hard-codes a place name. */
  name: string;
  /** Height is zero until terrain is sampled; nothing is mounted against it. */
  position: GeoPosition;
  mount: StartupMount;
}

export const STARTUP_SITE: StartupSite = {
  name: "Lulworth · Tasmania",
  position: {
    latitude: PROPOSED_LULWORTH_CAMERA.latitude,
    longitude: PROPOSED_LULWORTH_CAMERA.longitude,
    height: 0,
  },
  mount: {
    bearingDeg: PROPOSED_LULWORTH_CAMERA.bearingDeg,
    tiltDeg: PROPOSED_LULWORTH_CAMERA.tiltDeg,
    mountHeightMeters: PROPOSED_LULWORTH_CAMERA.mountHeightMeters,
  },
};
