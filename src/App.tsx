import { useEffect, useMemo, useRef, useState } from "react";
import { CesiumScene } from "./cesium/CesiumScene";
import { HouseManager } from "./houses/HouseManager";
import { SolarClock } from "./solar/SolarClock";
import { solarPosition } from "./solar/solarPosition";
import Controls from "./components/Controls";

const INITIAL_DATE = new Date();
INITIAL_DATE.setHours(12, 0, 0, 0);

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
      <div className="location-pill">Sydney · MVP starting location</div>
    </main>
  );
}