import { useEffect, useMemo, useRef, useState } from "react";
import { Cartesian3, Math as CesiumMath, PerspectiveFrustum } from "cesium";
import {
  CameraController,
  DEFAULT_CAMERA_MODE,
  type CameraMode,
} from "./cesium/CameraController";
import { CesiumScene } from "./cesium/CesiumScene";
import { DragController } from "./cesium/DragController";
import { ObjectLayer } from "./cesium/ObjectLayer";
import { SelectionOverlay } from "./cesium/SelectionOverlay";
import { loadedHeight, sampleElevations } from "./cesium/terrain";
import { ProbeMarker } from "./cesium/ProbeMarker";
import { TerrainSampler } from "./cesium/TerrainSampler";
import { SolarClock } from "./solar/SolarClock";
import { solarPosition } from "./solar/solarPosition";
import {
  civilParts,
  civilZone,
  withCivilDate,
  withCivilMinutes,
} from "./solar/timezone";
import { seasonalDate } from "./solar/seasons";
import { seasonalPointExposure } from "./solar/seasonalComparison";
import { pointExposure, sunTimeline } from "./solar/exposure";
import {
  areaAboveHours,
  exposureField,
  meanMinutes,
  type ExposureField,
} from "./solar/exposureField";
import { DEFAULT_GRID, groundGrid, type Grid } from "./scene/grid";
import { fieldBounds } from "./scene/fieldBounds";
import { fieldSignature } from "./scene/fieldSignature";
import {
  instantField,
  instantPoint,
  type InstantField,
} from "./solar/instantField";
import { instantColour, instantOpacity } from "./solar/instantRamp";
import { instantMatchesField } from "./scene/overlayPairing";
import { FrustumLayer } from "./cesium/FrustumLayer";
import { SightLineLayer } from "./cesium/SightLineLayer";
import { CesiumTerrainProfiler } from "./cesium/TerrainProfiler";
import {
  SightLineAnalyser,
  type SightLineState,
} from "./optics/sightLineAnalyser";
import { Geocoder } from "./cesium/geocode";
import LocationSearch, {
  type ResolvedLocation,
} from "./components/LocationSearch";
import SurfCamPanel from "./components/SurfCamPanel";
import {
  cameraElevationMeters,
  cesiumPitchDeg,
  createCamera,
  type InstallationCamera,
} from "./optics/camera";
import { classifyQuery } from "./scene/location";
import { colourForMinutes, opacityForMinutes } from "./solar/exposureRamp";
import { eastNorthOffset } from "./scene/geo";
import { HeatmapOverlay } from "./cesium/HeatmapOverlay";
import { occluderFor } from "./scene/occluders";
import { terrainPolicyFor, type GeoPosition } from "./scene/types";
import { STARTUP_SITE } from "./scene/startupSite";
import { cesiumFrustumFovDeg } from "./optics/viewfinder";
import {
  aimAtTarget,
  outputResolution,
  sensorAspect,
  targetSize,
} from "./optics/projection";
import { compareLenses, frameTarget } from "./optics/framing";
import { analyseSightLine, type SightLineAnalysis } from "./optics/sightLine";
import ViewfinderOverlay from "./components/ViewfinderOverlay";
import {
  selectOrderedObjects,
  selectSelectedObject,
  useSolarHouseStore,
} from "./state/store";
import Controls from "./components/Controls";
import TerrainDiagnostics from "./components/TerrainDiagnostics";
import ExposurePanel from "./components/ExposurePanel";

// Now, not noon: NOW mode opens on the real moment at the site, and the clock
// is a true instant so the browser's own timezone never enters into it.
/** Milliseconds between NOW repaints while the clock is moving. */
const INSTANT_INTERVAL_MS = 180;

const INITIAL_DATE = new Date();

const INITIAL_SITE = STARTUP_SITE.position;

/** Cesium's own default, restored when the planned lens is handed back. */
const DEFAULT_NAVIGATION_FOV_RADIANS = CesiumMath.toRadians(60);

function geocodeMessage(status: string, query: string): string {
  switch (status) {
    case "NO_MATCH":
      return `No match for "${query}". Try a coordinate pair, or a less specific address.`;
    case "UNCONFIGURED":
      return "Address search needs a Cesium ion token. Coordinates still work.";
    default:
      return "Address search failed. Check the connection, or enter coordinates.";
  }
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CesiumScene | null>(null);
  const layerRef = useRef<ObjectLayer | null>(null);
  const dragRef = useRef<DragController | null>(null);
  const overlayRef = useRef<SelectionOverlay | null>(null);
  const cameraRef = useRef<CameraController | null>(null);
  const settleRef = useRef<((id: string) => Promise<void>) | null>(null);
  const fieldOverlayRef = useRef<HeatmapOverlay | null>(null);
  /** Whether the heatmap's imagery layer has been attached to the globe yet. */
  const overlayAttachedRef = useRef(false);
  const lastInstantRef = useRef(0);
  /** Guards the one-time camera placement so it never reruns. */
  const surfCamSeededRef = useRef(false);
  const frustumRef = useRef<FrustumLayer | null>(null);
  const sightLineLayerRef = useRef<SightLineLayer | null>(null);
  const sightLineAnalyserRef = useRef<SightLineAnalyser | null>(null);
  const geocoderRef = useRef<Geocoder | null>(null);
  /** Identifies the newest location lookup so a slow one cannot overwrite it. */
  const locationTokenRef = useRef(0);
  /** Inputs the current instantaneous field was computed from. */
  const instantKeyRef = useRef("");
  /** What the overlay image currently shows. */
  const paintedKeyRef = useRef("");

  const [date, setDate] = useState(INITIAL_DATE);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [cameraMode, setCameraMode] = useState<CameraMode>(DEFAULT_CAMERA_MODE);

  const selected = useSolarHouseStore(selectSelectedObject);
  const site = useSolarHouseStore((s) => s.site);
  const probe = useSolarHouseStore((s) => s.probe);
  const probeArmed = useSolarHouseStore((s) => s.probeArmed);
  const objects = useSolarHouseStore((s) => s.objects);
  const fieldEnabled = useSolarHouseStore((s) => s.fieldEnabled);
  const fieldMode = useSolarHouseStore((s) => s.fieldMode);
  const fieldOpacity = useSolarHouseStore((s) => s.fieldOpacity);
  const season = useSolarHouseStore((s) => s.season);
  const baseline = useSolarHouseStore((s) => s.baseline);
  const terrainResults = useSolarHouseStore((s) => s.terrain);
  const appMode = useSolarHouseStore((s) => s.appMode);
  const surfCam = useSolarHouseStore((s) => s.surfCam);
  const surfCamArmed = useSolarHouseStore((s) => s.surfCamArmed);
  const surfTarget = useSolarHouseStore((s) => s.surfTarget);
  const surfTargetArmed = useSolarHouseStore((s) => s.surfTargetArmed);
  const capture = useSolarHouseStore((s) => s.capture);
  const savedMounts = useSolarHouseStore((s) => s.savedMounts);
  const terrainStatus = useSolarHouseStore((s) => s.terrainStatus);
  const configurationId = useSolarHouseStore((s) => s.cameraConfigurationId);
  const [mountSightLines, setMountSightLines] = useState<Record<string, SightLineAnalysis | "PENDING" | "FAILED">>({});
  const [frustumVisible, setFrustumVisible] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);

  /** The reference object the pixel estimates are measured against. */
  const referenceObject = (() => {
    const preset = targetSize(capture.targetSizeId);
    return preset
      ? { widthMeters: preset.widthMeters, heightMeters: preset.heightMeters }
      : {
          widthMeters: capture.customWidthMeters,
          heightMeters: capture.customHeightMeters,
        };
  })();

  /**
   * One framing result for the panel, the comparison table and the overlay.
   * Cheap arithmetic over a handful of vectors, so it is recomputed with the
   * render rather than cached behind a signature.
   */
  const framing =
    surfCam && surfTarget
      ? frameTarget(surfCam, surfTarget, capture.resolutionId, referenceObject)
      : null;
  useEffect(() => {
    let cancelled = false;
    if (!surfTarget || terrainStatus !== "READY" || savedMounts.length === 0) {
      setMountSightLines({});
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const profiler = new CesiumTerrainProfiler(
      () => scene.getTerrainProvider(),
      sampleElevations,
    );
    setMountSightLines(Object.fromEntries(savedMounts.map((mount) => [mount.id, "PENDING"])));
    for (const mount of savedMounts) {
      void profiler.profile(mount.ground, surfTarget.ground).then((profile) => {
        if (cancelled) return;
        const first = profile.samples[0]?.terrainElevationMeters;
        const last = profile.samples[profile.samples.length - 1]?.terrainElevationMeters;
        const result = analyseSightLine(profile, {
          position: mount.ground,
          terrainElevationMeters: first ?? mount.ground.height,
          heightMeters: mount.mountHeightMeters,
        }, {
          position: surfTarget.ground,
          terrainElevationMeters: last ?? surfTarget.ground.height,
          heightMeters: surfTarget.heightMeters,
        });
        setMountSightLines((previous) => ({ ...previous, [mount.id]: result }));
      }).catch(() => {
        if (!cancelled) setMountSightLines((previous) => ({ ...previous, [mount.id]: "FAILED" }));
      });
    }
    return () => { cancelled = true; };
  }, [savedMounts, surfTarget, terrainStatus]);

  const lookingThrough = useSolarHouseStore((s) => s.lookingThrough);
  const [sightLine, setSightLine] = useState<SightLineState>({
    status: "IDLE",
  });
  const [located, setLocated] = useState<ResolvedLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [fieldPending, setFieldPending] = useState(false);
  const [instant, setInstant] = useState<{
    result: InstantField;
    /** The field signature this was computed over; see overlayPairing. */
    forSignature: string;
    pointCount: number;
  } | null>(null);
  const [field, setField] = useState<{
    grid: Grid;
    result: ExposureField;
    baseline: ExposureField | null;
    overlayMs: number;
    /** Inputs this field was computed from, so it can be reused or retired. */
    signature: string;
    /** True when the houses are spread wider than the sample budget allows. */
    clipped: boolean;
  } | null>(null);
  const addHouse = useSolarHouseStore((s) => s.addHouse);
  const updateObject = useSolarHouseStore((s) => s.updateObject);

  const clock = useMemo(() => new SolarClock(INITIAL_DATE), []);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new CesiumScene(containerRef.current);
    const layer = new ObjectLayer(scene.scene);
    sceneRef.current = scene;
    layerRef.current = layer;

    if (import.meta.env.DEV) {
      Object.assign(globalThis, {
        __solarHouseScene: scene,
        __solarHouseLayer: layer,
      });
    }

    let disposed = false;

    // Store is the source of truth; the layer reconciles against it.
    let lastSelectedId = useSolarHouseStore.getState().selectedId;
    const unsubscribeStore = useSolarHouseStore.subscribe((state) => {
      layer.sync(selectOrderedObjects(state)).catch(console.error);
      if (state.selectedId !== lastSelectedId) {
        lastSelectedId = state.selectedId;
        dragRef.current?.onSelectionChanged(state.selectedId);
      }
    });

    const unsubscribeClock = clock.subscribe((state) => {
      setDate(state.date);
      setPlaying(state.playing);
      scene.setDate(state.date);
    });

    const overlay = new SelectionOverlay(scene.viewer);
    overlayRef.current = overlay;

    // Driven per-frame so the ring tracks a drag without the store
    // subscription having to re-run the whole render path.
    const stopOverlay = scene.viewer.scene.postUpdate.addEventListener(() => {
      const state = useSolarHouseStore.getState();
      overlay.update(selectSelectedObject(state));
    });

    const camera = new CameraController(scene.viewer);
    cameraRef.current = camera;

    if (import.meta.env.DEV) {
      Object.assign(globalThis, { __solarHouseCamera: camera });
    }

    // Objects whose initial terrain placement has been attempted, whatever the
    // outcome. Framing waits on this: a house placed before terrain resolves
    // sits at ellipsoid height, and framing that elevation leaves the camera
    // near ground level while the house rises out of shot once terrain lands.
    const placementResolved = new Set<string>();

    // Open at SITE rather than in orbit, set directly — no fly-from-space.
    let framed = false;
    const stopInitialFraming = scene.viewer.scene.postRender.addEventListener(
      () => {
        if (framed || disposed) return;
        const state = useSolarHouseStore.getState();
        const first = state.order[0]
          ? state.objects[state.order[0]]
          : undefined;
        if (!first || !layer.isReady(first.id)) return;
        if (!placementResolved.has(first.id)) return;

        camera.setTo(DEFAULT_CAMERA_MODE, first.position);
        framed = true;
        stopInitialFraming();
      },
    );

    const sampler = new TerrainSampler(
      () => scene.getTerrainProvider(),
      () => useSolarHouseStore.getState().terrainStatus,
    );

    async function settlePlacement(id: string) {
      if (disposed) return;
      try {
        const object = useSolarHouseStore.getState().objects[id];
        if (!object?.clampToGround) return;

        const terrain = await sampler.analyse(object);
        if (disposed || !terrain) return;

        const store = useSolarHouseStore.getState();
        store.setObjectTerrain(id, terrain);

        // Houses sit level; only the elevation follows the ground.
        const current = store.objects[id];
        if (!current || terrainPolicyFor(current.type) !== "LEVEL") return;
        store.updateObject(id, {
          position: { ...current.position, height: terrain.levelElevation },
        });
      } finally {
        placementResolved.add(id);
      }
    }

    /** The probe must sit on the real surface, not the ellipsoid. */
    async function settleProbe(location: GeoPosition) {
      const provider = scene.getTerrainProvider();
      const store = useSolarHouseStore.getState();
      if (!provider || store.terrainStatus !== "READY" || disposed) return;

      const [height] = await sampleElevations(provider, [location]);
      if (disposed || height === undefined) return;

      const current = useSolarHouseStore.getState().probe;
      if (!current) return;
      if (
        current.latitude !== location.latitude ||
        current.longitude !== location.longitude
      ) {
        return;
      }
      useSolarHouseStore.getState().setProbe({ ...location, height });
    }

    /**
     * Resamples the target's ground elevation at full detail. The click gives
     * whatever the loaded tile happened to say, which at a distant, coarsely
     * loaded part of the bay can be metres out.
     */
    async function settleTarget(location: GeoPosition) {
      const provider = scene.getTerrainProvider();
      const store = useSolarHouseStore.getState();
      if (!provider || store.terrainStatus !== "READY" || disposed) return;

      const [height] = await sampleElevations(provider, [location]);
      if (disposed || height === undefined) return;

      // A target placed again while this was in flight owns the scene now.
      const current = useSolarHouseStore.getState().surfTarget;
      if (
        !current ||
        current.ground.latitude !== location.latitude ||
        current.ground.longitude !== location.longitude
      ) {
        return;
      }
      useSolarHouseStore
        .getState()
        .updateSurfTarget({ ground: { ...location, height } });
    }

    const fieldOverlay = new HeatmapOverlay(scene.viewer);
    fieldOverlayRef.current = fieldOverlay;

    const frustum = new FrustumLayer(scene.viewer);
    frustumRef.current = frustum;
    geocoderRef.current = new Geocoder(scene.scene);

    const sightLineLayer = new SightLineLayer(scene.viewer);
    sightLineLayerRef.current = sightLineLayer;
    sightLineAnalyserRef.current = new SightLineAnalyser({
      profiler: new CesiumTerrainProfiler(
        () => scene.getTerrainProvider(),
        sampleElevations,
      ),
      onState: setSightLine,
    });

    const probeMarker = new ProbeMarker(scene.viewer);
    const stopProbe = scene.viewer.scene.postUpdate.addEventListener(() => {
      probeMarker.update(useSolarHouseStore.getState().probe);
    });

    settleRef.current = settlePlacement;

    const drag = new DragController({
      scene: scene.scene,
      overlay,
      getTerrainStatus: () => useSolarHouseStore.getState().terrainStatus,
      onGroundClick: (location) => {
        const store = useSolarHouseStore.getState();

        if (store.surfCamArmed) {
          // A camera the user places is their own, so it keeps their angles
          // but not the label describing the proposal.
          store.setSurfCam(
            createCamera("surf-cam-1", location, {
              ...(store.surfCam ?? {}),
              label: "Camera 1",
            }),
          );
          store.armSurfCam(false);
          return;
        }

        if (store.surfTargetArmed) {
          // The click gives a ground point at the globe's current level of
          // detail; the precise elevation is resampled before it is analysed.
          store.setSurfTarget({ ground: location, heightMeters: 0 });
          store.armSurfTarget(false);
          void settleTarget(location);
          return;
        }

        // Surf Cam borrows the scene but must not place or move houses.
        if (store.appMode === "SURF_CAM") return;

        if (store.probeArmed) {
          store.setProbe(location);
          store.armProbe(false);
          void settleProbe(location);
          return;
        }

        store.setSite({
          latitude: location.latitude,
          longitude: location.longitude,
        });

        // Move the selected house if there is one, otherwise drop a new one.
        const id = store.selectedId ?? store.addHouse(location);
        if (store.selectedId) store.updateObject(id, { position: location });

        void settlePlacement(id);
      },
      onPlacementSettled: (id) => void settlePlacement(id),
    });
    dragRef.current = drag;

    scene
      .initTerrain()
      .then(({ status, providerName }) => {
        if (disposed) return;
        useSolarHouseStore.getState().setTerrainStatus(status, providerName);
        for (const id of useSolarHouseStore.getState().order)
          void settlePlacement(id);
      })
      .catch((error) => {
        console.error(error);
        if (!disposed) {
          useSolarHouseStore
            .getState()
            .setTerrainStatus("UNAVAILABLE", "terrain initialisation failed");
          for (const id of useSolarHouseStore.getState().order)
            void settlePlacement(id);
        }
      });

    // Strict Mode remounts this effect with the store already populated, so
    // seed only once and always sync the fresh layer against current state.
    const store = useSolarHouseStore.getState();
    if (store.order.length === 0) {
      store.setSite({
        latitude: INITIAL_SITE.latitude,
        longitude: INITIAL_SITE.longitude,
      });
      store.addHouse(INITIAL_SITE);
    } else {
      layer.sync(selectOrderedObjects(store)).catch(console.error);
    }

    return () => {
      disposed = true;
      unsubscribeStore();
      unsubscribeClock();
      stopOverlay();
      stopProbe();
      probeMarker.destroy();
      fieldOverlay.destroy();
      fieldOverlayRef.current = null;
      frustum.destroy();
      frustumRef.current = null;
      sightLineLayer.destroy();
      sightLineLayerRef.current = null;
      sightLineAnalyserRef.current?.dispose();
      sightLineAnalyserRef.current = null;
      geocoderRef.current = null;
      stopInitialFraming();
      drag.destroy();
      sampler.dispose();
      overlay.destroy();
      layer.destroy();
      scene.destroy();
      sceneRef.current = null;
      layerRef.current = null;
      dragRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Shadows are rendered by Cesium's shadow map from the real model geometry;
  // the sun-ray polylines that used to be drawn here were removed because they
  // did not convey sunlight vs shade any better than the cast shadow itself.
  // Falls back to the current site rather than the initial one, so civil time
  // and sun position still follow the map after the selection is cleared.
  const sunOrigin =
    selected?.position ?? (site ? { ...site, height: 0 } : INITIAL_SITE);

  // Civil time follows the *site*, not the browser. The clock stores an
  // absolute instant; everything shown to the user is that instant expressed
  // in the selected location's zone, DST included.
  const zone = useMemo(
    () => civilZone(date, sunOrigin.latitude, sunOrigin.longitude),
    [date, sunOrigin.latitude, sunOrigin.longitude],
  );

  const solar = solarPosition(
    date,
    sunOrigin.latitude,
    sunOrigin.longitude,
    zone.offsetHours,
  );

  const civilDay = `${zone.timeZone}:${selectedDayKey(date, zone.offsetHours)}`;
  const exposure = useMemo(() => {
    if (!probe) return null;
    const occluders = Object.values(objects)
      .filter((object) => object.type === "house")
      .map(occluderFor);
    return pointExposure(probe, occluders, date, {
      utcOffsetHours: zone.offsetHours,
    });
    // Keyed on the civil date rather than `date` itself: this is a whole-day
    // result, and the clock ticks every frame while the simulation plays.
  }, [probe, objects, civilDay, zone.offsetHours]);

  // Follows the clock rather than the civil day, so the inspected point reports
  // the same instant the shadows are drawn at.
  const instantProbe = useMemo(() => {
    if (!probe) return null;
    const occluders = Object.values(objects)
      .filter((object) => object.type === "house")
      .map(occluderFor);
    return instantPoint(probe, occluders, probe, date, {
      utcOffsetHours: zone.offsetHours,
    });
  }, [probe, objects, date, zone.offsetHours]);

  const baselinePositions = useMemo(
    () => (baseline ?? []).map((occluder) => occluder.position),
    [baseline],
  );

  const houseList = useMemo(
    () => Object.values(objects).filter((object) => object.type === "house"),
    [objects],
  );

  // Keyed on the inputs that actually change the field. Camera movement and
  // clock ticks within the same civil day deliberately do not recompute it.
  const signature = fieldSignature({
    houses: houseList,
    baseline,
    civilDay,
    utcOffsetHours: zone.offsetHours,
  });

  useEffect(() => {
    fieldOverlayRef.current?.setVisible(fieldEnabled);
  }, [fieldEnabled]);

  // Opacity is a blend factor on the drawn layer. Deliberately its own effect,
  // touching nothing the field computation depends on.
  useEffect(() => {
    fieldOverlayRef.current?.setOpacity(fieldOpacity);
  }, [fieldOpacity]);

  useEffect(() => {
    const scene = sceneRef.current;
    const overlay = fieldOverlayRef.current;
    if (!scene || !overlay) return;

    if (houseList.length === 0) {
      overlay.clear();
      setField(null);
      setFieldPending(false);
      overlayAttachedRef.current = false;
      return;
    }

    if (field?.signature === signature) return;

    // Hiding the map keeps the computed field, so showing it again is free.
    // A field computed from inputs that have since changed is retired instead,
    // rather than left on screen describing a placement that no longer exists.
    if (!fieldEnabled) {
      setField((current) =>
        current?.signature === signature ? current : null,
      );
      setFieldPending(false);
      // Attaching an imagery layer makes Cesium rebuild the tiles it covers.
      // Doing that once during initial load, while the globe is still
      // streaming anyway, leaves the first Show a change of alpha only.
      //
      // It waits for footprint analysis, because that is what settles each
      // house onto the terrain. Prewarming first would compute a field for a
      // height the house is about to leave, and the first Show would have to
      // rebuild the layer after all.
      const placementSettled = houseList.every((h) => terrainResults[h.id]);
      if (overlayAttachedRef.current || !placementSettled) return;
    }

    let cancelled = false;
    if (fieldEnabled) setFieldPending(true);
    // Coverage follows the houses rather than sitting on the first one, and
    // takes in the saved baseline placement too, so both arrangements are
    // measured over identical ground and the comparison stays like for like.
    const bounds = fieldBounds(houseList, baselinePositions, {
      spacingMeters: DEFAULT_GRID.spacingMeters,
    });
    if (!bounds) return;

    (async () => {
      const grid = groundGrid({
        centre: bounds.centre,
        extentMeters: bounds.extentEastMeters,
        extentNorthMeters: bounds.extentNorthMeters,
        spacingMeters: DEFAULT_GRID.spacingMeters,
      });
      const provider = scene.getTerrainProvider();
      const status = useSolarHouseStore.getState().terrainStatus;

      // Ground height for samples terrain cannot resolve, and for the whole
      // field when there is no real terrain: the first house's own elevation
      // rather than a guess at sea level.
      const fallbackHeight = houseList[0].position.height;

      if (provider && status === "READY") {
        const heights = await sampleElevations(
          provider,
          grid.points.map((p) => p.position),
        );
        if (cancelled) return;
        grid.points.forEach((point, index) => {
          point.position.height = heights[index] ?? fallbackHeight;
        });
      } else {
        for (const point of grid.points) point.position.height = fallbackHeight;
      }

      const positions = grid.points.map((p) => p.position);
      // Sun position is taken at the field centre; across even a few hundred
      // metres it varies by far less than the sampling interval resolves.
      const timeline = sunTimeline(bounds.centre, date, {
        utcOffsetHours: zone.offsetHours,
      });
      const result = exposureField(
        positions,
        houseList.map(occluderFor),
        timeline,
      );
      // Recomputed against the active timeline rather than stored, so a date or
      // season change moves both sides together.
      const baselineResult = baseline
        ? exposureField(positions, baseline, timeline)
        : null;
      if (cancelled) return;

      setField({
        grid,
        result,
        baseline: baselineResult,
        overlayMs: overlay.lastUpdateMs,
        signature,
        clipped: bounds.clamped,
      });
      setFieldPending(false);
    })().catch(console.error);

    return () => {
      cancelled = true;
    };
    // `date` is intentionally absent: civilDay captures the only part that matters.
  }, [
    fieldEnabled,
    signature,
    field?.signature,
    houseList,
    baseline,
    date,
    zone.offsetHours,
    terrainResults,
  ]);

  // NOW evaluates the grid against one sun position, so it is cheap enough to
  // follow the clock. It is still throttled: the cost is the repaint, not the
  // occlusion tests, and the shadow animation reads fine at this cadence.
  const instantKey = `${fieldMode}|${field?.signature ?? "none"}|${date.getTime()}`;

  useEffect(() => {
    if (fieldMode !== "NOW" || !field) {
      setInstant(null);
      instantKeyRef.current = "";
      return;
    }

    // Nothing to redraw while the map is hidden, beyond the one computation
    // that attaches the layer. Recomputing behind a hidden overlay would also
    // repaint it, which is what Show/Hide must never do.
    if (!fieldEnabled && overlayAttachedRef.current) return;
    if (instantKeyRef.current === instantKey) return;

    const compute = () => {
      lastInstantRef.current = performance.now();
      instantKeyRef.current = instantKey;
      setInstant({
        result: instantField(
          field.grid.points.map((p) => p.position),
          houseList.map(occluderFor),
          field.grid.centre,
          date,
          { utcOffsetHours: zone.offsetHours },
        ),
        forSignature: field.signature,
        pointCount: field.grid.points.length,
      });
    };

    // An absolute deadline, so a stream of clock ticks throttles to a steady
    // cadence instead of debouncing into never running.
    const due =
      lastInstantRef.current + INSTANT_INTERVAL_MS - performance.now();
    if (due <= 0) {
      compute();
      return;
    }
    const timer = window.setTimeout(compute, due);
    return () => window.clearTimeout(timer);
  }, [
    fieldMode,
    fieldEnabled,
    field,
    houseList,
    date,
    zone.offsetHours,
    instantKey,
  ]);

  // One owner of the overlay image, so the two modes cannot race each other.
  useEffect(() => {
    const overlay = fieldOverlayRef.current;
    if (!overlay || !field) return;
    if (!fieldEnabled && overlayAttachedRef.current) return;

    // Redrawing identical pixels would replace the imagery layer for nothing,
    // and replacing it is the one thing that makes Cesium rebuild tiles. Show
    // and Hide in particular must get back the image already on the globe.
    const paintKey =
      fieldMode === "NOW"
        ? `NOW|${field.signature}|${instantKeyRef.current}`
        : `WHOLE_DAY|${field.signature}`;
    if (paintedKeyRef.current === paintKey) return;

    const matched =
      fieldMode !== "NOW" ||
      instantMatchesField(instant, {
        signature: field.signature,
        pointCount: field.grid.points.length,
      });

    const source =
      fieldMode === "NOW"
        ? matched && instant
          ? {
              pointCount: instant.result.pointCount,
              colourAt: (i: number) =>
                instantColour(instant.result.strength[i]),
              opacityAt: (i: number) =>
                instantOpacity(instant.result.strength[i]),
            }
          : null
        : {
            pointCount: field.result.pointCount,
            colourAt: (i: number) => colourForMinutes(field.result.minutes[i]),
            opacityAt: (i: number) =>
              opacityForMinutes(field.result.minutes[i]),
          };
    if (!source) return;

    paintedKeyRef.current = paintKey;
    overlay
      .update(field.grid, source)
      .then(() => {
        overlayAttachedRef.current = true;
      })
      .catch(console.error);
  }, [field, instant, fieldMode, fieldEnabled]);

  useEffect(() => {
    // The frustum is the shape of the view seen from outside. Drawing it over
    // the view itself would put the camera's own edges across its picture.
    const show = appMode === "SURF_CAM" && !lookingThrough;
    frustumRef.current?.update(show && frustumVisible ? surfCam : null);
  }, [appMode, surfCam, lookingThrough]);

  /**
   * Keeps the preview's projection matched to the lens.
   *
   * Changing the field of view, the output format or the window's shape all
   * change what the capture frame must cover, and a projection left stale
   * would report a framing the preview is not actually showing.
   */
  useEffect(() => {
    if (!lookingThrough) return;
    applyLensToViewfinder();

    const onResize = () => applyLensToViewfinder();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [lookingThrough, surfCam?.horizontalFovDeg, capture.resolutionId]);

  /**
   * What the sight line actually depends on: the two physical endpoints.
   *
   * Bearing, tilt and field of view are deliberately absent. Aiming the
   * camera changes the frustum, not where the ground is, so turning a slider
   * must never trigger a terrain request.
   */
  const sightLineSignature =
    surfCam && surfTarget
      ? [
          surfCam.ground.latitude,
          surfCam.ground.longitude,
          surfCam.ground.height,
          surfCam.mountHeightMeters,
          surfTarget.ground.latitude,
          surfTarget.ground.longitude,
          surfTarget.ground.height,
          surfTarget.heightMeters,
        ].join(":")
      : null;

  useEffect(() => {
    const analyser = sightLineAnalyserRef.current;
    if (!analyser) return;

    const store = useSolarHouseStore.getState();
    const camera = store.surfCam;
    const target = store.surfTarget;
    if (!sightLineSignature || !camera || !target) {
      analyser.clear();
      return;
    }

    analyser.request(
      {
        position: camera.ground,
        terrainElevationMeters: camera.ground.height,
        heightMeters: camera.mountHeightMeters,
      },
      {
        position: target.ground,
        terrainElevationMeters: target.ground.height,
        heightMeters: target.heightMeters,
      },
    );
  }, [sightLineSignature]);

  useEffect(() => {
    const store = useSolarHouseStore.getState();
    const camera = store.surfCam;
    if (appMode !== "SURF_CAM" || !camera || !surfTarget) {
      sightLineLayerRef.current?.update(null);
      return;
    }

    sightLineLayerRef.current?.update({
      cameraEye: {
        ...camera.ground,
        height: cameraElevationMeters(camera),
      },
      targetGround: surfTarget.ground,
      targetHeightMeters: surfTarget.heightMeters,
      status:
        sightLine.status === "READY"
          ? sightLine.analysis.classification
          : "PENDING",
    });
  }, [appMode, surfCam, surfTarget, sightLine]);

  // Escape backs out of target placement without having to find the button.
  useEffect(() => {
    if (!surfTargetArmed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        useSolarHouseStore.getState().armSurfTarget(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [surfTargetArmed]);

  /**
   * Places the proposed camera on the startup site, so the opening scene holds
   * both the house being analysed and the mount being considered.
   *
   * Once only, guarded by a ref rather than by the camera being absent, so
   * switching workflows never discards a camera the user has placed or
   * adjusted, and a removed camera stays removed. It touches nothing belonging
   * to Solar Analysis: no houses move and the site is unchanged. The view is
   * only flown when Surf Cam is already open, since seeding must not pull the
   * navigation camera away from whatever the user is looking at.
   */
  useEffect(() => {
    if (surfCamSeededRef.current) return;
    if (useSolarHouseStore.getState().surfCam) {
      surfCamSeededRef.current = true;
      return;
    }
    if (terrainStatus !== "READY") return;

    surfCamSeededRef.current = true;
    void placeSurfCam(appMode === "SURF_CAM");
  }, [appMode, terrainStatus]);

  // Leaving the look-through state by any route — the button, a mode switch,
  // unmount — must hand terrain collision back to the navigation camera.
  useEffect(() => {
    if (lookingThrough) return;
    const scene = sceneRef.current;
    if (!scene) return;
    scene.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  }, [lookingThrough]);

  // Exact point analysis for both placements, not the nearest grid cell.
  const baselinePointMinutes = useMemo(() => {
    if (!probe || !baseline) return null;
    return pointExposure(probe, baseline, date, {
      utcOffsetHours: zone.offsetHours,
    }).directSunMinutes;
  }, [probe, baseline, date, zone.offsetHours]);

  const comparison = useMemo(() => {
    if (!field?.baseline) return null;
    const cellArea = field.grid.spacingMeters ** 2;
    return {
      area8h: {
        baseline: areaAboveHours(field.baseline, cellArea, 8),
        current: areaAboveHours(field.result, cellArea, 8),
      },
      area6h: {
        baseline: areaAboveHours(field.baseline, cellArea, 6),
        current: areaAboveHours(field.result, cellArea, 6),
      },
      averageMinutes: {
        baseline: meanMinutes(field.baseline),
        current: meanMinutes(field.result),
      },
      point:
        baselinePointMinutes !== null && exposure
          ? {
              baseline: baselinePointMinutes,
              current: exposure.directSunMinutes,
            }
          : null,
    };
  }, [field, baselinePointMinutes, exposure]);

  // Three point evaluations, not three exposure fields.
  const seasonalPoint = useMemo(() => {
    if (!probe) return null;
    const occluders = houseList.map(occluderFor);
    return seasonalPointExposure(
      probe,
      occluders,
      civilParts(date, zone.timeZone).year,
    );
  }, [probe, houseList, date, zone.timeZone]);

  const baselineDriftMeters = useMemo(() => {
    if (!baseline?.[0] || houseList.length === 0) return null;
    const offset = eastNorthOffset(baseline[0].position, houseList[0].position);
    return Math.hypot(offset.east, offset.north);
  }, [baseline, houseList]);

  /**
   * Resolves what the user typed, then samples terrain for it.
   *
   * Both halves are async and the user can type again while either is in
   * flight, so every lookup carries a token and a result whose token is no
   * longer current is discarded rather than displayed.
   */
  const handleLocationSearch = async (query: string) => {
    const parsed = classifyQuery(query);
    if (!parsed) return;

    const token = (locationTokenRef.current += 1);
    setLocating(true);
    setLocationError(null);

    let position: { latitude: number; longitude: number };
    let label: string;
    let approximate: boolean;

    if (parsed.kind === "COORDINATES") {
      position = parsed.value;
      label = "Entered coordinates";
      approximate = false;
    } else {
      const geocoder = geocoderRef.current;
      const outcome = geocoder
        ? await geocoder.search(parsed.value)
        : ({ status: "UNCONFIGURED" } as const);
      if (token !== locationTokenRef.current) return;

      if (outcome.status !== "OK") {
        setLocating(false);
        setLocated(null);
        setLocationError(geocodeMessage(outcome.status, parsed.value));
        return;
      }

      const best = outcome.matches[0];
      position = best.position;
      label = best.displayName;
      approximate = best.approximate;
    }

    if (token !== locationTokenRef.current) return;
    setLocated({
      position,
      label,
      approximate,
      elevationMeters: null,
      elevationStatus: "PENDING",
    });
    setLocating(false);

    const scene = sceneRef.current;
    const provider = scene?.getTerrainProvider();
    if (!provider || useSolarHouseStore.getState().terrainStatus !== "READY") {
      if (token === locationTokenRef.current) {
        setLocated((current) =>
          current ? { ...current, elevationStatus: "UNAVAILABLE" } : current,
        );
      }
      return;
    }

    try {
      const [elevation] = await sampleElevations(provider, [position]);
      if (token !== locationTokenRef.current) return;
      setLocated((current) =>
        current
          ? {
              ...current,
              elevationMeters: elevation ?? null,
              elevationStatus:
                elevation === undefined ? "UNAVAILABLE" : "READY",
            }
          : current,
      );
    } catch {
      if (token !== locationTokenRef.current) return;
      setLocated((current) =>
        current ? { ...current, elevationStatus: "UNAVAILABLE" } : current,
      );
    }
  };

  /** Flies the navigation camera. Deliberately changes no scene state. */
  const handleGoToLocation = () => {
    if (!located) return;
    cameraRef.current?.flyTo("SITE", {
      ...located.position,
      height: located.elevationMeters ?? 0,
    });
  };

  /** The explicit, separate act of adopting the location as the analysed site. */
  const handleSetSite = () => {
    if (!located) return;
    useSolarHouseStore.getState().setSite(located.position);
    handleGoToLocation();
  };

  const handleLookThrough = () => {
    const camera = useSolarHouseStore.getState().surfCam;
    const scene = sceneRef.current;
    if (!camera || !scene) return;

    // Cesium keeps the navigation camera clear of the terrain, and that
    // correction lifted the eye 1-2 m above a 6 m mount — enough to change
    // what clears a fence. Collision detection is suspended while looking
    // through so the view sits exactly where the camera would.
    scene.viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;

    scene.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        camera.ground.longitude,
        camera.ground.latitude,
        cameraElevationMeters(camera),
      ),
      orientation: {
        heading: CesiumMath.toRadians(camera.bearingDeg),
        pitch: CesiumMath.toRadians(cesiumPitchDeg(camera.tiltDeg)),
        roll: 0,
      },
    });
    applyLensToViewfinder();
    useSolarHouseStore.getState().setLookingThrough(true);
  };

  /**
   * Narrows the navigation camera's frustum to the lens being planned.
   *
   * Without this the preview is whatever Cesium defaults to and the lens
   * controls do nothing to it. The capture frame is inscribed in the canvas
   * rather than stretched to it, so the angle handed to Cesium covers the
   * canvas and the overlay's guide marks the part the camera would record.
   */
  const applyLensToViewfinder = () => {
    const scene = sceneRef.current;
    const camera = useSolarHouseStore.getState().surfCam;
    if (!scene || !camera) return;

    const frustum = scene.viewer.camera.frustum;
    if (!(frustum instanceof PerspectiveFrustum)) return;

    const canvas = scene.viewer.scene.canvas;
    if (!canvas.clientWidth || !canvas.clientHeight) return;

    const format = outputResolution(
      useSolarHouseStore.getState().capture.resolutionId,
    );
    frustum.fov = CesiumMath.toRadians(
      cesiumFrustumFovDeg(
        camera.horizontalFovDeg,
        sensorAspect(format),
        canvas.clientWidth / canvas.clientHeight,
      ),
    );
  };

  /**
   * Points the camera at the placed target, explicitly and once.
   *
   * Aiming is never automatic: moving a target to compare two spots must not
   * swing the mount the user has been setting up. Position, mount height and
   * lens are all left alone — only the aim changes.
   */
  const handleAimAtTarget = () => {
    const store = useSolarHouseStore.getState();
    const camera = store.surfCam;
    const target = store.surfTarget;
    if (!camera || !target) return;

    const aim = aimAtTarget(
      {
        position: camera.ground,
        elevationMeters: cameraElevationMeters(camera),
      },
      {
        position: target.ground,
        elevationMeters: target.ground.height + target.heightMeters,
      },
      { currentBearingDeg: camera.bearingDeg },
    );

    store.updateSurfCam({ bearingDeg: aim.bearingDeg, tiltDeg: aim.tiltDeg });
    if (useSolarHouseStore.getState().lookingThrough) handleLookThrough();
  };

  const handleReturnView = () => {
    useSolarHouseStore.getState().setLookingThrough(false);
    const scene = sceneRef.current;
    if (scene) {
      scene.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      const frustum = scene.viewer.camera.frustum;
      // Hand the navigation camera its own field of view back, or every
      // later orbit is stuck behind the planned lens.
      if (frustum instanceof PerspectiveFrustum) {
        frustum.fov = DEFAULT_NAVIGATION_FOV_RADIANS;
      }
    }
    const camera = useSolarHouseStore.getState().surfCam;
    cameraRef.current?.flyTo("SITE", camera ? camera.ground : INITIAL_SITE);
  };

  /**
   * Puts the virtual camera on the startup site, sampling ground elevation so
   * the mast height stays relative to real terrain. Without real terrain
   * nothing is placed: mounting at an invented height would be worse than no
   * camera at all.
   */
  const placeSurfCam = async (frame: boolean) => {
    const scene = sceneRef.current;
    const provider = scene?.getTerrainProvider();
    if (!scene || !provider) return;

    const position = STARTUP_SITE.position;
    let elevation: number | undefined;
    try {
      [elevation] = await sampleElevations(provider, [position]);
    } catch (error) {
      console.warn("[surf-cam] Terrain sampling failed for the mount.", error);
      return;
    }
    if (elevation === undefined) return;

    useSolarHouseStore
      .getState()
      .setSurfCam(
        createCamera(
          "surf-cam-1",
          { ...position, height: elevation },
          { label: "Proposed Lulworth position", ...STARTUP_SITE.mount },
        ),
      );

    if (frame) {
      // Stand off to the south so the mount and its frustum are both in
      // frame. Navigation view only; look-through stays a deliberate act.
      cameraRef.current?.flyTo(
        "SITE",
        { ...position, height: elevation },
        { range: 430, pitchDeg: -32, headingDeg: 0 },
      );
    }
  };

  const handleCameraMode = (mode: CameraMode) => {
    setCameraMode(mode);
    const store = useSolarHouseStore.getState();
    store.setCameraMode(mode);

    const site = store.site;
    const target: GeoPosition =
      selected?.position ?? (site ? { ...site, height: 0 } : INITIAL_SITE);

    cameraRef.current?.flyTo(mode, target);
  };

  const handlePlace = () => {
    const scene = sceneRef.current;
    const site = useSolarHouseStore.getState().site ?? INITIAL_SITE;
    const height = scene
      ? (loadedHeight(scene.globe, site.latitude, site.longitude) ?? 0)
      : 0;
    const id = addHouse({
      latitude: site.latitude,
      longitude: site.longitude,
      height,
    });
    void settleRef.current?.(id);
  };

  const handleHeading = (heading: number) => {
    if (selected)
      updateObject(selected.id, {
        rotation: { ...selected.rotation, heading },
      });
  };

  return (
    <main className="app">
      <div ref={containerRef} className="globe" />
      <div className="vignette" />
      {lookingThrough && overlayVisible && surfCam && (
        <ViewfinderOverlay
          resolution={outputResolution(capture.resolutionId)}
          bearingDeg={surfCam.bearingDeg}
          tiltDeg={surfCam.tiltDeg}
          horizontalFovDeg={surfCam.horizontalFovDeg}
          verticalFovDeg={framing?.verticalFovDeg ?? surfCam.horizontalFovDeg}
          framing={framing}
        />
      )}
      <Controls
        siteName={STARTUP_SITE.name}
        appMode={appMode}
        onAppMode={(mode) => useSolarHouseStore.getState().setAppMode(mode)}
        location={
          <LocationSearch
            resolved={located}
            busy={locating}
            error={locationError}
            hasActiveSite={site !== null}
            onSearch={(query) => void handleLocationSearch(query)}
            onGoTo={handleGoToLocation}
            onSetSite={handleSetSite}
            onClear={() => {
              locationTokenRef.current += 1;
              setLocated(null);
              setLocationError(null);
            }}
          />
        }
        date={date}
        playing={playing}
        speed={speed}
        heading={selected?.rotation.heading ?? 0}
        cameraMode={cameraMode}
        zone={zone}
        solar={solar}
        season={season}
        onSeason={(next) => {
          const store = useSolarHouseStore.getState();
          store.setSeason(next);
          const latitude = sunOrigin.latitude;
          clock.setDate(
            seasonalDate(
              next,
              latitude,
              civilParts(date, zone.timeZone).year,
              zone.offsetHours,
            ),
          );
        }}
        onDate={(year, month, day) => {
          // An explicit date is no longer one of the presets.
          useSolarHouseStore.getState().setSeason(null);
          clock.setDate(withCivilDate(date, zone.timeZone, year, month, day));
        }}
        onTime={(minutes) =>
          clock.setDate(withCivilMinutes(date, zone.timeZone, minutes))
        }
        onToggle={() => clock.toggle()}
        onSpeed={(next) => {
          setSpeed(next);
          clock.setSpeed(next);
        }}
        onHeading={handleHeading}
        onPlace={handlePlace}
        onCameraMode={handleCameraMode}
      >
        {appMode === "SOLAR" ? (
          <ExposurePanel
            exposure={exposure}
            seasonal={seasonalPoint}
            comparison={comparison}
            hasBaseline={baseline !== null}
            baselineDriftMeters={baselineDriftMeters}
            zone={zone}
            armed={probeArmed}
            fieldEnabled={fieldEnabled}
            fieldPending={fieldPending}
            coverageClipped={field?.clipped ?? false}
            mode={fieldMode}
            opacity={fieldOpacity}
            onOpacity={(value) =>
              useSolarHouseStore.getState().setFieldOpacity(value)
            }
            instant={instantProbe}
            sunAltitudeDeg={solar.altitudeDeg}
            date={date}
            onMode={(mode) => useSolarHouseStore.getState().setFieldMode(mode)}
            onSetBaseline={() => {
              const store = useSolarHouseStore.getState();
              const houses = Object.values(store.objects).filter(
                (o) => o.type === "house",
              );
              store.setBaseline(
                houses.length > 0 ? houses.map(occluderFor) : null,
              );
            }}
            onClearBaseline={() =>
              useSolarHouseStore.getState().setBaseline(null)
            }
            onArm={() => useSolarHouseStore.getState().armProbe(true)}
            onToggleField={() =>
              useSolarHouseStore.getState().setFieldEnabled(!fieldEnabled)
            }
            onClear={() => {
              useSolarHouseStore.getState().setProbe(null);
              useSolarHouseStore.getState().armProbe(false);
            }}
          />
        ) : (
          <SurfCamPanel
            camera={surfCam}
            armed={surfCamArmed}
            lookingThrough={lookingThrough}
            terrainReady={terrainStatus === "READY"}
            onArm={() => useSolarHouseStore.getState().armSurfCam(true)}
            onChange={(patch) =>
              useSolarHouseStore.getState().updateSurfCam(patch)
            }
            onReset={() => {
              const store = useSolarHouseStore.getState();
              if (store.surfCam) {
                store.setSurfCam(
                  createCamera(store.surfCam.id, store.surfCam.ground),
                );
              }
            }}
            onClear={() => {
              const store = useSolarHouseStore.getState();
              store.setSurfCam(null);
              store.armSurfCam(false);
              store.setLookingThrough(false);
            }}
            onLookThrough={handleLookThrough}
            onReturnView={handleReturnView}
            target={surfTarget}
            targetArmed={surfTargetArmed}
            sightLine={sightLine}
            onArmTarget={() =>
              useSolarHouseStore.getState().armSurfTarget(true)
            }
            onTargetHeight={(heightMeters) =>
              useSolarHouseStore.getState().updateSurfTarget({ heightMeters })
            }
            onRemoveTarget={() => {
              const store = useSolarHouseStore.getState();
              store.setSurfTarget(null);
              store.armSurfTarget(false);
            }}
            framing={framing}
            comparison={
              surfCam && surfTarget
                ? compareLenses(
                    surfCam,
                    surfTarget,
                    capture.resolutionId,
                    referenceObject,
                  )
                : []
            }
            capture={capture}
            overlayVisible={overlayVisible}
            onCapture={(patch) =>
              useSolarHouseStore.getState().setCapture(patch)
            }
            onAimAtTarget={handleAimAtTarget}
            onOverlayVisible={setOverlayVisible}
            onSaveMount={(name) =>
              useSolarHouseStore.getState().saveMount(name)
            }
            onSelectMount={(id) =>
              useSolarHouseStore.getState().selectMount(id)
            }
            onRenameMount={(id, name) =>
              useSolarHouseStore.getState().renameMount(id, name)
            }
            onDeleteMount={(id) =>
              useSolarHouseStore.getState().deleteMount(id)
            }
            configurationId={configurationId}
            onConfiguration={(id) => useSolarHouseStore.getState().setCameraConfiguration(id)}
            frustumVisible={frustumVisible}
            onFrustumVisible={setFrustumVisible}
            mountSightLines={mountSightLines}
            savedMounts={savedMounts}
          />
        )}
      </Controls>
      <TerrainDiagnostics
        field={
          field && {
            cols: field.grid.cols,
            rows: field.grid.rows,
            pointCount: field.result.pointCount,
            spacingMeters: field.grid.spacingMeters,
            extentMeters: field.grid.extentMeters,
            sunSamples: field.result.timeline.samples.length,
            computeMs: field.result.computeMs,
            overlayMs: field.overlayMs,
          }
        }
      />
      <div className="north">N</div>
    </main>
  );
}

/** Civil-day key so whole-day analysis does not rerun on every clock tick. */
function selectedDayKey(date: Date, utcOffsetHours: number): string {
  const shifted = new Date(date.getTime() + utcOffsetHours * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}
