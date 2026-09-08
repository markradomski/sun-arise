import { useEffect, useMemo, useRef, useState } from "react";
import { CesiumScene } from "./cesium/CesiumScene";
import type { ShadowSegment } from "./cesium/CesiumScene";
import { HouseManager } from "./houses/HouseManager";
import { SolarClock } from "./solar/SolarClock";
import { solarPosition } from "./solar/solarPosition";
import Controls from "./components/Controls";

const INITIAL_DATE = new Date();
INITIAL_DATE.setHours(12, 0, 0, 0);
const HOUSE_HEIGHT_METERS = 8;
const MAX_SHADOW_LENGTH_METERS = 150;
const SHADOW_TRAIL_INTERVAL_MINUTES = 30;
const EARTH_RADIUS_METERS = 6_371_000;

function visualShadow(
  date: Date,
  location: { latitude: number; longitude: number; height: number }
): ShadowSegment | undefined {
  const sun = solarPosition(date, location.latitude, location.longitude, 10);
  if (sun.altitudeDeg <= 0) return undefined;

  const shadowLength = Math.min(
    HOUSE_HEIGHT_METERS / Math.tan(sun.altitudeDeg * Math.PI / 180),
    MAX_SHADOW_LENGTH_METERS,
  );
  const bearing = (sun.azimuthDeg + 180) * Math.PI / 180;
  const angularDistance = shadowLength / EARTH_RADIUS_METERS;
  const latitude = location.latitude * Math.PI / 180;
  const longitude = location.longitude * Math.PI / 180;
  const endLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const endLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(endLatitude),
  );

  return {
    start: { ...location, height: location.height + 0.2 },
    end: {
      latitude: endLatitude * 180 / Math.PI,
      longitude: endLongitude * 180 / Math.PI,
      height: location.height + 0.2,
    },
  };
}

function dailyShadowTrail(
  date: Date,
  location: { latitude: number; longitude: number; height: number }
) {
  return Array.from({ length: 1440 / SHADOW_TRAIL_INTERVAL_MINUTES }, (_, index) => {
    const sample = new Date(date);
    sample.setHours(0, index * SHADOW_TRAIL_INTERVAL_MINUTES, 0, 0);
    return visualShadow(sample, location);
  }).filter((segment): segment is ShadowSegment => segment !== undefined);
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CesiumScene | null>(null);
  const houseRef = useRef<HouseManager | null>(null);

  const [date, setDate] = useState(INITIAL_DATE);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [heading, setHeading] = useState(0);
  const [location, setLocation] = useState({ latitude: -33.8688, longitude: 151.2093, height: 0 });
  const [is3D, setIs3D] = useState(true);

  const clock = useMemo(() => new SolarClock(INITIAL_DATE), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new CesiumScene(containerRef.current);
    const house = new HouseManager(scene);
    sceneRef.current = scene;
    houseRef.current = house;

    scene.onLocationPick((nextLocation) => {
      setLocation(nextLocation);
      house.placeDefault(nextLocation).catch(console.error);
    });

    house.placeDefault(location).catch(console.error);

    const unsubscribe = clock.subscribe((state) => {
      setDate(state.date);
      setPlaying(state.playing);
      scene.setDate(state.date);
    });

    return () => {
      unsubscribe();
      scene.destroy();
      sceneRef.current = null;
      houseRef.current = null;
    };
  }, []);

  const solar = solarPosition(date, location.latitude, location.longitude, 10);
  const selectedDay = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  useEffect(() => {
    sceneRef.current?.setLiveShadow(visualShadow(date, location));
  }, [date, location]);

  useEffect(() => {
    sceneRef.current?.setShadowTrail(dailyShadowTrail(date, location));
  }, [selectedDay, location]);

  const handlePlace = () => {
    houseRef.current?.placeDefault(location).catch(console.error);
  };

  const handleDate = (next: Date) => {
    clock.setDate(next);
  };

  const handleTime = (minutes: number) => {
    clock.setTimeMinutes(minutes);
  };

  const handleToggleTilt = () => {
    if (sceneRef.current) {
      const newIs3D = !is3D;
      setIs3D(newIs3D);
      if (newIs3D) {
        sceneRef.current.tiltTo3D();
      } else {
        sceneRef.current.tiltTo2D();
      }
    }
  };

  return (
    <main className="app">
      <div ref={containerRef} className="globe" />
      <div className="vignette" />
      <Controls
        date={date}
        playing={playing}
        speed={speed}
        heading={heading}
        is3D={is3D}
        solar={solar}
        onDate={handleDate}
        onTime={handleTime}
        onToggle={() => clock.toggle()}
        onSpeed={(next) => { setSpeed(next); clock.setSpeed(next); }}
        onHeading={(next) => { setHeading(next); houseRef.current?.setHeading(next); }}
        onPlace={handlePlace}
        onToggleTilt={handleToggleTilt}
      />
      <div className="north">N</div>
      <div className="shadow-legend"><span />Live shadow <small>30 min trail</small></div>
      <div className="location-pill">Sydney · MVP starting location</div>
    </main>
  );
}
