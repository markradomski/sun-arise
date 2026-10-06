import {
  Cartographic,
  KeyboardEventModifier,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Scene,
} from "cesium";
import type { SceneObject, TerrainStatus } from "../scene/types";
import { useSolarHouseStore } from "../state/store";
import { loadedHeight } from "./terrain";

/**
 * All pointer interaction with scene objects.
 *
 * Owns LEFT_CLICK too, so that clicking an object selects it rather than
 * teleporting it — CesiumScene deliberately has no input handling of its own.
 *
 * Couples to the store directly. That is the point of this class: it is the
 * bridge between Cesium's imperative event loop and application state.
 */

/** Degrees of heading per pixel of horizontal travel while shift-dragging. */
const ROTATE_DEGREES_PER_PIXEL = 0.5;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

type DragMode = "move" | "rotate";

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startHeading: number;
  moved: boolean;
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
  private drag: DragState | null = null;
  private pinch: PinchState | null = null;
  private destroyed = false;

  constructor(private options: DragControllerOptions) {
    this.handler = new ScreenSpaceEventHandler(options.scene.canvas);

    this.handler.setInputAction(
      (e: any) => this.onDown(e, "move"),
      ScreenSpaceEventType.LEFT_DOWN,
    );
    this.handler.setInputAction(
      (e: any) => this.onDown(e, "rotate"),
      ScreenSpaceEventType.LEFT_DOWN,
      KeyboardEventModifier.SHIFT,
    );

    this.handler.setInputAction(
      (e: any) => this.onMove(e),
      ScreenSpaceEventType.MOUSE_MOVE,
    );
    this.handler.setInputAction(
      (e: any) => this.onMove(e),
      ScreenSpaceEventType.MOUSE_MOVE,
      KeyboardEventModifier.SHIFT,
    );

    this.handler.setInputAction(() => this.onUp(), ScreenSpaceEventType.LEFT_UP);
    this.handler.setInputAction(
      () => this.onUp(),
      ScreenSpaceEventType.LEFT_UP,
      KeyboardEventModifier.SHIFT,
    );

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

    window.addEventListener("keydown", this.onKeyDown);
  }

  // ---------------------------------------------------------------- pointer

  private onDown(event: any, mode: DragMode) {
    const object = this.pickObject(event.position);
    if (!object) return;

    useSolarHouseStore.getState().select(object.id);

    this.drag = {
      id: object.id,
      mode,
      startX: event.position.x,
      startHeading: object.rotation.heading,
      moved: false,
    };

    // Without this the globe pans out from under the object being dragged.
    this.options.scene.screenSpaceCameraController.enableInputs = false;
  }

  private onMove(event: any) {
    const drag = this.drag;
    if (!drag) return;

    drag.moved = true;
    const store = useSolarHouseStore.getState();

    if (drag.mode === "rotate") {
      const deltaX = event.endPosition.x - drag.startX;
      const heading = normaliseDegrees(
        drag.startHeading + deltaX * ROTATE_DEGREES_PER_PIXEL,
      );
      const object = store.objects[drag.id];
      if (object) {
        store.updateObject(drag.id, { rotation: { ...object.rotation, heading } });
      }
      return;
    }

    const ground = this.pickGround(event.endPosition);
    if (!ground) return;

    const object = store.objects[drag.id];
    if (!object) return;

    // Only the resident-tile height during a drag; the full footprint sample
    // runs once on release. An unknown height keeps the previous elevation
    // rather than dropping the object to the ellipsoid.
    const height =
      loadedHeight(this.options.scene.globe, ground.latitude, ground.longitude) ??
      object.position.height;

    store.updateObject(drag.id, {
      position: { latitude: ground.latitude, longitude: ground.longitude, height },
    });
  }

  private onUp() {
    const drag = this.drag;
    this.drag = null;
    this.options.scene.screenSpaceCameraController.enableInputs = true;

    if (drag?.mode === "move" && drag.moved) {
      this.options.onPlacementSettled?.(drag.id);
    }
  }

  private onClick(event: any) {
    // A click that ended a drag is not a selection gesture.
    if (this.drag?.moved) return;

    const object = this.pickObject(event.position);
    if (object) {
      useSolarHouseStore.getState().select(object.id);
      return;
    }

    const ground = this.pickGround(event.position);
    if (!ground) return;

    this.options.onGroundClick?.({
      latitude: ground.latitude,
      longitude: ground.longitude,
      height:
        loadedHeight(this.options.scene.globe, ground.latitude, ground.longitude) ?? 0,
    });
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

    const store = useSolarHouseStore.getState();
    if (!store.selectedId) return;

    if (event.key === "Escape") {
      store.select(null);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      store.removeObject(store.selectedId);
    }
  };

  // ---------------------------------------------------------------- helpers

  private pickObject(windowPosition: any): SceneObject | undefined {
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
    this.destroyed = true;
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
