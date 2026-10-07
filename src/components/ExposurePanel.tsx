import type { PointExposure } from "../solar/exposure";
import type { CivilZone } from "../solar/timezone";
import { civilParts } from "../solar/timezone";
import { LEGEND_GRADIENT_CSS, LEGEND_TICKS } from "../solar/exposureRamp";
import { SEASON_LABELS } from "../solar/seasons";
import type { SeasonalPoint } from "../solar/seasonalComparison";
import Section from "./Section";

export interface ComparisonPair {
  baseline: number;
  current: number;
}

export interface PlacementComparison {
  area8h: ComparisonPair;
  area6h: ComparisonPair;
  averageMinutes: ComparisonPair;
  point: ComparisonPair | null;
}

interface Props {
  exposure: PointExposure | null;
  seasonal: SeasonalPoint[] | null;
  zone: CivilZone;
  armed: boolean;
  fieldEnabled: boolean;
  fieldPending: boolean;
  comparison: PlacementComparison | null;
  hasBaseline: boolean;
  /** Metres the house has moved from the ground the comparison is anchored to. */
  baselineDriftMeters: number | null;
  onArm: () => void;
  onClear: () => void;
  onToggleField: () => void;
  onSetBaseline: () => void;
  onClearBaseline: () => void;
}

/** Beyond this the house is leaving the compared ground, so say so. */
const DRIFT_WARNING_METERS = 24;

export default function ExposurePanel(props: Props) {
  const e = props.exposure;
  const sun = e?.intervals.filter((i) => i.state === "SUN") ?? [];
  const shade = e?.intervals.filter((i) => i.state === "BLOCKED") ?? [];

  return (
    <>
      <Section title="Sunlight">
        <div className="button-row">
          <button
            className={props.fieldEnabled ? "active" : ""}
            onClick={props.onToggleField}
          >
            {props.fieldEnabled ? "Hide sunlight map" : "Show sunlight map"}
          </button>
          <button className={props.armed ? "active" : ""} onClick={props.onArm}>
            {props.armed ? "Click a spot…" : "Inspect a spot"}
          </button>
        </div>

        <div className="legend">
          <div className="legend-bar" style={{ background: LEGEND_GRADIENT_CSS }} />
          <div className="legend-ticks">
            {LEGEND_TICKS.map((tick) => (
              <span key={tick.label} style={{ left: `${tick.position * 100}%` }}>
                {tick.label}
              </span>
            ))}
          </div>
          <div className="legend-caption muted">
            <span>less</span>
            <span>hours of direct sun</span>
            <span>more</span>
          </div>
        </div>

        {props.fieldEnabled && props.fieldPending && (
          <p className="note">Calculating…</p>
        )}

        {!e && (
          <p className="note">
            {props.armed
              ? "Click anywhere on the ground."
              : "Inspect a spot to see how much sun it gets."}
          </p>
        )}

        {e && (
          <div className="readout">
            <div className="readout-headline">
              <strong>{formatDuration(e.directSunMinutes)}</strong>
              <span className="muted">
                of {formatDuration(e.daylightMinutes)} daylight
              </span>
            </div>

            <IntervalRow
              label="Sun"
              intervals={sun}
              timeZone={props.zone.timeZone}
            />
            <IntervalRow
              label="Shade"
              intervals={shade}
              timeZone={props.zone.timeZone}
            />

            {props.seasonal && (
              <div className="seasonal">
                {props.seasonal.map((entry) => (
                  <div key={entry.season}>
                    <span>{SEASON_LABELS[entry.season]}</span>
                    <strong>{formatDuration(entry.directSunMinutes)}</strong>
                  </div>
                ))}
              </div>
            )}

            <button className="link" onClick={props.onClear}>
              Clear spot
            </button>
          </div>
        )}
      </Section>

      <Section
        title="Compare placement"
        badge={props.hasBaseline ? "saved" : undefined}
      >
        <div className="button-row">
          <button
            className={props.hasBaseline ? "active" : ""}
            onClick={props.onSetBaseline}
          >
            {props.hasBaseline ? "Save new baseline" : "Save this placement"}
          </button>
          {props.hasBaseline && <button onClick={props.onClearBaseline}>Clear</button>}
        </div>

        {!props.hasBaseline && (
          <p className="note">
            Save the current placement, then move the house to see what changes.
          </p>
        )}

        {props.hasBaseline && !props.comparison && (
          <p className="note">Turn on the sunlight map to compare.</p>
        )}

        {props.comparison && (
          <>
            <div className="compare compare-head">
              <span />
              <span>Saved</span>
              <span>Now</span>
              <span>Change</span>
            </div>
            <CompareRow
              label="8h+ sun"
              pair={props.comparison.area8h}
              format={formatArea}
              delta={areaDelta}
            />
            <CompareRow
              label="6h+ sun"
              pair={props.comparison.area6h}
              format={formatArea}
              delta={areaDelta}
            />
            <CompareRow
              label="Average"
              pair={props.comparison.averageMinutes}
              format={shortDuration}
              delta={minutesDelta}
            />
            {props.comparison.point && (
              <CompareRow
                label="This spot"
                pair={props.comparison.point}
                format={shortDuration}
                delta={minutesDelta}
              />
            )}

            {props.baselineDriftMeters !== null &&
              props.baselineDriftMeters > DRIFT_WARNING_METERS && (
                <p className="note warn">
                  House has moved {Math.round(props.baselineDriftMeters)} m from the
                  compared area. Save a new baseline to recentre it.
                </p>
              )}
          </>
        )}
      </Section>
    </>
  );
}

function IntervalRow(props: {
  label: string;
  intervals: { start: Date; end: Date }[];
  timeZone: string;
}) {
  return (
    <div className="interval-row">
      <span className="interval-label">{props.label}</span>
      <span className="interval-values">
        {props.intervals.length === 0
          ? "none"
          : props.intervals
              .map(
                (i) =>
                  `${formatTime(i.start, props.timeZone)}–${formatTime(i.end, props.timeZone)}`,
              )
              .join("   ")}
      </span>
    </div>
  );
}

function CompareRow(props: {
  label: string;
  pair: ComparisonPair;
  format: (value: number) => string;
  delta: (pair: ComparisonPair) => { text: string; direction: number };
}) {
  const { text, direction } = props.delta(props.pair);
  const tone = direction > 0 ? "up" : direction < 0 ? "down" : "flat";
  return (
    <div className="compare">
      <span>{props.label}</span>
      <span>{props.format(props.pair.baseline)}</span>
      <span>{props.format(props.pair.current)}</span>
      <span className={`delta ${tone}`}>{text}</span>
    </div>
  );
}

function formatArea(squareMeters: number): string {
  return `${Math.round(squareMeters)} m²`;
}

function areaDelta(pair: ComparisonPair) {
  const change = pair.current - pair.baseline;
  if (pair.baseline === 0) {
    return { text: change === 0 ? "—" : "new", direction: Math.sign(change) };
  }
  const percent = (change / pair.baseline) * 100;
  if (Math.round(percent) === 0) return { text: "—", direction: 0 };
  return {
    text: `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(0)}%`,
    direction: Math.sign(change),
  };
}

function minutesDelta(pair: ComparisonPair) {
  const change = Math.round(pair.current - pair.baseline);
  if (change === 0) return { text: "—", direction: 0 };
  return {
    text: `${change > 0 ? "+" : "−"}${shortDuration(Math.abs(change))}`,
    direction: Math.sign(change),
  };
}

function shortDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
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
