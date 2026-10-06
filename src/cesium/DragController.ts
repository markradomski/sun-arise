import {
  Cartesian2,
  Cartographic,
  Math as CesiumMath,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Scene,
} from "cesium";
import type { SceneObject, TerrainStatus } from "../scene/types";
import { useSolarHouseStore } from "../state/store";
import type { SelectionOverlay } from "./SelectionOverlay";
import { loadedHeight } from "./terrain";

/**
 * All pointer interaction with scene objects.
 *
 * Gestures are resolved in priority order MANIPULATOR → SCENE OBJECT → GROUND
 * → CAMERA. Whichever target claims a pointerdown owns that pointer until it
 * is released or cancelled; unclaimed gestures are left entirely alone so
 * Cesium's own camera handling continues to work.
 *
 * Direct manipulation runs on native Pointer Events so mouse, touch and pen
 * share one path. Cesium's ScreenSpaceEventHandler is kept only for the
 * gestures it still owns: ground clicks and the two-finger pinch.
 */

/** Degrees of heading per pixel of horizontal travel while shift-dragging. */
const ROTATE_DEGREES_PER_PIXEL = 0.5;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

/**
 * Hit radius around the heading handle. Much larger than the drawn dot so the
 * control is reachable with a finger; sized for a ~44px target.
 */
const HANDLE_HIT_RADIUS_PX = 22;

/** Movement below this is a click rather than a drag. */
const CLICK_SLOP_PX = 4;

type GestureKind = "move" | "rotate";

interface Gesture {
  pointerId: number;
  kind: GestureKind;
  id: string;
  startHeading: number;
  /** Pointer angle around the object centre when the gesture began. */
  startAngle: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** Rotation that continues after the pointer is released, until confirmed. */
interface Latch {
  id: string;
  headingBeforeRotation: number;
  startAngle: number;
}

interface PinchState {
  id: string;
  startAngle: number;
  startHeading: number;
  startDistance: number;
  startScale: number;
}

export interface DragControllerOptions {
  scene: Scene;
  overlay: SelectionOverlay;
  getTerrainStatus: () => TerrainStatus;
  /** Fired for a click that did not land on a scene object. */
  onGroundClick?: (location: {
    latitude: number;
    longitude: number;
    height: number;
  }) => void;
  /** Fired once an object has finished moving, for full footprint analysis. */
  onPlacementSettled?: (id: string) => void;
}

export class DragController {
  private handler: ScreenSpaceEventHandler;
  private gesture: Gesture | null = null;
  private latch: Latch | null = null;
  private pinch: PinchState | null = null;
  private suppressNextGroundClick = false;

  constructor(private options: DragControllerOptions) {
    const canvas = options.scene.canvas;
    this.handler = new ScreenSpaceEventHandler(canvas);

    this.handler.setInputAction(
      (e: any) => this.onClick(e),
      ScreenSpaceEventType.LEFT_CLICK,
    );
    this.handler.setInputAction(
      (e: any) => this.onPinchStart(e),
      ScreenSpaceEventType.PINCH_START,
    );
    this.handler.setInputAction(
      (e: any) => this.onPinchMove(e),
      ScreenSpaceEventType.PINCH_MOVE,
    );
    this.handler.setInputAction(
      () => this.onPinchEnd(),
      ScreenSpaceEventType.PINCH_END,
    );

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.style.touchAction = "none";

    window.addEventListener("keydown", this.onKeyDown);
  }

  // ---------------------------------------------------------------- pointer

  private onPointerDown = (event: PointerEvent) => {
    if (this.gesture || event.button !== 0) return;

    const point = this.canvasPoint(event);
    const store = useSolarHouseStore.getState();

    if (this.latch) {
      this.suppressNextGroundClick = true;
      this.commitLatch();
      return;
    }

    const selected = store.selectedId ? store.objects[store.selectedId] : undefined;
    const onHandle = selected ? this.isOnHandle(point) : false;
    const object = onHandle ? selected : this.pickObject(point);

    // Set on every pointerdown rather than on release: a drag does not always
    // produce a trailing Cesium LEFT_CLICK, and a sticky flag would swallow the
    // next genuine ground click.
    this.suppressNextGroundClick = object !== undefined;
    if (!object) return;

    if (!onHandle) store.select(object.id);

    this.gesture = {
      pointerId: event.pointerId,
      kind: onHandle ? "rotate" : event.shiftKey ? "rotate" : "move",
      id: object.id,
      startHeading: object.rotation.heading,
      startAngle: this.pointerAngle(point) ?? 0,
      startX: point.x,
      startY: point.y,
      moved: false,
    };

    this.claimPointer(event);
  };

  private onPointerMove = (event: PointerEvent) => {
    const point = this.canvasPoint(event);

    if (!this.gesture && !this.latch) {
      this.options.scene.canvas.style.cursor = this.isOnHandle(point) ? "grab" : "";
    }

    if (this.latch) {
      this.applyRotation(
        this.latch.id,
        this.latch.startAngle,
        this.latch.headingBeforeRotation,
        point,
      );
      return;
    }

    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (
      !gesture.moved &&
      Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > CLICK_SLOP_PX
    ) {
      gesture.moved = true;
    }
    if (!gesture.moved) return;

    if (gesture.kind === "rotate") {
      if (event.shiftKey && !this.isOnHandle({ x: gesture.startX, y: gesture.startY })) {
        const heading = normaliseDegrees(
          gesture.startHeading + (point.x - gesture.startX) * ROTATE_DEGREES_PER_PIXEL,
        );
        this.setHeading(gesture.id, heading);
      } else {
        this.applyRotation(gesture.id, gesture.startAngle, gesture.startHeading, point);
      }
      return;
    }

    this.moveTo(gesture.id, point);
  };

  private onPointerUp = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    this.releasePointer(event);
    this.gesture = null;

    if (!gesture.moved) {
      // A tap on the handle latches rotation so it can continue without the
      // pointer being held down; a tap on the body is just a selection.
      if (this.isOnHandle({ x: gesture.startX, y: gesture.startY })) {
        this.beginLatch(
          gesture.id,
          gesture.startHeading,
          new Cartesian2(gesture.startX, gesture.startY),
        );
      }
      return;
    }

    this.options.onPlacementSettled?.(gesture.id);
  };

  private onPointerCancel = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.releasePointer(event);
    this.gesture = null;
    this.options.onPlacementSettled?.(gesture.id);
  };

  // ------------------------------------------------------------- manipulation

  private moveTo(id: string, point: Cartesian2) {
    const ground = this.pickGround(point);
    if (!ground) return;

    const store = useSolarHouseStore.getState();
    const object = store.objects[id];
    if (!object) return;

    // Only the resident-tile height during a drag; the full footprint sample
    // runs once on release. An unknown height keeps the previous elevation
    // rather than dropping the object to the ellipsoid.
    const height =
      loadedHeight(this.options.scene.globe, ground.latitude, ground.longitude) ??
      object.position.height;

    store.updateObject(id, {
      position: { latitude: ground.latitude, longitude: ground.longitude, height },
    });
  }

  /**
   * Heading follows the pointer's angle about the object's screen-space centre,
   * so the model turns the way the pointer turns regardless of camera heading.
   */
  private applyRotation(
    id: string,
    startAngle: number,
    startHeading: number,
    point: Cartesian2,
  ) {
    const angle = this.pointerAngle(point);
    if (angle === undefined) return;
    this.setHeading(id, normaliseDegrees(startHeading + (angle - startAngle)));
  }

  private setHeading(id: string, heading: number) {
    const store = useSolarHouseStore.getState();
    const object = store.objects[id];
    if (!object) return;
    store.updateObject(id, { rotation: { ...object.rotation, heading } });
  }

  /** Screen angle of a point about the selected object's centre, in degrees. */
  private pointerAngle(point: Cartesian2): number | undefined {
    const centre = this.options.overlay.centreWorldPosition();
    if (!centre) return undefined;
    const screen = SceneTransforms.worldToWindowCoordinates(
      this.options.scene,
      centre,
    );
    if (!screen) return undefined;
    return (Math.atan2(point.x - screen.x, -(point.y - screen.y)) * 180) / Math.PI;
  }

  private isOnHandle(point: { x: number; y: number }): boolean {
    const world = this.options.overlay.handleWorldPosition();
    if (!world) return false;
    const screen = SceneTransforms.worldToWindowCoordinates(
      this.options.scene,
      world,
    );
    if (!screen) return false;
    return Math.hypot(point.x - screen.x, point.y - screen.y) <= HANDLE_HIT_RADIUS_PX;
  }

  // ------------------------------------------------------------------- latch

  private beginLatch(id: string, heading: number, point: Cartesian2) {
    const angle = this.pointerAngle(point);
    if (angle === undefined) return;
    this.latch = { id, headingBeforeRotation: heading, startAngle: angle };
    this.options.overlay.setLatched(true);
    this.options.scene.screenSpaceCameraController.enableInputs = false;
  }

  private endLatch() {
    this.latch = null;
    this.options.overlay.setLatched(false);
    if (!this.gesture) {
      this.options.scene.screenSpaceCameraController.enableInputs = true;
    }
  }

  private commitLatch() {
    const latch = this.latch;
    this.endLatch();
    if (latch) this.options.onPlacementSettled?.(latch.id);
  }

  private cancelLatch() {
    const latch = this.latch;
    if (!latch) return;
    this.setHeading(latch.id, latch.headingBeforeRotation);
    this.endLatch();
  }

  // ------------------------------------------------------------- pointer grip

  private claimPointer(event: PointerEvent) {
    const canvas = this.options.scene.canvas;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is unavailable for some synthetic pointers; the gesture still
      // completes through the canvas listeners.
    }
    canvas.style.cursor = "grabbing";
    this.options.scene.screenSpaceCameraController.enableInputs = false;
    event.preventDefault();
  }

  private releasePointer(event: PointerEvent) {
    const canvas = this.options.scene.canvas;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Already released, or never captured.
    }
    canvas.style.cursor = "";
    if (!this.latch) {
      this.options.scene.screenSpaceCameraController.enableInputs = true;
    }
  }

  private onClick(event: any) {
    if (this.suppressNextGroundClick) {
      this.suppressNextGroundClick = false;
      return;
    }
    if (this.gesture || this.latch) return;

    const ground = this.pickGround(event.position);
    if (!ground) return;

    this.options.onGroundClick?.({
      latitude: ground.latitude,
      longitude: ground.longitude,
      height:
        loadedHeight(this.options.scene.globe, ground.latitude, ground.longitude) ?? 0,
    });
  }

  private canvasPoint(event: PointerEvent): Cartesian2 {
    const rect = this.options.scene.canvas.getBoundingClientRect();
    return new Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
  }

  // ------------------------------------------------------------------ touch

  private onPinchStart(event: any) {
    const store = useSolarHouseStore.getState();
    const id = store.selectedId;
    const object = id ? store.objects[id] : undefined;
    if (!id || !object) return;

    this.pinch = {
      id,
      startAngle: event.angleAndHeight.startPosition.x,
      startHeading: object.rotation.heading,
      startDistance: pinchDistance(event),
      startScale: object.scale,
    };
    this.options.scene.screenSpaceCameraController.enableInputs = false;
  }

  private onPinchMove(event: any) {
    const pinch = this.pinch;
    if (!pinch) return;

    const store = useSolarHouseStore.getState();
    const object = store.objects[pinch.id];
    if (!object) return;

    // Two-finger twist → heading. Not a native Cesium gesture; derived from
    // the angle carried on PINCH_MOVE.
    const deltaAngle = event.angleAndHeight.endPosition.x - pinch.startAngle;
    const heading = normaliseDegrees(
      pinch.startHeading + CesiumMath.toDegrees(deltaAngle),
    );

    // Pinch distance → uniform scale.
    const distance = pinchDistance(event);
    const ratio = pinch.startDistance > 0 ? distance / pinch.startDistance : 1;
    const scale = clamp(pinch.startScale * ratio, MIN_SCALE, MAX_SCALE);

    store.updateObject(pinch.id, {
      rotation: { ...object.rotation, heading },
      scale,
    });
  }

  private onPinchEnd() {
    this.pinch = null;
    this.options.scene.screenSpaceCameraController.enableInputs = true;
  }

  // --------------------------------------------------------------- keyboard

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    if (event.key === "Escape" && this.latch) {
      this.cancelLatch();
      return;
    }

    const store = useSolarHouseStore.getState();
    if (!store.selectedId) return;

    if (event.key === "Escape") {
      store.select(null);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.endLatch();
      store.removeObject(store.selectedId);
    }
  };

  /** Selection changes and deletions must not strand an active rotation. */
  onSelectionChanged(selectedId: string | null) {
    if (this.latch && this.latch.id !== selectedId) this.cancelLatch();
    if (this.gesture && this.gesture.id !== selectedId) {
      this.gesture = null;
      this.options.scene.screenSpaceCameraController.enableInputs = true;
    }
  }

  // ---------------------------------------------------------------- helpers

  private pickObject(windowPosition: Cartesian2 | any): SceneObject | undefined {
    const picked = this.options.scene.pick(windowPosition);
    const candidate = picked?.id as SceneObject | undefined;
    return candidate && typeof candidate === "object" && "type" in candidate
      ? candidate
      : undefined;
  }

  /**
   * Picks the terrain surface, deliberately ignoring primitives — otherwise the
   * dragged model's own roof is picked and the object walks away under the
   * cursor.
   */
  private pickGround(windowPosition: any) {
    const { scene } = this.options;
    const ray = scene.camera.getPickRay(windowPosition);
    const surface = ray ? scene.globe.pick(ray, scene) : undefined;

    // globe.pick misses while terrain tiles are still loading. Falling back to
    // the ellipsoid there would hand back a sea-level position indistinguishable
    // from a real one, so outside APPROXIMATE mode the gesture is dropped and
    // the caller keeps the position it already had.
    const cartesian =
      surface ??
      (this.options.getTerrainStatus() === "APPROXIMATE"
        ? scene.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid)
        : undefined);
    if (!cartesian) return undefined;

    const carto = Cartographic.fromCartesian(cartesian);
    return {
      latitude: CesiumMath.toDegrees(carto.latitude),
      longitude: CesiumMath.toDegrees(carto.longitude),
    };
  }


  destroy() {
    const canvas = this.options.scene.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerCancel);
    canvas.style.cursor = "";
    window.removeEventListener("keydown", this.onKeyDown);
    this.options.scene.screenSpaceCameraController.enableInputs = true;
    this.handler.destroy();
  }
}

function pinchDistance(event: any): number {
  const dx = event.distance.endPosition.x - event.distance.startPosition.x;
  const dy = event.distance.endPosition.y - event.distance.startPosition.y;
  return Math.hypot(dx, dy);
}

function normaliseDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
