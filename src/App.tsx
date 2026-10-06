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
import { approxHeight, settleHeight } from "./cesium/terrain";
import { SolarClock } from "./solar/SolarClock";
import { solarPosition } from "./solar/solarPosition";
import { civilZone, withCivilDate, withCivilMinutes } from "./solar/timezone";
import type { GeoPosition } from "./scene/types";
import {
  selectOrderedObjects,
  selectSelectedObject,
  useSolarHouseStore,
} from "./state/store";
import Controls from "./components/Controls";

const INITIAL_DATE = new Date();
INITIAL_DATE.setHours(12, 0, 0, 0);

const INITIAL_SITE = { latitude: -33.8688, longitude: 151.2093, height: 0 };

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CesiumScene | null>(null);
  const layerRef = useRef<ObjectLayer | null>(null);
  const dragRef = useRef<DragController | null>(null);
  const overlayRef = useRef<SelectionOverlay | null>(null);
  const cameraRef = useRef<CameraController | null>(null);

  const [date, setDate] = useState(INITIAL_DATE);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [cameraMode, setCameraMode] = useState<CameraMode>(DEFAULT_CAMERA_MODE);

  const selected = useSolarHouseStore(selectSelectedObject);
  const site = useSolarHouseStore((s) => s.site);
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
    const unsubscribeStore = useSolarHouseStore.subscribe((state) => {
      layer.sync(selectOrderedObjects(state)).catch(console.error);
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

    // Open at SITE rather than in orbit. The model's position is only
    // meaningful once it has loaded and settled onto terrain, so wait for
    // readiness and then set the view directly — no fly-from-space.
    let framed = false;
    const stopInitialFraming = scene.viewer.scene.postRender.addEventListener(() => {
      if (framed || disposed) return;
      const state = useSolarHouseStore.getState();
      const first = state.order[0] ? state.objects[state.order[0]] : undefined;
      if (!first || !layer.isReady(first.id)) return;

      camera.setTo(DEFAULT_CAMERA_MODE, first.position);
      framed = true;
      stopInitialFraming();
    });

    const drag = new DragController({
      scene: scene.scene,
      getTerrainProvider: () => scene.getTerrainProvider(),
      onGroundClick: (location) => {
        const store = useSolarHouseStore.getState();
        store.setSite({ latitude: location.latitude, longitude: location.longitude });

        // Move the selected house if there is one, otherwise drop a new one.
        const id = store.selectedId ?? store.addHouse(location);
        if (store.selectedId) store.updateObject(id, { position: location });

        void settlePlacement(id);
      },
    });
    dragRef.current = drag;

    async function settlePlacement(id: string) {
      const provider = scene.getTerrainProvider();
      if (!provider || disposed) return;

      const object = useSolarHouseStore.getState().objects[id];
      if (!object?.clampToGround) return;

      const height = await settleHeight(
        provider,
        object.position.latitude,
        object.position.longitude,
      );
      if (disposed) return;
      useSolarHouseStore.getState().updateObject(id, { position: { ...object.position, height } });
    }

    scene
      .initTerrain()
      .then((hasWorldTerrain) => {
        if (disposed) return;
        if (!hasWorldTerrain) {
          console.info(
            "[solar-house] No Cesium ion token — running on the WGS84 ellipsoid. " +
              "Set VITE_CESIUM_ION_TOKEN for real terrain.",
          );
        }
        // Re-settle anything placed before terrain finished loading.
        for (const id of useSolarHouseStore.getState().order) void settlePlacement(id);
      })
      .catch(console.error);

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
      stopInitialFraming();
      drag.destroy();
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
    const height = scene ? approxHeight(scene.globe, site.latitude, site.longitude) : 0;
    addHouse({ latitude: site.latitude, longitude: site.longitude, height });
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
        onDate={(year, month, day) =>
          clock.setDate(withCivilDate(date, zone.timeZone, year, month, day))
        }
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
      <div className="north">N</div>
      <div className="location-pill">Sydney · MVP starting location</div>
    </main>
  );
}
