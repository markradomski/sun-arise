import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SolarPosition } from "../types";
import type { CameraMode } from "../cesium/CameraController";
import type { CivilZone } from "../solar/timezone";
import { formatClockMinutes } from "../solar/solarPosition";
import { civilParts } from "../solar/timezone";
import { SEASONS, SEASON_LABELS, type Season } from "../solar/seasons";
import Section from "./Section";
import type { AppMode } from "../state/store";
import type { InstallationCamera } from "../optics/camera";

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
  appMode: AppMode;
  onAppMode: (mode: AppMode) => void;
  /** Shared location navigation, rendered inside the Site section. */
  location?: ReactNode;
  children?: ReactNode;
  surfCam?: InstallationCamera | null;
  lookingThrough?: boolean;
  onSurfCamChange?: (patch: Partial<InstallationCamera>) => void;
  onSurfCamPreview?: () => void;
}

const APP_MODES: { mode: AppMode; label: string }[] = [
  { mode: "SOLAR", label: "Solar analysis" },
  { mode: "SURF_CAM", label: "Surf cam" },
];

const VIEWS: { mode: CameraMode; label: string }[] = [
  { mode: "ORBIT", label: "Orbit" },
  { mode: "REGION", label: "Region" },
  { mode: "SITE", label: "Site" },
  { mode: "HOUSE", label: "House" },
  { mode: "SOLAR", label: "Solar" },
];

export default function Controls(props: Props) {
  /**
   * Presentation only, and deliberately local to this component.
   *
   * Collapsing is a view preference, not scene state, so it stays out of the
   * store. Keeping it here also means switching workflow preserves it for
   * free: only the panel's children swap, this component never unmounts.
   */
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();

  /**
   * Toggling swaps which of the two buttons exists, so without this the
   * keyboard user's focus falls back to the document and their next Tab
   * restarts from the top of the page. Move it to whichever control replaced
   * the one they just pressed — and only then, so the panel never steals
   * focus on first render.
   */
  // One ref each: the collapse button lives in the body, which stays mounted
  // and merely hidden, so a shared ref would be left pointing at nothing the
  // moment the rail unmounted.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    toggleRef.current?.focus();
  }, [collapsed]);

  const toggleCollapsed = () => {
    refocus.current = true;
    setCollapsed((value) => !value);
  };

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
    <aside className={`controls${collapsed ? " collapsed" : ""}`}>
      <button
        ref={toggleRef}
        type="button"
        className="panel-toggle panel-toggle-fixed"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={collapsed ? "Expand control panel" : "Collapse control panel"}
        title={collapsed ? "Expand panel" : "Collapse panel"}
      >
        {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      </button>
      {collapsed && (
        <div className="surf-dock" role="toolbar" aria-label="Compact Sun Arise controls">
          <div className="dock-brand"><BrandMark /><strong>Sun Arise</strong></div>
          {props.appMode === "SURF_CAM" ? (
            <>
              <div className="dock-status"><span className="dock-caption">Camera</span><strong>{props.surfCam ? `${props.surfCam.mountHeightMeters.toFixed(1)} m mount` : "Not placed"}</strong></div>
              {props.surfCam && (
                <>
                  {([
                    ["Bearing", "bearingDeg", 0, 359],
                    ["Tilt", "tiltDeg", 0, 90],
                    ["FOV", "horizontalFovDeg", 1, 120],
                  ] as const).map(([label, field, min, max]) => (
                    <label className="dock-control" key={field}>
                      <span>{label} <strong>{Math.round(props.surfCam![field])}°</strong></span>
                      <input type="range" min={min} max={max} value={props.surfCam![field]} onChange={(e) => props.onSurfCamChange?.({ [field]: Number(e.target.value) })} />
                    </label>
                  ))}
                  <button className="dock-preview" onClick={props.onSurfCamPreview}>{props.lookingThrough ? "Return to map" : "Look through camera"}</button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="dock-status"><span className="dock-caption">Solar analysis</span><strong>{formatClockMinutes(minutes)}</strong></div>
              <label className="dock-control dock-solar-time">
                <span>Time <strong>{formatClockMinutes(minutes)}</strong></span>
                <input type="range" min="0" max="1439" value={minutes} onChange={(e) => props.onTime(Number(e.target.value))} />
              </label>
              <button className="dock-preview" onClick={props.onToggle}>{props.playing ? "Pause sun" : "Play sun"}</button>
              <div className="dock-sun-status">Sun {Math.round(props.solar.altitudeDeg)}° above horizon</div>
            </>
          )}
        </div>
      )}

      {/* Kept mounted while collapsed — hiding it preserves every control's
          state, and `display: none` also takes it out of the tab order and
          the accessibility tree. */}
      <div className="controls-body" id={bodyId}>
      <div className="brand sticky-brand">
        <BrandMark />
        <div className="brand-text">
          <h1>Sun Arise</h1>
          <p className="eyebrow">Light places better</p>
          <p className="brand-location">{props.siteName}</p>
        </div>
      </div>

      <div className="segmented" role="group" aria-label="Workflow">
        {APP_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            className={props.appMode === mode ? "active" : ""}
            aria-pressed={props.appMode === mode}
            onClick={() => props.onAppMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      <Section title="Site" defaultOpen={!isNarrowViewport()}>
        {props.location}

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

      {props.appMode === "SOLAR" && (
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
      )}

      {props.children}

      <p className="hint">Drag the house to move it · drag the white handle to turn it</p>
      </div>
    </aside>
  );
}

/**
 * The circular sunrise mark, shown in both the header and the collapsed rail.
 *
 * Decorative in both places: the wordmark beside it already carries the name,
 * so an alt text here would only repeat it to a screen reader.
 */
function BrandMark() {
  return (
    <img
      className="brand-mark"
      src="/brand/sun-arise-mark.png"
      alt=""
      aria-hidden="true"
      width={256}
      height={256}
      draggable={false}
    />
  );
}

/**
 * Lucide `panel-left-close` and `panel-left-open`, inlined.
 *
 * Two icons do not justify a dependency, and the strokes inherit
 * `currentColor` so they pick up the button's hover and focus states.
 */
function PanelIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      {children}
    </svg>
  );
}

function PanelLeftCloseIcon() {
  return (
    <PanelIcon>
      <path d="m16 15-3-3 3-3" />
    </PanelIcon>
  );
}

function PanelLeftOpenIcon() {
  return (
    <PanelIcon>
      <path d="m14 9 3 3-3 3" />
    </PanelIcon>
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
