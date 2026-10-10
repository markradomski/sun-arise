import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  Color,
  Matrix4,
  PolygonHierarchy,
  Transforms,
  type Entity,
  type Viewer,
} from "cesium";
import {
  cameraElevationMeters,
  verticalFovDeg,
  type InstallationCamera,
} from "../optics/camera";
import { frustumGeometry, type EnuOffset } from "../optics/frustum";

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
  private centre = new Cartesian3();
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

    const geometry = frustumGeometry(
      {
        bearingDeg: camera.bearingDeg,
        tiltDeg: camera.tiltDeg,
        horizontalFovDeg: camera.horizontalFovDeg,
        verticalFovDeg: verticalFovDeg(camera.horizontalFovDeg),
      },
      DRAW_RANGE_METERS,
    );

    // East-north-up, not headingPitchRollToFixedFrame: the latter is also
    // built on ENU, so its local +X is east rather than the view direction,
    // and treating that axis as forward swings the drawn shape 90° off the
    // camera's bearing. The aim is already resolved into ENU by
    // `frustumGeometry`, leaving only a placement transform here.
    const frame = Transforms.eastNorthUpToFixedFrame(origin);
    const toWorld = (offset: EnuOffset) =>
      Matrix4.multiplyByPoint(
        frame,
        new Cartesian3(offset.east, offset.north, offset.up),
        new Cartesian3(),
      );

    this.corners = geometry.corners.map(toWorld);
    this.centre = toWorld(geometry.centre);
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
    if (this.corners.length === 0) return [];
    return [this.apex, this.centre];
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
