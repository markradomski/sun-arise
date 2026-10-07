import type { ReactNode } from "react";
import type { SolarPosition } from "../types";
import type { CameraMode } from "../cesium/CameraController";
import type { CivilZone } from "../solar/timezone";
import { formatClockMinutes } from "../solar/solarPosition";
import { civilParts } from "../solar/timezone";
import { SEASONS, SEASON_LABELS, type Season } from "../solar/seasons";
import Section from "./Section";

interface Props {
  date: Date;
  playing: boolean;
  speed: number;
  heading: number;
  cameraMode: CameraMode;
  zone: CivilZone;
  solar: SolarPosition;
  season: Season | null;
  siteName: string;
  onSeason: (season: Season) => void;
  onDate: (year: number, month: number, day: number) => void;
  onTime: (minutes: number) => void;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onHeading: (heading: number) => void;
  onPlace: () => void;
  onCameraMode: (mode: CameraMode) => void;
  children?: ReactNode;
}

const VIEWS: { mode: CameraMode; label: string }[] = [
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
          <h1>{props.siteName}</h1>
        </div>
      </div>

      <Section title="Site" defaultOpen={!isNarrowViewport()}>
        <div className="button-row">
          {VIEWS.map(({ mode, label }) => (
            <button
              key={mode}
              className={props.cameraMode === mode ? "active" : ""}
              onClick={() => props.onCameraMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="field-row">
          <span className="field-label">Facing</span>
          <span className="field-value">{Math.round(props.heading)}°</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="359"
          value={props.heading}
          onChange={(e) => props.onHeading(Number(e.target.value))}
        />

        <button className="secondary" onClick={props.onPlace}>
          Add another house
        </button>
      </Section>

      <Section
        title="Sun &amp; season"
        badge={props.season ? SEASON_LABELS[props.season] : formatShortDate(parts)}
      >
        <div className="button-row">
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

        <input
          type="date"
          value={dateValue}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split("-").map(Number);
            if (y && m && d) props.onDate(y, m, d);
          }}
        />

        <div className="time-row">
          <span className="time">{formatClockMinutes(minutes)}</span>
          <span className="muted">{props.solar.altitudeDeg.toFixed(0)}° above horizon</span>
        </div>
        <input
          className="range"
          type="range"
          min="0"
          max="1439"
          value={minutes}
          onChange={(e) => props.onTime(Number(e.target.value))}
        />

        <div className="transport">
          <button
            className={`play ${props.playing ? "playing" : ""}`}
            onClick={props.onToggle}
          >
            {props.playing ? "Ⅱ" : "▶"}
          </button>
          <button className={props.speed === 1 ? "active" : ""} onClick={() => props.onSpeed(1)}>1×</button>
          <button className={props.speed === 12 ? "active" : ""} onClick={() => props.onSpeed(12)}>12×</button>
          <button className={props.speed === 60 ? "active" : ""} onClick={() => props.onSpeed(60)}>60×</button>
        </div>

        <div className="sun-facts">
          <span>Sunrise {formatClockMinutes(props.solar.sunriseMinutes)}</span>
          <span>Sunset {formatClockMinutes(props.solar.sunsetMinutes)}</span>
          <span className="muted">{props.zone.abbreviation || props.zone.timeZone}</span>
        </div>
      </Section>

      {props.children}

      <p className="hint">Drag the house to move it · drag the white handle to turn it</p>
    </aside>
  );
}

/** On a phone-width panel the demo flow must lead, so Site starts collapsed. */
function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 700;
}

function formatShortDate(parts: { day: number; month: number }): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${parts.day} ${months[parts.month - 1]}`;
}
