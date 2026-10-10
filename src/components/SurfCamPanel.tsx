import { useId, useState } from "react";
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
import {
  OUTPUT_RESOLUTIONS,
  TARGET_SIZES,
  outputResolution,
} from "../optics/projection";
import type { Framing, LensComparisonRow } from "../optics/framing";
import {
  CUSTOM_TARGET_SIZE_ID,
  type CaptureSettings,
  type SavedMount,
} from "../state/store";
import {
  CAMERA_CONFIGURATIONS,
  cameraConfiguration,
  nominalRangeLabel,
} from "../optics/configurations";

interface ConfigProps {
  configurationId: string;
  onConfiguration: (id: string) => void;
  frustumVisible: boolean;
  onFrustumVisible: (visible: boolean) => void;
  savedMounts: SavedMount[];
  onSaveMount: (name: string) => void;
  onSelectMount: (id: string) => void;
  onRenameMount: (id: string, name: string) => void;
  onDeleteMount: (id: string) => void;
}

interface FramingProps {
  /** Null until a target is placed. */
  framing: Framing | null;
  comparison: LensComparisonRow[];
  capture: CaptureSettings;
  overlayVisible: boolean;
  onCapture: (patch: Partial<CaptureSettings>) => void;
  onAimAtTarget: () => void;
  onOverlayVisible: (visible: boolean) => void;
}

interface Props extends FramingProps, ConfigProps {
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
    resolution: useId(),
    targetSize: useId(),
    customWidth: useId(),
    customHeight: useId(),
  };

  const configuration = cameraConfiguration(props.configurationId);

  return (
    <>
      <Section title="Configuration">
        <div className="button-row" role="group" aria-label="Camera configuration">
          {CAMERA_CONFIGURATIONS.map((option) => (
            <button
              key={option.id}
              className={props.configurationId === option.id ? "active" : ""}
              aria-pressed={props.configurationId === option.id}
              onClick={() => props.onConfiguration(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {configuration && (
          <dl className="readout-grid">
            <div>
              <dt>Type</dt>
              <dd>{configuration.kind === "PTZ" ? "Pan/tilt/zoom" : "Fixed"}</dd>
            </div>
            <div>
              <dt>Typical</dt>
              <dd>{nominalRangeLabel(configuration)}</dd>
            </div>
          </dl>
        )}

        {configuration?.zoomPresetsDeg && camera && (
          <>
            <span className="field-label">Zoom presets</span>
            <div className="button-row" role="group" aria-label="Zoom presets">
              {configuration.zoomPresetsDeg.map((fov) => (
                <button
                  key={fov}
                  className={
                    Math.abs(camera.horizontalFovDeg - fov) < 0.5 ? "active" : ""
                  }
                  onClick={() => props.onChange({ horizontalFovDeg: fov })}
                >
                  {fov}°
                </button>
              ))}
            </div>
          </>
        )}

        <p className="note muted">
          {configuration?.purpose}{" "}
          {configuration?.kind === "FIXED"
            ? "Field-of-view changes on a fixed camera are planning comparisons, not optical zoom available after installation."
            : "A PTZ configuration can be zoomed in this tool within a typical range; that is still a planning exploration, not a product specification."}{" "}
          Aim, height and framing stay adjustable so the site can be planned
          before anything is chosen.
        </p>

        <div className="button-row">
          <button
            className={props.frustumVisible ? "active" : "secondary"}
            aria-pressed={props.frustumVisible}
            onClick={() => props.onFrustumVisible(!props.frustumVisible)}
          >
            {props.frustumVisible ? "Hide" : "Show"} frustum
          </button>
        </div>
      </Section>

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

            <SavedMounts
              mounts={props.savedMounts}
              onSave={props.onSaveMount}
              onSelect={props.onSelectMount}
              onRename={props.onRenameMount}
              onDelete={props.onDeleteMount}
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
              <dt>Field of view</dt>
              <dd>
                {camera.horizontalFovDeg.toFixed(0)}° ×{" "}
                {verticalFovDeg(camera.horizontalFovDeg).toFixed(0)}°
              </dd>
            </div>
            <div>
              <dt>Nearest preset</dt>
              <dd>{nearestLensPreset(camera.horizontalFovDeg).label}</dd>
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
            Framing options, not a lens you can zoom after fitting a fixed
            camera: there is no focal length or sensor size here, only the
            angle the camera would cover. Horizon distance assumes an
            unobstructed sea surface and standard refraction, and is not a
            visibility result.
          </p>
        </Section>
      )}

      {camera && (
        <Section title="Framing">
          <label className="field-label" htmlFor={ids.resolution}>
            Output resolution
          </label>
          <div className="button-row" role="group" aria-label="Output resolution">
            {OUTPUT_RESOLUTIONS.map((resolution) => (
              <button
                key={resolution.id}
                className={
                  props.capture.resolutionId === resolution.id ? "active" : ""
                }
                aria-pressed={props.capture.resolutionId === resolution.id}
                onClick={() => props.onCapture({ resolutionId: resolution.id })}
              >
                {resolution.label}
              </button>
            ))}
          </div>

          {!props.framing && (
            <p className="note">
              Place a target to estimate how large something at that distance
              would appear.
            </p>
          )}

          {props.framing && (
            <>
              <div className="button-row">
                <button onClick={props.onAimAtTarget}>Aim at target</button>
              </div>

              <label className="field-label" htmlFor={ids.targetSize}>
                Reference object
              </label>
              <select
                id={ids.targetSize}
                value={props.capture.targetSizeId}
                onChange={(event) =>
                  props.onCapture({ targetSizeId: event.target.value })
                }
              >
                {TARGET_SIZES.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.label}
                  </option>
                ))}
                <option value={CUSTOM_TARGET_SIZE_ID}>Custom…</option>
              </select>

              {props.capture.targetSizeId === CUSTOM_TARGET_SIZE_ID && (
                <div className="custom-size">
                  <label className="field-label" htmlFor={ids.customWidth}>
                    Width m
                  </label>
                  <input
                    id={ids.customWidth}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={props.capture.customWidthMeters}
                    onChange={(event) =>
                      props.onCapture({
                        customWidthMeters: Number(event.target.value),
                      })
                    }
                  />
                  <label className="field-label" htmlFor={ids.customHeight}>
                    Height m
                  </label>
                  <input
                    id={ids.customHeight}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={props.capture.customHeightMeters}
                    onChange={(event) =>
                      props.onCapture({
                        customHeightMeters: Number(event.target.value),
                      })
                    }
                  />
                </div>
              )}

              <FramingReadout framing={props.framing} />

              <LensComparison
                rows={props.comparison}
                resolutionLabel={outputResolution(props.capture.resolutionId).label}
              />
            </>
          )}

          <div className="button-row">
            <button
              className={props.overlayVisible ? "active" : "secondary"}
              aria-pressed={props.overlayVisible}
              onClick={() => props.onOverlayVisible(!props.overlayVisible)}
            >
              {props.overlayVisible ? "Hide" : "Show"} viewfinder guides
            </button>
          </div>

          <p className="note muted">
            Pixel figures are geometry only — an ideal pinhole lens with no
            distortion, haze, motion blur, sensor noise or compression. They
            say how much of the sensor something covers, not whether it would
            be recognisable. The satellite imagery in the preview is not video
            and shows nothing about a real camera's sharpness.
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

/**
 * Mounting positions kept side by side.
 *
 * Saving copies the camera as it stands; selecting copies one back. The live
 * camera is never a reference into this list, so adjusting it after saving
 * cannot quietly rewrite a position that has already been recorded.
 */
function SavedMounts(props: {
  mounts: SavedMount[];
  onSave: (name: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nameId = useId();

  const save = () => {
    props.onSave(name);
    setName("");
  };

  return (
    <div className="mounts">
      <label className="field-label" htmlFor={nameId}>
        Save this position
      </label>
      <div className="location-row">
        <input
          id={nameId}
          type="text"
          value={name}
          placeholder="Upper deck"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
        <button type="button" onClick={save}>
          Save
        </button>
      </div>

      {props.mounts.length === 0 ? (
        <p className="note muted">
          Saved positions let you move the camera and come back, or compare two
          mounts against the same target.
        </p>
      ) : (
        <ul className="mount-list">
          {props.mounts.map((mount) => (
            <li key={mount.id}>
              {renaming === mount.id ? (
                <div className="location-row">
                  <input
                    type="text"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        props.onRename(mount.id, draft);
                        setRenaming(null);
                      }
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      props.onRename(mount.id, draft);
                      setRenaming(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="mount-select"
                    onClick={() => props.onSelect(mount.id)}
                  >
                    <span className="mount-name">{mount.name}</span>
                    <span className="mount-detail">
                      {mount.mountHeightMeters.toFixed(1)} m ·{" "}
                      {Math.round(mount.bearingDeg)}° ·{" "}
                      {Math.round(mount.horizontalFovDeg)}°
                    </span>
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setRenaming(mount.id);
                      setDraft(mount.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => props.onDelete(mount.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FramingReadout({ framing }: { framing: Framing }) {
  const { image, size } = framing;

  return (
    <>
      <dl className="readout-grid">
        <div>
          <dt>Off axis</dt>
          <dd>{framing.angularOffsetDeg.toFixed(1)}°</dd>
        </div>
        <div>
          <dt>In frame</dt>
          <dd>{image.inFrame ? "Yes" : image.behind ? "Behind camera" : "No"}</dd>
        </div>
        {image.inFrame && (
          <div>
            <dt>Image position</dt>
            <dd>
              {Math.round(image.pixelX)}, {Math.round(image.pixelY)} px
            </dd>
          </div>
        )}
        <div>
          <dt>Ground per pixel</dt>
          <dd>{formatMetres(size.metersPerPixel)}</dd>
        </div>
      </dl>

      {!image.inFrame && (
        <p className="note warn">
          The target is outside the frame, {framing.angularOffsetDeg.toFixed(1)}°
          off the optical axis against a {framing.horizontalFovDeg.toFixed(0)}° ×{" "}
          {framing.verticalFovDeg.toFixed(0)}° view. Aim at it, or widen the
          field of view.
        </p>
      )}

      {image.inFrame && (
        <p className="note">
          The reference object would cover about{" "}
          <strong>
            {formatPixels(size.widthPixels)} × {formatPixels(size.heightPixels)}
          </strong>{" "}
          pixels of a {framing.widthPixels} × {framing.heightPixels} image.
        </p>
      )}
    </>
  );
}

function LensComparison(props: {
  rows: LensComparisonRow[];
  resolutionLabel: string;
}) {
  return (
    <div className="lens-compare">
      <table>
        <caption className="field-label">
          Reference object at {props.resolutionLabel}
        </caption>
        <thead>
          <tr>
            <th scope="col">Framing</th>
            <th scope="col">H × V</th>
            <th scope="col">Frame</th>
            <th scope="col">Object</th>
            <th scope="col">m/px</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.presetId} className={row.active ? "active" : ""}>
              <th scope="row">{row.label}</th>
              <td>
                {row.horizontalFovDeg}°×{row.verticalFovDeg.toFixed(0)}°
              </td>
              <td>{formatFrameWidth(row.frameWidthMeters)}</td>
              <td>{row.inFrame ? `${formatPixels(row.objectWidthPixels)} px` : "—"}</td>
              <td>{formatMetres(row.metersPerPixel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note muted">
        Frame is the ground width the lens spans at the target. A dash means
        the target falls outside that framing from the camera's current aim —
        geometry only, and separate from whether terrain stands in the way.
      </p>
    </div>
  );
}

function formatPixels(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

function formatMetres(value: number): string {
  if (value >= 1) return `${value.toFixed(2)} m`;
  return `${(value * 100).toFixed(1)} cm`;
}

function formatFrameWidth(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  if (value >= 100) return `${Math.round(value)} m`;
  return `${value.toFixed(0)} m`;
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
