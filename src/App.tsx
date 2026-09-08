import { useEffect, useMemo, useRef, useState } from "react";
import { CesiumScene } from "./cesium/CesiumScene";
import { ObjectLayer } from "./cesium/ObjectLayer";
import { approxHeight, settleHeight } from "./cesium/terrain";
import { entryForModelUrl } from "./houses/catalog";
import { SolarClock } from "./solar/SolarClock";
import { solarPosition } from "./solar/solarPosition";
import { dailyShadowTrail, visualShadow } from "./solar/shadowGeometry";
import {
  selectOrderedObjects,
  selectSelectedObject,
  useSolarHouseStore,
} from "./state/store";
import Controls from "./components/Controls";

const INITIAL_DATE = new Date();
INITIAL_DATE.setHours(12, 0, 0, 0);

const INITIAL_SITE = { latitude: -33.8688, longitude: 151.2093, height: 0 };

// TODO(phase-1 §6.1): hardcoded to Sydney. Every sun position outside UTC+10 is
// wrong. Blocked on the tz-lookup vs longitude/15 decision.
const UTC_OFFSET_HOURS = 10;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CesiumScene | null>(null);
  const layerRef = useRef<ObjectLayer | null>(null);

  const [date, setDate] = useState(INITIAL_DATE);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [is3D, setIs3D] = useState(true);

  const selected = useSolarHouseStore(selectSelectedObject);
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
      Object.assign(globalThis, { __solarHouseScene: scene, __solarHouseLayer: layer });
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

    scene.onLocationPick((location) => {
      const store = useSolarHouseStore.getState();
      store.setSite({ latitude: location.latitude, longitude: location.longitude });

      const height = approxHeight(scene.globe, location.latitude, location.longitude);
      const position = { ...location, height };

      // Move the selected house if there is one, otherwise drop a new one.
      const id = store.selectedId ?? store.addHouse(position);
      if (store.selectedId) store.updateObject(id, { position });

      void settlePlacement(id);
    });

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
      layer.destroy();
      scene.destroy();
      sceneRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const shadowOrigin = selected?.position ?? INITIAL_SITE;
  const shadowHeight = selected
    ? entryForModelUrl(selected.modelUrl)?.heightMeters ?? 8
    : 8;

  const solar = solarPosition(
    date,
    shadowOrigin.latitude,
    shadowOrigin.longitude,
    UTC_OFFSET_HOURS,
  );
  const selectedDay = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  useEffect(() => {
    sceneRef.current?.setLiveShadow(
      visualShadow(date, shadowOrigin, shadowHeight, UTC_OFFSET_HOURS),
    );
  }, [date, shadowOrigin, shadowHeight]);

  useEffect(() => {
    sceneRef.current?.setShadowTrail(
      dailyShadowTrail(date, shadowOrigin, shadowHeight, UTC_OFFSET_HOURS),
    );
  }, [selectedDay, shadowOrigin, shadowHeight]);

  const handlePlace = () => {
    const scene = sceneRef.current;
    const site = useSolarHouseStore.getState().site ?? INITIAL_SITE;
    const height = scene ? approxHeight(scene.globe, site.latitude, site.longitude) : 0;
    addHouse({ latitude: site.latitude, longitude: site.longitude, height });
  };

  const handleHeading = (heading: number) => {
    if (selected) updateObject(selected.id, { rotation: { ...selected.rotation, heading } });
  };

  const handleToggleTilt = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const next = !is3D;
    setIs3D(next);
    next ? scene.tiltTo3D() : scene.tiltTo2D();
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
        is3D={is3D}
        solar={solar}
        onDate={(next) => clock.setDate(next)}
        onTime={(minutes) => clock.setTimeMinutes(minutes)}
        onToggle={() => clock.toggle()}
        onSpeed={(next) => {
          setSpeed(next);
          clock.setSpeed(next);
        }}
        onHeading={handleHeading}
        onPlace={handlePlace}
        onToggleTilt={handleToggleTilt}
      />
      <div className="north">N</div>
      <div className="shadow-legend">
        <span />
        Live shadow <small>30 min trail</small>
      </div>
      <div className="location-pill">Sydney · MVP starting location</div>
    </main>
  );
}
