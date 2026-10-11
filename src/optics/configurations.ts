/**
 * Named starting points for the kind of camera being considered.
 *
 * These are **defaults, not constraints**. Choosing one sets a field of view
 * and nothing else; every camera stays fully adjustable afterwards, because
 * the point of the exercise is to find out what aim and framing the site
 * actually needs before anything is bought. A "fixed" configuration describes
 * the product you would end up buying, not a restriction on the planning tool.
 *
 * `nominalMinFovDeg` and `nominalMaxFovDeg` are what such a camera would
 * typically offer. They are shown to the user and deliberately do not clamp
 * the slider, which keeps its own global range.
 *
 * Nothing here names a manufacturer or a model. They are geometry.
 */

export type CameraKind = "FIXED" | "PTZ";

export interface CameraConfiguration {
  id: string;
  label: string;
  /** What this framing is for, in one line. */
  purpose: string;
  kind: CameraKind;
  /** Field of view applied when the configuration is chosen. */
  horizontalFovDeg: number;
  /** Indicative range for this class of camera. Not enforced. */
  nominalMinFovDeg: number;
  nominalMaxFovDeg: number;
  /** Zoom stops worth trying, for a camera that can be zoomed. */
  zoomPresetsDeg?: number[];
}

export const CAMERA_CONFIGURATIONS: CameraConfiguration[] = [
  {
    id: "wide-overview",
    label: "Wide overview",
    purpose: "General bay conditions in one frame.",
    kind: "FIXED",
    horizontalFovDeg: 80,
    nominalMinFovDeg: 80,
    nominalMaxFovDeg: 80,
  },
  {
    id: "medium-break",
    label: "Medium break",
    purpose: "Frames the main break.",
    kind: "FIXED",
    horizontalFovDeg: 35,
    nominalMinFovDeg: 35,
    nominalMaxFovDeg: 35,
  },
  {
    id: "tight-break",
    label: "Tight break",
    purpose: "Wave shape and breaking sections.",
    kind: "FIXED",
    horizontalFovDeg: 15,
    nominalMinFovDeg: 15,
    nominalMaxFovDeg: 15,
  },
  {
    id: "ptz",
    label: "PTZ exploration",
    purpose: "Pan, tilt and zoom to find what the site can reach.",
    kind: "PTZ",
    horizontalFovDeg: 45,
    nominalMinFovDeg: 5,
    nominalMaxFovDeg: 90,
    zoomPresetsDeg: [90, 45, 20, 10, 5],
  },
];

export const DEFAULT_CONFIGURATION_ID = "medium-break";

export function cameraConfiguration(id: string): CameraConfiguration | undefined {
  return CAMERA_CONFIGURATIONS.find((configuration) => configuration.id === id);
}

/** Formats a configuration's indicative range for display. */
export function nominalRangeLabel(configuration: CameraConfiguration): string {
  return configuration.nominalMinFovDeg === configuration.nominalMaxFovDeg
    ? `${configuration.horizontalFovDeg}° fixed`
    : `${configuration.nominalMinFovDeg}°–${configuration.nominalMaxFovDeg}° zoom`;
}
