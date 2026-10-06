import type { PointExposure } from "../solar/exposure";
import type { CivilZone } from "../solar/timezone";
import { civilParts } from "../solar/timezone";

interface Props {
  exposure: PointExposure | null;
  zone: CivilZone;
  armed: boolean;
  onArm: () => void;
  onClear: () => void;
}

export default function ExposurePanel(props: Props) {
  if (!props.exposure) {
    return (
      <button
        className={`probe-toggle ${props.armed ? "armed" : ""}`}
        onClick={props.onArm}
      >
        <span className="probe-dot" />
        {props.armed ? "Click the ground" : "Sun probe"}
      </button>
    );
  }

  const e = props.exposure;
  const sun = e.intervals.filter((i) => i.state === "SUN");

  return (
    <div className="probe-panel">
      <div className="probe-head">
        <span className="probe-dot" />
        <strong>DIRECT SUN</strong>
        <button onClick={props.onClear}>×</button>
      </div>

      <div className="probe-row">
        <span>Date</span>
        <span>{formatDate(e.date, props.zone.timeZone)}</span>
      </div>
      <div className="probe-row">
        <span>Daylight</span>
        <span>{formatDuration(e.daylightMinutes)}</span>
      </div>
      <div className="probe-row">
        <span>Direct sun</span>
        <span>{formatDuration(e.directSunMinutes)}</span>
      </div>
      <div className="probe-row">
        <span>Share</span>
        <span>{(e.directSunFraction * 100).toFixed(0)}%</span>
      </div>

      <div className="probe-intervals">
        {sun.length === 0 && <span className="probe-note">No direct sun.</span>}
        {sun.map((interval) => (
          <span key={interval.start.toISOString()}>
            {formatTime(interval.start, props.zone.timeZone)}–
            {formatTime(interval.end, props.zone.timeZone)}
          </span>
        ))}
      </div>

      <p className="probe-note">
        Sampled every {e.sampleIntervalMinutes} min · house only
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
