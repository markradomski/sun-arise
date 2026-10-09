import { useEffect, useMemo, useRef, useState } from "react";
import { Cartesian3, Math as CesiumMath } from "cesium";
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
import { civilParts, civilZone, withCivilDate, withCivilMinutes } from "./solar/timezone";
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
import { Geocoder } from "./cesium/geocode";
import LocationSearch, { type ResolvedLocation } from "./components/LocationSearch";
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
import { DEFAULT_SITE } from "./scene/site";
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

const INITIAL_SITE = DEFAULT_SITE;

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
  const frustumRef = useRef<FrustumLayer | null>(null);
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
  const lookingThrough = useSolarHouseStore((s) => s.lookingThrough);
  const terrainStatus = useSolarHouseStore((s) => s.terrainStatus);
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
    const stopInitialFraming = scene.viewer.scene.postRender.addEventListener(() => {
      if (framed || disposed) return;
      const state = useSolarHouseStore.getState();
      const first = state.order[0] ? state.objects[state.order[0]] : undefined;
      if (!first || !layer.isReady(first.id)) return;
      if (!placementResolved.has(first.id)) return;

      camera.setTo(DEFAULT_CAMERA_MODE, first.position);
      framed = true;
      stopInitialFraming();
    });

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

    const fieldOverlay = new HeatmapOverlay(scene.viewer);
    fieldOverlayRef.current = fieldOverlay;

    const frustum = new FrustumLayer(scene.viewer);
    frustumRef.current = frustum;
    geocoderRef.current = new Geocoder(scene.scene);

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
          store.setSurfCam(
            createCamera("surf-cam-1", location, store.surfCam ?? undefined),
          );
          store.armSurfCam(false);
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

        store.setSite({ latitude: location.latitude, longitude: location.longitude });

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
        for (const id of useSolarHouseStore.getState().order) void settlePlacement(id);
      })
      .catch((error) => {
        console.error(error);
        if (!disposed) {
          useSolarHouseStore
            .getState()
            .setTerrainStatus("UNAVAILABLE", "terrain initialisation failed");
          for (const id of useSolarHouseStore.getState().order) void settlePlacement(id);
        }
      });

    // Strict Mode remounts this effect with the store already populated, so
    // seed only once and always sync the fresh layer against current state.
    const store = useSolarHouseStore.getState();
    if (store.order.length === 0) {
      store.setSite({ latitude: INITIAL_SITE.latitude, longitude: INITIAL_SITE.longitude });
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
  const sunOrigin = selected?.position ??
    (site ? { ...site, height: 0 } : INITIAL_SITE);

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
      setField((current) => (current?.signature === signature ? current : null));
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
        const heights = await sampleElevations(provider, grid.points.map((p) => p.position));
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
      const result = exposureField(positions, houseList.map(occluderFor), timeline);
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
    const due = lastInstantRef.current + INSTANT_INTERVAL_MS - performance.now();
    if (due <= 0) {
      compute();
      return;
    }
    const timer = window.setTimeout(compute, due);
    return () => window.clearTimeout(timer);
  }, [fieldMode, fieldEnabled, field, houseList, date, zone.offsetHours, instantKey]);

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
              colourAt: (i: number) => instantColour(instant.result.strength[i]),
              opacityAt: (i: number) => instantOpacity(instant.result.strength[i]),
            }
          : null
        : {
            pointCount: field.result.pointCount,
            colourAt: (i: number) => colourForMinutes(field.result.minutes[i]),
            opacityAt: (i: number) => opacityForMinutes(field.result.minutes[i]),
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
    frustumRef.current?.update(appMode === "SURF_CAM" ? surfCam : null);
  }, [appMode, surfCam]);

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
          ? { baseline: baselinePointMinutes, current: exposure.directSunMinutes }
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
              elevationStatus: elevation === undefined ? "UNAVAILABLE" : "READY",
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
    useSolarHouseStore.getState().setLookingThrough(true);
  };

  const handleReturnView = () => {
    useSolarHouseStore.getState().setLookingThrough(false);
    const scene = sceneRef.current;
    if (scene) {
      scene.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    }
    const camera = useSolarHouseStore.getState().surfCam;
    cameraRef.current?.flyTo("SITE", camera ? camera.ground : INITIAL_SITE);
  };

  const handleCameraMode = (mode: CameraMode) => {
    setCameraMode(mode);
    const store = useSolarHouseStore.getState();
    store.setCameraMode(mode);

    const site = store.site;
    const target: GeoPosition =
      selected?.position ??
      (site ? { ...site, height: 0 } : INITIAL_SITE);

    cameraRef.current?.flyTo(mode, target);
  };

  const handlePlace = () => {
    const scene = sceneRef.current;
    const site = useSolarHouseStore.getState().site ?? INITIAL_SITE;
    const height = scene
      ? loadedHeight(scene.globe, site.latitude, site.longitude) ?? 0
      : 0;
    const id = addHouse({ latitude: site.latitude, longitude: site.longitude, height });
    void settleRef.current?.(id);
  };

  const handleHeading = (heading: number) => {
    if (selected) updateObject(selected.id, { rotation: { ...selected.rotation, heading } });
  };

  return (
    <main className="app">
      <div ref={containerRef} className="globe" />
      <div className="vignette" />
      <Controls
        siteName={appMode === "SURF_CAM" ? "Camera siting" : "The Domain · Sydney"}
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
            store.setBaseline(houses.length > 0 ? houses.map(occluderFor) : null);
          }}
          onClearBaseline={() => useSolarHouseStore.getState().setBaseline(null)}
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
            onChange={(patch) => useSolarHouseStore.getState().updateSurfCam(patch)}
            onReset={() => {
              const store = useSolarHouseStore.getState();
              if (store.surfCam) {
                store.setSurfCam(createCamera(store.surfCam.id, store.surfCam.ground));
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
