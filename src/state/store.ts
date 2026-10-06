import { create } from "zustand";
import {
  DEFAULT_ROTATION,
  nextObjectId,
  type CameraMode,
  type GeoPosition,
  type SceneObject,
} from "../scene/types";
import { catalogEntry, DEFAULT_HOUSE_SLUG } from "../houses/catalog";

export interface SolarHouseState {
  objects: Record<string, SceneObject>;
  /** Render/z order. Kept separate from `objects` so reordering is cheap. */
  order: string[];
  selectedId: string | null;
  cameraMode: CameraMode;
  site: { latitude: number; longitude: number } | null;

  addObject(object: Omit<SceneObject, "id">): string;
  addHouse(position: GeoPosition, slug?: string): string;
  updateObject(id: string, patch: Partial<Omit<SceneObject, "id">>): void;
  removeObject(id: string): void;
  select(id: string | null): void;
  setCameraMode(mode: CameraMode): void;
  setSite(site: { latitude: number; longitude: number } | null): void;
}

export const useSolarHouseStore = create<SolarHouseState>((set) => ({
  objects: {},
  order: [],
  selectedId: null,
  // Matches the view the app actually opens at; see CameraController.
  cameraMode: "SITE",
  site: null,

  addObject(object) {
    const id = nextObjectId(object.type);
    set((state) => ({
      objects: { ...state.objects, [id]: { ...object, id } },
      order: [...state.order, id],
      selectedId: id,
    }));
    return id;
  },

  addHouse(position, slug = DEFAULT_HOUSE_SLUG) {
    const entry = catalogEntry(slug);
    const id = nextObjectId(entry.type);
    const object: SceneObject = {
      id,
      type: entry.type,
      modelUrl: entry.modelUrl,
      position,
      rotation: { ...DEFAULT_ROTATION },
      scale: 1,
      clampToGround: true,
    };
    set((state) => ({
      objects: { ...state.objects, [id]: object },
      order: [...state.order, id],
      selectedId: id,
    }));
    return id;
  },

  updateObject(id, patch) {
    set((state) => {
      const existing = state.objects[id];
      if (!existing) return state;
      return {
        objects: {
          ...state.objects,
          [id]: {
            ...existing,
            ...patch,
            position: patch.position
              ? { ...existing.position, ...patch.position }
              : existing.position,
            rotation: patch.rotation
              ? { ...existing.rotation, ...patch.rotation }
              : existing.rotation,
          },
        },
      };
    });
  },

  removeObject(id) {
    set((state) => {
      if (!state.objects[id]) return state;
      const objects = { ...state.objects };
      delete objects[id];
      return {
        objects,
        order: state.order.filter((entry) => entry !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    });
  },

  select(id) {
    set({ selectedId: id });
  },

  setCameraMode(mode) {
    set({ cameraMode: mode });
  },

  setSite(site) {
    set({ site });
  },
}));

if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__solarHouseStore = useSolarHouseStore;
}

/** Ordered object list — the exact input the renderer's `sync()` expects. */
export function selectOrderedObjects(state: SolarHouseState): SceneObject[] {
  return state.order
    .map((id) => state.objects[id])
    .filter((object): object is SceneObject => object !== undefined);
}

export function selectSelectedObject(state: SolarHouseState): SceneObject | null {
  return state.selectedId ? state.objects[state.selectedId] ?? null : null;
}
