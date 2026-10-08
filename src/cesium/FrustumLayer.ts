import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  Color,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  PolygonHierarchy,
  Transforms,
  type Entity,
  type Viewer,
} from "cesium";
import {
  cameraElevationMeters,
  cesiumPitchDeg,
  verticalFovDeg,
  type InstallationCamera,
} from "../optics/camera";

/**
 * Draws the installation camera's field of view in the scene.
 *
 * Geometry is recomputed on the CPU when the camera changes, but the entities
 * are created once and read their positions through a `CallbackProperty`.
 * Dragging a slider therefore updates vertices rather than allocating new
 * primitives on every tick.
 *
 * The drawn pyramid is the *shape* of the view, cut off at a fixed range. It is
 * not a visibility claim: nothing here tests terrain, and the far face is an
 * arbitrary draw distance rather than anything the camera could resolve.
 */

/** How far down the view axis the frustum is drawn, in metres. */
const DRAW_RANGE_METERS = 400;

const EDGE_COLOR = Color.fromCssColorString("#ffd36a");
const FILL_COLOR = Color.fromCssColorString("#ffd36a").withAlpha(0.12);
const AXIS_COLOR = Color.fromCssColorString("#ffffff").withAlpha(0.85);

export class FrustumLayer {
  private corners: Cartesian3[] = [];
  private apex = new Cartesian3();
  private entities: Entity[] = [];
  private destroyed = false;

  constructor(private viewer: Viewer) {}

  /** Rebuilds the geometry for a new camera state, or hides it when null. */
  update(camera: InstallationCamera | null) {
    if (this.destroyed) return;

    if (!camera) {
      this.setVisible(false);
      return;
    }

    this.recompute(camera);
    if (this.entities.length === 0) this.build();
    this.setVisible(true);
  }

  private recompute(camera: InstallationCamera) {
    const origin = Cartesian3.fromDegrees(
      camera.ground.longitude,
      camera.ground.latitude,
      cameraElevationMeters(camera),
    );
    this.apex = origin;

    // An east-north-up frame at the mount lets the camera's own bearing and
    // tilt be applied directly, with no global-coordinate reasoning.
    const frame = Transforms.headingPitchRollToFixedFrame(
      origin,
      HeadingPitchRoll.fromDegrees(
        camera.bearingDeg,
        cesiumPitchDeg(camera.tiltDeg),
        0,
      ),
    );

    const halfH = CesiumMath.toRadians(camera.horizontalFovDeg / 2);
    const halfV = CesiumMath.toRadians(verticalFovDeg(camera.horizontalFovDeg) / 2);
    const spreadRight = Math.tan(halfH) * DRAW_RANGE_METERS;
    const spreadUp = Math.tan(halfV) * DRAW_RANGE_METERS;

    // In this frame x is forward, y is right and z is up.
    const localCorners: [number, number, number][] = [
      [DRAW_RANGE_METERS, -spreadRight, spreadUp],
      [DRAW_RANGE_METERS, spreadRight, spreadUp],
      [DRAW_RANGE_METERS, spreadRight, -spreadUp],
      [DRAW_RANGE_METERS, -spreadRight, -spreadUp],
    ];

    this.corners = localCorners.map(([forward, right, up]) =>
      Matrix4.multiplyByPoint(
        frame,
        new Cartesian3(forward, right, up),
        new Cartesian3(),
      ),
    );
  }

  private build() {
    this.entities.push(
      this.viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => this.edgePositions(), false),
          width: 1.5,
          material: EDGE_COLOR,
          // Straight lines through space; the default would drape them.
          arcType: ArcType.NONE,
        },
      }),
    );

    this.entities.push(
      this.viewer.entities.add({
        polygon: {
          hierarchy: new CallbackProperty(
            () => new PolygonHierarchy(this.corners),
            false,
          ),
          material: FILL_COLOR,
          perPositionHeight: true,
        },
      }),
    );

    this.entities.push(
      this.viewer.entities.add({
        polyline: {
          positions: new CallbackProperty(() => this.axisPositions(), false),
          width: 1,
          material: AXIS_COLOR,
          arcType: ArcType.NONE,
        },
      }),
    );
  }

  private edgePositions(): Cartesian3[] {
    const [a, b, c, d] = this.corners;
    if (!a || !b || !c || !d) return [];
    return [
      this.apex, a,
      this.apex, b,
      this.apex, c,
      this.apex, d,
      a, b,
      b, c,
      c, d,
      d, a,
    ];
  }

  private axisPositions(): Cartesian3[] {
    const [a, b, c, d] = this.corners;
    if (!a || !b || !c || !d) return [];
    const sum = Cartesian3.add(
      Cartesian3.add(a, c, new Cartesian3()),
      Cartesian3.add(b, d, new Cartesian3()),
      new Cartesian3(),
    );
    const centre = Cartesian3.multiplyByScalar(sum, 0.25, new Cartesian3());
    return [this.apex, centre];
  }

  private setVisible(visible: boolean) {
    for (const entity of this.entities) entity.show = visible;
  }

  destroy() {
    this.destroyed = true;
    for (const entity of this.entities) this.viewer.entities.remove(entity);
    this.entities = [];
  }
}
