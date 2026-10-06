import {
  CallbackProperty,
  Cartesian3,
  Color,
  HeightReference,
  type Entity,
  type Viewer,
} from "cesium";
import type { GeoPosition } from "../scene/types";

const PROBE_COLOR = Color.fromCssColorString("#ffd36a");

/** The exterior point whose direct-sun exposure is being analysed. */
export class ProbeMarker {
  private marker: Entity;
  private current: GeoPosition | null = null;

  constructor(private viewer: Viewer) {
    this.marker = viewer.entities.add({
      show: false,
      position: new CallbackProperty(() => this.position(), false) as never,
      point: {
        pixelSize: 11,
        color: PROBE_COLOR,
        outlineColor: Color.fromCssColorString("#05070a"),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  update(probe: GeoPosition | null) {
    this.current = probe;
    this.marker.show = probe !== null;
  }

  private position(): Cartesian3 | undefined {
    if (!this.current) return undefined;
    return Cartesian3.fromDegrees(
      this.current.longitude,
      this.current.latitude,
      this.current.height,
    );
  }

  destroy() {
    this.viewer.entities.remove(this.marker);
    this.current = null;
  }
}
