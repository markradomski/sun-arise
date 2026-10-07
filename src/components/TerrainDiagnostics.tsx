import { useState } from "react";
import { compassPoint } from "../scene/terrainAnalysis";
import {
  selectSelectedObject,
  useSolarHouseStore,
} from "../state/store";

export interface FieldDiagnostics {
  cols: number;
  rows: number;
  pointCount: number;
  spacingMeters: number;
  extentMeters: number;
  sunSamples: number;
  computeMs: number;
  overlayMs: number;
}

export default function TerrainDiagnostics(props: { field: FieldDiagnostics | null }) {
  const [open, setOpen] = useState(false);
  const status = useSolarHouseStore((s) => s.terrainStatus);
  const providerName = useSolarHouseStore((s) => s.terrainProviderName);
  const selected = useSolarHouseStore(selectSelectedObject);
  const terrain = useSolarHouseStore((s) =>
    selected ? s.terrain[selected.id] : undefined,
  );

  if (!open) {
    return (
      <button
        className="terrain-toggle"
        onClick={() => setOpen(true)}
        title="Diagnostics"
      >
        <span className={`terrain-dot ${status.toLowerCase()}`} />
        Diagnostics
      </button>
    );
  }

  return (
    <div className="terrain-panel">
      <div className="terrain-head">
        <span className={`terrain-dot ${status.toLowerCase()}`} />
        <strong>{status}</strong>
        <button onClick={() => setOpen(false)}>×</button>
      </div>

      <div className="terrain-row">
        <span>Provider</span>
        <span>{providerName || "—"}</span>
      </div>

      {props.field && (
        <>
          <div className="terrain-row">
            <span>Grid</span>
            <span>
              {props.field.cols}×{props.field.rows} · {props.field.pointCount} pts
            </span>
          </div>
          <div className="terrain-row">
            <span>Coverage</span>
            <span>
              {props.field.extentMeters} m @ {props.field.spacingMeters} m
            </span>
          </div>
          <div className="terrain-row">
            <span>Sun samples</span>
            <span>{props.field.sunSamples}</span>
          </div>
          <div className="terrain-row">
            <span>Compute</span>
            <span>
              {props.field.computeMs.toFixed(0)} / {props.field.overlayMs.toFixed(0)} ms
            </span>
          </div>
        </>
      )}

      {!selected && <p className="terrain-note">No object selected.</p>}

      {selected && !terrain && (
        <p className="terrain-note">
          {status === "READY"
            ? "No footprint analysis yet."
            : "Real terrain has not been analysed."}
        </p>
      )}

      {selected && terrain && (
        <>
          <div className="terrain-row">
            <span>Elevation</span>
            <span>{terrain.levelElevation.toFixed(1)} m</span>
          </div>
          <div className="terrain-row">
            <span>Footprint min</span>
            <span>{terrain.minimum.toFixed(1)} m</span>
          </div>
          <div className="terrain-row">
            <span>Footprint max</span>
            <span>{terrain.maximum.toFixed(1)} m</span>
          </div>
          <div className="terrain-row">
            <span>Range</span>
            <span>{terrain.range.toFixed(2)} m</span>
          </div>
          <div className="terrain-row">
            <span>Slope</span>
            <span>{terrain.slopeDeg.toFixed(1)}°</span>
          </div>
          <div className="terrain-row">
            <span>Direction</span>
            <span>
              {terrain.downslopeBearing === undefined
                ? "—"
                : `${compassPoint(terrain.downslopeBearing)} (${terrain.downslopeBearing.toFixed(0)}°)`}
            </span>
          </div>
          <div className="terrain-row">
            <span>Classification</span>
            <span>{terrain.classification}</span>
          </div>
          <div className="terrain-row">
            <span>Samples</span>
            <span>
              {terrain.sampled}/{terrain.requested}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
