import type { SolarPosition } from "../types";
import { formatClockMinutes } from "../solar/solarPosition";

interface Props {
  date: Date;
  playing: boolean;
  speed: number;
  heading: number;
  is3D: boolean;
  solar: SolarPosition;
  onDate: (date: Date) => void;
  onTime: (minutes: number) => void;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onHeading: (heading: number) => void;
  onPlace: () => void;
  onToggleTilt: () => void;
}

export default function Controls(props: Props) {
  const minutes = props.date.getHours() * 60 + props.date.getMinutes();

  const dateValue = [
    props.date.getFullYear(),
    String(props.date.getMonth() + 1).padStart(2, "0"),
    String(props.date.getDate()).padStart(2, "0"),
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
        <div className="section-label">DATE</div>
        <input
          type="date"
          value={dateValue}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split("-").map(Number);
            const next = new Date(props.date);
            next.setFullYear(y, m - 1, d);
            props.onDate(next);
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
      </section>

      <div className="transport">
        <button className={`play ${props.playing ? "playing" : ""}`} onClick={props.onToggle}>{props.playing ? "Ⅱ" : "▶"}</button>
        <button onClick={() => props.onSpeed(1)}>1×</button>
        <button onClick={() => props.onSpeed(12)}>12×</button>
        <button onClick={() => props.onSpeed(60)}>60×</button>
        <button onClick={props.onToggleTilt} title={props.is3D ? "Switch to 2D" : "Switch to 3D"}>{props.is3D ? "3D" : "2D"}</button>
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
        MVP: click/tap the globe to choose a location, then use the controls to rotate the house and run the sun through the day.
      </p>
    </aside>
  );
}