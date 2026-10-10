import { useId } from "react";
import Section from "./Section";
import {
  cameraElevationMeters,
  LENS_PRESETS,
  MAX_HFOV_DEG,
  MAX_MOUNT_HEIGHT_METERS,
  MAX_TILT_DEG,
  MIN_HFOV_DEG,
  MIN_MOUNT_HEIGHT_METERS,
  MIN_TILT_DEG,
  nearestLensPreset,
  verticalFovDeg,
  type InstallationCamera,
} from "../optics/camera";
import { horizonDistanceMeters } from "../optics/geodesy";
import { isProposedLulworthPosition } from "../optics/camera";
import { formatCoordinates } from "../scene/location";
import {
  classificationLabel,
  indeterminateExplanation,
  type SightLineAnalysis,
} from "../optics/sightLine";
import type { SightLineState } from "../optics/sightLineAnalyser";
import {
  MAX_TARGET_HEIGHT_METERS,
  MIN_TARGET_HEIGHT_METERS,
  type SightTarget,
} from "../state/store";
import TerrainProfileChart from "./TerrainProfileChart";

interface Props {
  camera: InstallationCamera | null;
  armed: boolean;
  lookingThrough: boolean;
  terrainReady: boolean;
  onArm: () => void;
  onChange: (patch: Partial<Omit<InstallationCamera, "id">>) => void;
  onReset: () => void;
  onClear: () => void;
  onLookThrough: () => void;
  onReturnView: () => void;

  target: SightTarget | null;
  targetArmed: boolean;
  sightLine: SightLineState;
  onArmTarget: () => void;
  onTargetHeight: (heightMeters: number) => void;
  onRemoveTarget: () => void;
}

export default function SurfCamPanel(props: Props) {
  const camera = props.camera;
  const ids = {
    height: useId(),
    bearing: useId(),
    tilt: useId(),
    fov: useId(),
    targetHeight: useId(),
  };

  return (
    <>
      <Section title="Camera mount">
        <div className="button-row">
          <button
            className={props.armed ? "active" : ""}
            onClick={props.onArm}
            aria-pressed={props.armed}
          >
            {props.armed ? "Click the terrain…" : "Place camera"}
          </button>
          {camera && (
            <button className="secondary" onClick={props.onReset}>
              Reset
            </button>
          )}
        </div>

        {!props.terrainReady && (
          <p className="note warn">
            Real terrain is not ready. Mount elevation cannot be sampled, and
            none will be invented.
          </p>
        )}

        {!camera && (
          <p className="note">
            Place a camera on the terrain to set its mount point.
          </p>
        )}

        {camera && (
          <>
            <dl className="readout-grid">
              <div>
                <dt>Position</dt>
                <dd>{formatCoordinates(camera.ground)}</dd>
              </div>
              <div>
                <dt>Terrain</dt>
                <dd>{camera.ground.height.toFixed(1)} m</dd>
              </div>
              <div>
                <dt>Mount height</dt>
                <dd>{camera.mountHeightMeters.toFixed(1)} m above terrain</dd>
              </div>
              <div>
                <dt>Camera elevation</dt>
                <dd>{cameraElevationMeters(camera).toFixed(1)} m</dd>
              </div>
            </dl>
            {isProposedLulworthPosition(camera.ground) && (
              <p className="note warn">
                Proposed position only. This coordinate came from geocoding 43
                Hurst Street and has not been confirmed on the ground, and the
                terrain model carries no trees, fences or buildings. Drag or
                re-place the camera to test a mount you have verified.
              </p>
            )}

            <p className="note muted">
              Elevations are metres above the WGS84 ellipsoid, not above mean
              sea level. Mount height is measured from the sampled terrain.
            </p>

            <Slider
              id={ids.height}
              label="Mount height"
              value={camera.mountHeightMeters}
              min={MIN_MOUNT_HEIGHT_METERS}
              max={MAX_MOUNT_HEIGHT_METERS}
              step={0.5}
              suffix=" m"
              onChange={(mountHeightMeters) => props.onChange({ mountHeightMeters })}
            />
          </>
        )}
      </Section>

      {camera && (
        <Section title="Aim">
          <Slider
            id={ids.bearing}
            label="Bearing"
            value={camera.bearingDeg}
            min={0}
            max={359}
            step={1}
            suffix="° from north"
            onChange={(bearingDeg) => props.onChange({ bearingDeg })}
          />
          <Slider
            id={ids.tilt}
            label="Downward tilt"
            value={camera.tiltDeg}
            min={MIN_TILT_DEG}
            max={MAX_TILT_DEG}
            step={1}
            suffix="° below horizontal"
            onChange={(tiltDeg) => props.onChange({ tiltDeg })}
          />
        </Section>
      )}

      {camera && (
        <Section title="Lens">
          <div className="button-row">
            {LENS_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={
                  nearestLensPreset(camera.horizontalFovDeg).id === preset.id
                    ? "active"
                    : ""
                }
                onClick={() =>
                  props.onChange({ horizontalFovDeg: preset.horizontalFovDeg })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          <Slider
            id={ids.fov}
            label="Horizontal field of view"
            value={camera.horizontalFovDeg}
            min={MIN_HFOV_DEG}
            max={MAX_HFOV_DEG}
            step={1}
            suffix="°"
            onChange={(horizontalFovDeg) => props.onChange({ horizontalFovDeg })}
          />

          <dl className="readout-grid">
            <div>
              <dt>Vertical FOV</dt>
              <dd>{verticalFovDeg(camera.horizontalFovDeg).toFixed(1)}° at 16:9</dd>
            </div>
            <div>
              <dt>Sea horizon</dt>
              <dd>
                {(horizonDistanceMeters(cameraElevationMeters(camera)) / 1000).toFixed(
                  1,
                )}{" "}
                km
              </dd>
            </div>
          </dl>
          <p className="note muted">
            Horizon distance assumes an unobstructed sea surface and standard
            refraction. It is not a visibility result: no terrain, vegetation or
            buildings have been tested.
          </p>
        </Section>
      )}

      {camera && (
        <Section title="Terrain visibility">
          <div className="button-row">
            <button
              className={props.targetArmed ? "active" : ""}
              onClick={props.onArmTarget}
              aria-pressed={props.targetArmed}
            >
              {props.targetArmed
                ? "Click the bay…"
                : props.target
                  ? "Replace target"
                  : "Place target"}
            </button>
            {props.target && (
              <button className="secondary" onClick={props.onRemoveTarget}>
                Remove target
              </button>
            )}
          </div>

          {props.targetArmed && (
            <p className="note">
              Click a spot in the scene to test the view to it. Escape cancels.
            </p>
          )}

          {!props.target && !props.targetArmed && (
            <p className="note">
              Place a target out in the bay to test whether terrain blocks the
              camera's view of it.
            </p>
          )}

          {props.target && (
            <>
              <dl className="readout-grid">
                <div>
                  <dt>Target</dt>
                  <dd>{formatCoordinates(props.target.ground)}</dd>
                </div>
                <div>
                  <dt>Target terrain</dt>
                  <dd>{props.target.ground.height.toFixed(1)} m</dd>
                </div>
              </dl>

              <Slider
                id={ids.targetHeight}
                label="Target height"
                value={props.target.heightMeters}
                min={MIN_TARGET_HEIGHT_METERS}
                max={MAX_TARGET_HEIGHT_METERS}
                step={0.5}
                suffix=" m above terrain"
                onChange={props.onTargetHeight}
              />

              <SightLineReadout state={props.sightLine} />
            </>
          )}

          <p className="note muted">
            Tests sampled bare-earth terrain only. Trees, fences, buildings,
            masts, wave height, haze and what the lens can actually resolve are
            not modelled, and the line drawn in the scene is not evidence that
            anything is visible.
          </p>
        </Section>
      )}

      {camera && (
        <Section title="Preview">
          <div className="button-row">
            {props.lookingThrough ? (
              <button className="active" onClick={props.onReturnView}>
                Return to my view
              </button>
            ) : (
              <button onClick={props.onLookThrough}>Look through camera</button>
            )}
          </div>
          {props.lookingThrough && (
            <p className="note warn">
              The navigation view is borrowed to show the camera's aim. Press
              Return to my view to get your own view back.
            </p>
          )}
          <p className="note muted">
            This moves your existing view to the mount. It is a real-time
            approximation of the framing, not a rendered camera image.
          </p>
          <button className="link" onClick={props.onClear}>
            Remove camera
          </button>
        </Section>
      )}
    </>
  );
}

function SightLineReadout({ state }: { state: SightLineState }) {
  switch (state.status) {
    case "IDLE":
      return null;
    case "PENDING":
      return <p className="note">Sampling terrain along the sight line…</p>;
    case "FAILED":
      return (
        <p className="note warn">
          Terrain could not be sampled, so there is no result: {state.message}
        </p>
      );
    case "READY":
      return <SightLineResult analysis={state.analysis} />;
  }
}

function SightLineResult({ analysis }: { analysis: SightLineAnalysis }) {
  const { lineOfSight: result } = analysis;
  const indeterminate = analysis.classification === "INDETERMINATE";

  return (
    <>
      <p className={`verdict verdict-${analysis.classification.toLowerCase()}`}>
        {classificationLabel(analysis)}
      </p>

      <dl className="readout-grid">
        <div>
          <dt>Distance</dt>
          <dd>{formatDistance(analysis.distanceMeters)}</dd>
        </div>
        <div>
          <dt>Bearing</dt>
          <dd>{analysis.initialBearingDeg.toFixed(1)}° from north</dd>
        </div>
        <div>
          <dt>Target angle</dt>
          <dd>
            {Math.abs(analysis.targetElevationAngleDeg).toFixed(2)}°{" "}
            {analysis.targetElevationAngleDeg <= 0 ? "below" : "above"} horizontal
          </dd>
        </div>
        {!indeterminate && (
          <div>
            <dt>Min clearance</dt>
            <dd>
              {result.minimumClearanceMeters.toFixed(1)} m at{" "}
              {formatDistance(result.minimumClearanceAtMeters)}
            </dd>
          </div>
        )}
      </dl>

      {analysis.classification === "OBSTRUCTED" && result.blockedAtMeters !== null && (
        <p className="note warn">
          Terrain first rises through the sight line{" "}
          {formatDistance(result.blockedAtMeters)} from the camera.
        </p>
      )}

      {analysis.marginal && (
        <p className="note warn">
          The margin is smaller than the terrain model's own resolution, so
          treat this as undecided rather than{" "}
          {analysis.classification === "OBSTRUCTED" ? "blocked" : "clear"}.
        </p>
      )}

      {analysis.grazingApproach && (
        <p className="note muted">
          The target sits on the sampled surface, so the sight line necessarily
          closes on it near the end. Raise the target height to represent a
          wave or an object standing above the water.
        </p>
      )}

      {indeterminate && analysis.reason && (
        <p className="note warn">{indeterminateExplanation(analysis.reason)}</p>
      )}

      <TerrainProfileChart analysis={analysis} />

      <p className="note muted">
        {result.samples.length} terrain samples, finest spacing{" "}
        {analysis.profile.spacingMeters.toFixed(0)} m. Refraction uses a
        standard-atmosphere coefficient of {analysis.refractionK}, which is an
        assumption about the air, not a measurement of it.
      </p>
    </>
  );
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="slider-field">
      <div className="field-row">
        <label className="field-label" htmlFor={props.id}>
          {props.label}
        </label>
        <span className="field-value">
          {props.value.toFixed(props.step < 1 ? 1 : 0)}
          {props.suffix}
        </span>
      </div>
      <input
        id={props.id}
        className="range"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  );
}
