import { useEffect, useMemo, useRef, useState } from "react";
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

const INITIAL_DATE = new Date();
INITIAL_DATE.setHours(12, 0, 0, 0);

const INITIAL_SITE = DEFAULT_SITE;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CesiumScene | null>(null);
  const layerRef = useRef<ObjectLayer | null>(null);
  const dragRef = useRef<DragController | null>(null);
  const overlayRef = useRef<SelectionOverlay | null>(null);
  const cameraRef = useRef<CameraController | null>(null);
  const settleRef = useRef<((id: string) => Promise<void>) | null>(null);
  const fieldOverlayRef = useRef<HeatmapOverlay | null>(null);

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
  const season = useSolarHouseStore((s) => s.season);
  const baseline = useSolarHouseStore((s) => s.baseline);
  const [field, setField] = useState<{
    grid: Grid;
    result: ExposureField;
    baseline: ExposureField | null;
    overlayMs: number;
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

  const houseList = useMemo(
    () => Object.values(objects).filter((object) => object.type === "house"),
    [objects],
  );

  // Keyed on the inputs that actually change the field. Camera movement and
  // clock ticks within the same civil day deliberately do not recompute it.
  const fieldKey = houseList
    .map(
      (h) =>
        `${h.id}:${h.position.latitude.toFixed(7)},${h.position.longitude.toFixed(7)},${h.position.height.toFixed(2)},${h.rotation.heading.toFixed(2)},${h.scale}`,
    )
    .join("|");

  useEffect(() => {
    const scene = sceneRef.current;
    const overlay = fieldOverlayRef.current;
    if (!scene || !overlay) return;

    if (!fieldEnabled || houseList.length === 0) {
      overlay.clear();
      setField(null);
      return;
    }

    let cancelled = false;
    // Anchored to the baseline placement while one exists, so both fields
    // describe the same piece of ground and the comparison is like for like.
    const centre = baseline?.[0]?.position ?? houseList[0].position;

    (async () => {
      const grid = groundGrid({ centre, ...DEFAULT_GRID });
      const provider = scene.getTerrainProvider();
      const status = useSolarHouseStore.getState().terrainStatus;

      if (provider && status === "READY") {
        const heights = await sampleElevations(provider, grid.points.map((p) => p.position));
        if (cancelled) return;
        grid.points.forEach((point, index) => {
          point.position.height = heights[index] ?? centre.height;
        });
      } else {
        for (const point of grid.points) point.position.height = centre.height;
      }

      const positions = grid.points.map((p) => p.position);
      const timeline = sunTimeline(centre, date, { utcOffsetHours: zone.offsetHours });
      const result = exposureField(positions, houseList.map(occluderFor), timeline);
      // Recomputed against the active timeline rather than stored, so a date or
      // season change moves both sides together.
      const baselineResult = baseline
        ? exposureField(positions, baseline, timeline)
        : null;
      if (cancelled) return;

      await overlay.update(grid, result);
      if (cancelled) return;
      setField({
        grid,
        result,
        baseline: baselineResult,
        overlayMs: overlay.lastUpdateMs,
      });
    })().catch(console.error);

    return () => {
      cancelled = true;
    };
    // `date` is intentionally absent: civilDay captures the only part that matters.
  }, [fieldEnabled, fieldKey, civilDay, zone.offsetHours, houseList, baseline]);

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
      />
      <ExposurePanel
        exposure={exposure}
        seasonal={seasonalPoint}
        comparison={comparison}
        hasBaseline={baseline !== null}
        onSetBaseline={() => {
          const store = useSolarHouseStore.getState();
          const houses = Object.values(store.objects).filter((o) => o.type === "house");
          store.setBaseline(houses.length > 0 ? houses.map(occluderFor) : null);
        }}
        onClearBaseline={() => useSolarHouseStore.getState().setBaseline(null)}
        zone={zone}
        armed={probeArmed}
        fieldEnabled={fieldEnabled}
        field={
          field && {
            cols: field.grid.cols,
            rows: field.grid.rows,
            pointCount: field.result.pointCount,
            spacingMeters: field.grid.spacingMeters,
            extentMeters: field.grid.extentMeters,
            sunSamples: field.result.timeline.samples.length,
            minMinutes: field.result.minMinutes,
            maxMinutes: field.result.maxMinutes,
            computeMs: field.result.computeMs,
            overlayMs: field.overlayMs,
            areaAbove8hSquareMeters: areaAboveHours(
              field.result,
              field.grid.spacingMeters ** 2,
              8,
            ),
            coveredAreaSquareMeters:
              field.result.pointCount * field.grid.spacingMeters ** 2,
          }
        }
        onArm={() => useSolarHouseStore.getState().armProbe(true)}
        onToggleField={() =>
          useSolarHouseStore.getState().setFieldEnabled(!fieldEnabled)
        }
        onClear={() => {
          useSolarHouseStore.getState().setProbe(null);
          useSolarHouseStore.getState().armProbe(false);
          useSolarHouseStore.getState().setFieldEnabled(false);
        }}
      />
      <TerrainDiagnostics />
      <div className="north">N</div>
      <div className="location-pill">The Domain · Sydney</div>
    </main>
  );
}

/** Civil-day key so whole-day analysis does not rerun on every clock tick. */
function selectedDayKey(date: Date, utcOffsetHours: number): string {
  const shifted = new Date(date.getTime() + utcOffsetHours * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}
