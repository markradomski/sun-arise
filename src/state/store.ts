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
import type { Season } from "../solar/seasons";
import type { FieldMode } from "../solar/fieldMode";
import { DEFAULT_OVERLAY_OPACITY } from "../cesium/HeatmapOverlay";
import type { BoxOccluder } from "../solar/exposure";
import type { InstallationCamera } from "../optics/camera";
import { constrainCamera } from "../optics/camera";
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
  fieldEnabled: boolean;
  /** What the sunlight overlay represents, independent of its visibility. */
  fieldMode: FieldMode;
  /** Master opacity of the sunlight overlay. Display only; never analytical. */
  fieldOpacity: number;
  /** Active seasonal preset, or null when analysing an arbitrary date. */
  season: Season | null;
  /**
   * House placement captured for comparison. Stores the placement rather than
   * a computed field, so the comparison stays valid when the date changes.
   */
  baseline: BoxOccluder[] | null;

  /** Which workflow the UI is in. Solar analysis is unaffected by Surf Cam. */
  appMode: AppMode;
  /** The virtual installation camera being designed, if one is placed. */
  surfCam: InstallationCamera | null;
  /** The next ground click places the surf camera's mount. */
  surfCamArmed: boolean;
  /** Set while the navigation camera is borrowed to look through the mount. */
  lookingThrough: boolean;

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
  setFieldEnabled(enabled: boolean): void;
  setFieldMode(mode: FieldMode): void;
  setFieldOpacity(opacity: number): void;
  setSeason(season: Season | null): void;
  setBaseline(baseline: BoxOccluder[] | null): void;
  setAppMode(mode: AppMode): void;
  setSurfCam(camera: InstallationCamera | null): void;
  updateSurfCam(patch: Partial<Omit<InstallationCamera, "id">>): void;
  armSurfCam(armed: boolean): void;
  setLookingThrough(looking: boolean): void;
}

/** Solar analysis and Surf Cam are separate workflows over one scene. */
export type AppMode = "SOLAR" | "SURF_CAM";

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
  fieldEnabled: false,
  fieldMode: "NOW",
  fieldOpacity: DEFAULT_OVERLAY_OPACITY,
  season: null,
  baseline: null,
  appMode: "SOLAR",
  surfCam: null,
  surfCamArmed: false,
  lookingThrough: false,

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

  setFieldEnabled(enabled) {
    set({ fieldEnabled: enabled });
  },

  setFieldMode(mode) {
    set({ fieldMode: mode });
  },

  setFieldOpacity(opacity) {
    set({ fieldOpacity: Math.min(1, Math.max(0.15, opacity)) });
  },

  setSeason(season) {
    set({ season });
  },

  setAppMode(mode) {
    // Leaving Surf Cam must not leave the navigation camera borrowed.
    set((state) => ({
      appMode: mode,
      surfCamArmed: mode === "SURF_CAM" ? state.surfCamArmed : false,
      lookingThrough: mode === "SURF_CAM" ? state.lookingThrough : false,
    }));
  },

  setSurfCam(camera) {
    set({ surfCam: camera ? constrainCamera(camera) : null });
  },

  updateSurfCam(patch) {
    set((state) =>
      state.surfCam
        ? { surfCam: constrainCamera({ ...state.surfCam, ...patch }) }
        : {},
    );
  },

  armSurfCam(armed) {
    set({ surfCamArmed: armed });
  },

  setLookingThrough(looking) {
    set({ lookingThrough: looking });
  },

  setBaseline(baseline) {
    set({ baseline });
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
