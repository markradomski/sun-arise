import { create } from "zustand";
import {
  DEFAULT_ROTATION,
  nextObjectId,
  type CameraMode,
  type GeoPosition,
  type SceneObject,
  type TerrainStatus,
} from "../scene/types";
import type { FootprintTerrain } from "../scene/terrainAnalysis";
import { catalogEntry, DEFAULT_HOUSE_SLUG } from "../houses/catalog";

export interface SolarHouseState {
  objects: Record<string, SceneObject>;
  /** Render/z order. Kept separate from `objects` so reordering is cheap. */
  order: string[];
  selectedId: string | null;
  cameraMode: CameraMode;
  site: { latitude: number; longitude: number } | null;
  terrainStatus: TerrainStatus;
  terrainProviderName: string;
  /** Footprint analysis per object; absent until terrain has been sampled. */
  terrain: Record<string, FootprintTerrain>;
  /** Exterior test point for direct-sun analysis. */
  probe: GeoPosition | null;
  /** The next ground click places the probe rather than a house. */
  probeArmed: boolean;

  addObject(object: Omit<SceneObject, "id">): string;
  addHouse(position: GeoPosition, slug?: string): string;
  updateObject(id: string, patch: Partial<Omit<SceneObject, "id">>): void;
  removeObject(id: string): void;
  select(id: string | null): void;
  setCameraMode(mode: CameraMode): void;
  setSite(site: { latitude: number; longitude: number } | null): void;
  setTerrainStatus(status: TerrainStatus, providerName?: string): void;
  setObjectTerrain(id: string, terrain: FootprintTerrain | null): void;
  setProbe(probe: GeoPosition | null): void;
  armProbe(armed: boolean): void;
}

export const useSolarHouseStore = create<SolarHouseState>((set) => ({
  objects: {},
  order: [],
  selectedId: null,
  // Matches the view the app actually opens at; see CameraController.
  cameraMode: "SITE",
  site: null,
  terrainStatus: "LOADING",
  terrainProviderName: "",
  terrain: {},
  probe: null,
  probeArmed: false,

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
      const terrain = { ...state.terrain };
      delete terrain[id];
      return {
        objects,
        terrain,
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

  setTerrainStatus(status, providerName) {
    set((state) => ({
      terrainStatus: status,
      terrainProviderName: providerName ?? state.terrainProviderName,
    }));
  },

  setProbe(probe) {
    set({ probe });
  },

  armProbe(armed) {
    set({ probeArmed: armed });
  },

  setObjectTerrain(id, terrain) {
    set((state) => {
      const next = { ...state.terrain };
      if (terrain) next[id] = terrain;
      else delete next[id];
      return { terrain: next };
    });
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
