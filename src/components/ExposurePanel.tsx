import type { PointExposure } from "../solar/exposure";
import type { CivilZone } from "../solar/timezone";
import { civilParts } from "../solar/timezone";
import { LEGEND_BANDS } from "../solar/exposureRamp";
import { SEASON_LABELS } from "../solar/seasons";
import type { SeasonalPoint } from "../solar/seasonalComparison";

export interface FieldSummary {
  cols: number;
  rows: number;
  pointCount: number;
  spacingMeters: number;
  extentMeters: number;
  sunSamples: number;
  minMinutes: number;
  maxMinutes: number;
  computeMs: number;
  overlayMs: number;
  /** Ground area in square metres receiving at least eight hours of sun. */
  areaAbove8hSquareMeters: number;
  coveredAreaSquareMeters: number;
}

interface Props {
  exposure: PointExposure | null;
  seasonal: SeasonalPoint[] | null;
  zone: CivilZone;
  armed: boolean;
  field: FieldSummary | null;
  fieldEnabled: boolean;
  onArm: () => void;
  onClear: () => void;
  onToggleField: () => void;
}

export default function ExposurePanel(props: Props) {
  if (!props.exposure && !props.field) {
    return (
      <div className="probe-actions">
        <button
          className={`probe-toggle ${props.armed ? "armed" : ""}`}
          onClick={props.onArm}
        >
          <span className="probe-dot" />
          {props.armed ? "Click the ground" : "Inspect point"}
        </button>
        <button
          className={`probe-toggle ${props.fieldEnabled ? "armed" : ""}`}
          onClick={props.onToggleField}
        >
          Ground field
        </button>
      </div>
    );
  }

  const e = props.exposure;
  const sun = e?.intervals.filter((i) => i.state === "SUN") ?? [];
  const blocked = e?.intervals.filter((i) => i.state === "BLOCKED") ?? [];

  return (
    <div className="probe-panel">
      <div className="probe-head">
        <span className="probe-dot" />
        <strong>DIRECT SUN</strong>
        <button onClick={props.onClear}>×</button>
      </div>

      {props.field && (
        <>
          <div className="probe-row">
            <span>Grid</span>
            <span>
              {props.field.cols}×{props.field.rows} · {props.field.pointCount} pts
            </span>
          </div>
          <div className="probe-row">
            <span>Coverage</span>
            <span>
              {props.field.extentMeters} m @ {props.field.spacingMeters} m
            </span>
          </div>
          <div className="probe-row">
            <span>Sun samples</span>
            <span>{props.field.sunSamples}</span>
          </div>
          <div className="probe-row">
            <span>Field range</span>
            <span>
              {formatDuration(props.field.minMinutes)} – {formatDuration(props.field.maxMinutes)}
            </span>
          </div>
          <div className="probe-row">
            <span>8+ h area</span>
            <span>
              {Math.round(props.field.areaAbove8hSquareMeters)} m² (
              {(
                (props.field.areaAbove8hSquareMeters /
                  props.field.coveredAreaSquareMeters) *
                100
              ).toFixed(0)}
              %)
            </span>
          </div>
          <div className="probe-row">
            <span>Compute</span>
            <span>
              {props.field.computeMs.toFixed(0)} ms field ·{" "}
              {props.field.overlayMs.toFixed(0)} ms draw
            </span>
          </div>

          <div className="probe-legend">
            {LEGEND_BANDS.map((band) => (
              <span key={band.label}>
                <i style={{ background: band.css }} />
                {band.label}
              </span>
            ))}
          </div>
          <div className="probe-divider" />
        </>
      )}

      {e && (
        <>
          <div className="probe-row">
            <span>Date</span>
            <span>{formatDate(e.date, props.zone.timeZone)}</span>
          </div>
          <div className="probe-row">
            <span>Daylight</span>
            <span>{formatDuration(e.daylightMinutes)}</span>
          </div>
          <div className="probe-row">
            <span>Probe sun</span>
            <span>{formatDuration(e.directSunMinutes)}</span>
          </div>
          <div className="probe-row">
            <span>Share</span>
            <span>{(e.directSunFraction * 100).toFixed(0)}%</span>
          </div>

          <div className="probe-interval-group">
            <span className="probe-interval-label">Sun</span>
            <div className="probe-intervals">
              {sun.length === 0 && <span className="probe-note">none</span>}
              {sun.map((interval) => (
                <span key={interval.start.toISOString()}>
                  {formatTime(interval.start, props.zone.timeZone)}–
                  {formatTime(interval.end, props.zone.timeZone)}
                </span>
              ))}
            </div>
          </div>

          <div className="probe-interval-group">
            <span className="probe-interval-label">Shade</span>
            <div className="probe-intervals">
              {blocked.length === 0 && <span className="probe-note">none</span>}
              {blocked.map((interval) => (
                <span key={interval.start.toISOString()}>
                  {formatTime(interval.start, props.zone.timeZone)}–
                  {formatTime(interval.end, props.zone.timeZone)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {props.seasonal && (
        <>
          <div className="probe-divider" />
          <div className="probe-row probe-subhead">
            <span>THIS LOCATION</span>
          </div>
          {props.seasonal.map((entry) => (
            <div className="probe-row" key={entry.season}>
              <span>{SEASON_LABELS[entry.season]}</span>
              <span>{formatDuration(entry.directSunMinutes)}</span>
            </div>
          ))}
        </>
      )}

      <p className="probe-note">
        {props.fieldEnabled ? "Field on · " : ""}house only
      </p>
    </div>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function formatTime(date: Date, timeZone: string): string {
  const { hour, minute } = civilParts(date, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatDate(date: Date, timeZone: string): string {
  const { year, month, day } = civilParts(date, timeZone);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}
