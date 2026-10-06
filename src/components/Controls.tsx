import type { SolarPosition } from "../types";
import type { CameraMode } from "../cesium/CameraController";
import type { CivilZone } from "../solar/timezone";
import { formatClockMinutes } from "../solar/solarPosition";
import { civilParts } from "../solar/timezone";
import { SEASONS, SEASON_LABELS, type Season } from "../solar/seasons";

interface Props {
  date: Date;
  playing: boolean;
  speed: number;
  heading: number;
  cameraMode: CameraMode;
  zone: CivilZone;
  solar: SolarPosition;
  season: Season | null;
  onSeason: (season: Season) => void;
  onDate: (year: number, month: number, day: number) => void;
  onTime: (minutes: number) => void;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onHeading: (heading: number) => void;
  onPlace: () => void;
  onCameraMode: (mode: CameraMode) => void;
}

const CAMERA_MODES: { mode: CameraMode; label: string }[] = [
  { mode: "ORBIT", label: "Orbit" },
  { mode: "REGION", label: "Region" },
  { mode: "SITE", label: "Site" },
  { mode: "HOUSE", label: "House" },
  { mode: "SOLAR", label: "Solar" },
];

export default function Controls(props: Props) {
  // Everything shown here is civil time at the *site*, not in the browser's
  // own timezone.
  const parts = civilParts(props.date, props.zone.timeZone);
  const minutes = parts.hour * 60 + parts.minute;

  const dateValue = [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");

  return (
    <aside className="controls">
      <div className="brand">
        <div className="brand-mark">☀</div>
        <div>
          <div className="eyebrow">SOLAR HOUSE</div>
          <h1>Drop a house.<br />Watch the sun.</h1>
        </div>
      </div>

      <button className="primary" onClick={props.onPlace}>＋ Drop house here</button>

      <section>
        <div className="section-label">VIEW</div>
        <div className="camera-modes">
          {CAMERA_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={props.cameraMode === mode ? "active" : ""}
              onClick={() => props.onCameraMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-label">SEASON</div>
        <div className="camera-modes">
          {SEASONS.map((season) => (
            <button
              key={season}
              className={props.season === season ? "active" : ""}
              onClick={() => props.onSeason(season)}
            >
              {SEASON_LABELS[season]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-label">DATE</div>
        <input
          type="date"
          value={dateValue}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split("-").map(Number);
            if (y && m && d) props.onDate(y, m, d);
          }}
        />
      </section>

      <section>
        <div className="time-row">
          <span className="time">{formatClockMinutes(minutes)}</span>
          <span className="muted">{props.solar.altitudeDeg.toFixed(1)}° altitude</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="1439"
          value={minutes}
          onChange={(e) => props.onTime(Number(e.target.value))}
        />
        <div className="range-labels"><span>00:00</span><span>12:00</span><span>24:00</span></div>
        <div className="zone-row">
          <span className="muted">{props.zone.timeZone.replace(/_/g, " ")}</span>
          <span className="muted">{props.zone.abbreviation || formatOffset(props.zone.offsetHours)}</span>
        </div>
      </section>

      <div className="transport">
        <button className={`play ${props.playing ? "playing" : ""}`} onClick={props.onToggle}>{props.playing ? "Ⅱ" : "▶"}</button>
        <button className={props.speed === 1 ? "active" : ""} onClick={() => props.onSpeed(1)}>1×</button>
        <button className={props.speed === 12 ? "active" : ""} onClick={() => props.onSpeed(12)}>12×</button>
        <button className={props.speed === 60 ? "active" : ""} onClick={() => props.onSpeed(60)}>60×</button>
      </div>

      <section>
        <div className="section-label">HOUSE ORIENTATION</div>
        <div className="time-row"><span>{Math.round(props.heading)}°</span><span className="muted">north = 0°</span></div>
        <input
          className="range"
          type="range"
          min="0"
          max="359"
          value={props.heading}
          onChange={(e) => props.onHeading(Number(e.target.value))}
        />
      </section>

      <section className="stats">
        <div><span>AZIMUTH</span><strong style={{ color: "#ffd36a" }}>{props.solar.azimuthDeg.toFixed(0)}°</strong></div>
        <div><span>SUNRISE</span><strong>{formatClockMinutes(props.solar.sunriseMinutes)}</strong></div>
        <div><span>SUNSET</span><strong>{formatClockMinutes(props.solar.sunsetMinutes)}</strong></div>
      </section>

      <p className="hint">
        Drag the house to move it · Shift+drag to rotate · click the ground to place.
      </p>
    </aside>
  );
}

function formatOffset(hours: number): string {
  const sign = hours < 0 ? "-" : "+";
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}
