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
}

export default function SurfCamPanel(props: Props) {
  const camera = props.camera;
  const ids = {
    height: useId(),
    bearing: useId(),
    tilt: useId(),
    fov: useId(),
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
