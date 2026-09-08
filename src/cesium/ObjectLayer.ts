import {
  Cartesian3,
  HeadingPitchRoll,
  Math as CesiumMath,
  Model,
  ShadowMode,
  Transforms,
  type Scene,
} from "cesium";
import type { SceneObject } from "../scene/types";
import { entryForModelUrl } from "../houses/catalog";

/**
 * Renders SceneObject[] as Cesium model primitives.
 *
 * Reconciles by id rather than tearing down and rebuilding: a moved object gets
 * a new model matrix, not a reload. Only a changed `modelUrl` triggers a fetch.
 */
export class ObjectLayer {
  private models = new Map<string, Model>();
  /**
   * Per-object load token. React Strict Mode double-mounts and rapid placement
   * changes can both supersede an in-flight load; the token lets a stale load
   * discard itself on arrival.
   */
  private loadTokens = new Map<string, number>();
  private tokenCounter = 0;
  private destroyed = false;

  constructor(private scene: Scene) {}

  async sync(objects: SceneObject[]): Promise<void> {
    if (this.destroyed) return;

    const seen = new Set<string>();
    const pending: Promise<void>[] = [];

    for (const object of objects) {
      seen.add(object.id);
      const existing = this.models.get(object.id);

      if (existing) {
        const currentUrl = (existing.id as SceneObject | undefined)?.modelUrl;
        if (currentUrl === object.modelUrl) {
          this.applyTransform(existing, object);
          continue;
        }
        // Model swapped out from under this id — drop the old primitive.
        this.scene.primitives.remove(existing);
        this.models.delete(object.id);
      }

      pending.push(this.load(object));
    }

    for (const [id, model] of [...this.models]) {
      if (seen.has(id)) continue;
      this.scene.primitives.remove(model);
      this.models.delete(id);
      this.loadTokens.delete(id);
    }

    await Promise.all(pending);
  }

  getModel(id: string): Model | undefined {
    return this.models.get(id);
  }

  private async load(object: SceneObject): Promise<void> {
    const token = ++this.tokenCounter;
    this.loadTokens.set(object.id, token);

    let model: Model;
    try {
      model = await Model.fromGltfAsync({
        url: object.modelUrl,
        modelMatrix: modelMatrixFor(object),
        scale: scaleFor(object),
        shadows: ShadowMode.ENABLED,
        scene: this.scene,
      });
    } catch (error) {
      console.error(`[ObjectLayer] Failed to load ${object.modelUrl}`, error);
      return;
    }

    // The load may have been superseded (or the layer torn down) while awaiting.
    if (this.destroyed || this.loadTokens.get(object.id) !== token) {
      model.destroy();
      return;
    }

    // `id` is how scene.pick() hands the domain object back to the drag
    // controller in step 4. Keep it in sync on every transform.
    model.id = object;
    this.models.set(object.id, model);
    this.scene.primitives.add(model);
  }

  private applyTransform(model: Model, object: SceneObject): void {
    model.modelMatrix = modelMatrixFor(object);
    model.scale = scaleFor(object);
    model.id = object;
  }

  destroy(): void {
    this.destroyed = true;
    for (const model of this.models.values()) {
      this.scene.primitives.remove(model);
    }
    this.models.clear();
    this.loadTokens.clear();
  }
}

function modelMatrixFor(object: SceneObject) {
  const origin = Cartesian3.fromDegrees(
    object.position.longitude,
    object.position.latitude,
    object.position.height,
  );
  const hpr = new HeadingPitchRoll(
    CesiumMath.toRadians(object.rotation.heading),
    CesiumMath.toRadians(object.rotation.pitch),
    CesiumMath.toRadians(object.rotation.roll),
  );
  return Transforms.headingPitchRollToFixedFrame(origin, hpr);
}

/** Catalog base scale × the object's own multiplier. */
function scaleFor(object: SceneObject): number {
  const entry = entryForModelUrl(object.modelUrl);
  return (entry?.baseScale ?? 1) * object.scale;
}
