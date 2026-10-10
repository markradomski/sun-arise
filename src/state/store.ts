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
import {
  DEFAULT_RESOLUTION_ID,
  DEFAULT_TARGET_SIZE_ID,
} from "../optics/projection";

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
  /** Point whose terrain line of sight from the camera is being analysed. */
  surfTarget: SightTarget | null;
  /** The next ground click places the sight-line target. */
  surfTargetArmed: boolean;
  /** Output format and reference object the framing estimates are made against. */
  capture: CaptureSettings;
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
  setSurfTarget(target: SightTarget | null): void;
  updateSurfTarget(patch: Partial<SightTarget>): void;
  armSurfTarget(armed: boolean): void;
  setCapture(patch: Partial<CaptureSettings>): void;
  setLookingThrough(looking: boolean): void;
}

/**
 * Planning inputs for the framing estimates. Not optics and not scene: they
 * say what camera is being imagined and what is being measured against it.
 */
export interface CaptureSettings {
  /** Id from `OUTPUT_RESOLUTIONS`. */
  resolutionId: string;
  /** Id from `TARGET_SIZES`, or `CUSTOM_TARGET_SIZE_ID`. */
  targetSizeId: string;
  customWidthMeters: number;
  customHeightMeters: number;
}

export const CUSTOM_TARGET_SIZE_ID = "custom";

/** Solar analysis and Surf Cam are separate workflows over one scene. */
export type AppMode = "SOLAR" | "SURF_CAM";

/**
 * A point the camera is being tested against — a spot in the bay, not a
 * second camera and not a scene object. It owns no model and never casts a
 * shadow, so it stays out of `objects` and out of solar analysis entirely.
 */
export interface SightTarget {
  /** Ground point; `height` is the sampled terrain elevation there. */
  ground: GeoPosition;
  /** Metres above that terrain, for a wave or an object rather than the seabed. */
  heightMeters: number;
}

export const MIN_TARGET_HEIGHT_METERS = 0;
export const MAX_TARGET_HEIGHT_METERS = 20;

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
  surfTarget: null,
  surfTargetArmed: false,
  capture: {
    resolutionId: DEFAULT_RESOLUTION_ID,
    targetSizeId: DEFAULT_TARGET_SIZE_ID,
    customWidthMeters: 2,
    customHeightMeters: 2,
  },
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
    // Leaving Surf Cam must not leave the navigation camera borrowed, nor a
    // click armed to place something Solar Analysis knows nothing about.
    set((state) => ({
      appMode: mode,
      surfCamArmed: mode === "SURF_CAM" ? state.surfCamArmed : false,
      surfTargetArmed: mode === "SURF_CAM" ? state.surfTargetArmed : false,
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
    // The two placement gestures compete for the same click, so arming one
    // disarms the other rather than letting the handler order decide.
    set(armed ? { surfCamArmed: true, surfTargetArmed: false } : { surfCamArmed: false });
  },

  setSurfTarget(target) {
    set({ surfTarget: target ? constrainTarget(target) : null });
  },

  updateSurfTarget(patch) {
    set((state) =>
      state.surfTarget
        ? { surfTarget: constrainTarget({ ...state.surfTarget, ...patch }) }
        : {},
    );
  },

  armSurfTarget(armed) {
    set(armed ? { surfTargetArmed: true, surfCamArmed: false } : { surfTargetArmed: false });
  },

  setCapture(patch) {
    set((state) => ({
      capture: {
        ...state.capture,
        ...patch,
        // A reference object with no size would divide the framing estimates
        // by zero and report an infinitely small footprint.
        customWidthMeters: Math.max(
          0.1,
          patch.customWidthMeters ?? state.capture.customWidthMeters,
        ),
        customHeightMeters: Math.max(
          0.1,
          patch.customHeightMeters ?? state.capture.customHeightMeters,
        ),
      },
    }));
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

function constrainTarget(target: SightTarget): SightTarget {
  const height = target.heightMeters;
  return {
    ...target,
    heightMeters: Number.isFinite(height)
      ? Math.min(MAX_TARGET_HEIGHT_METERS, Math.max(MIN_TARGET_HEIGHT_METERS, height))
      : MIN_TARGET_HEIGHT_METERS,
  };
}

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
