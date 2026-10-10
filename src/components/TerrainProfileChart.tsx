import type { SightLineAnalysis } from "../optics/sightLine";
import type { AnalysedSample } from "../optics/lineOfSight";

/**
 * Side-on view of the terrain under a sight line.
 *
 * Every series is read straight off the analysis — the terrain, the line, the
 * obstruction and the minimum are the same numbers the panel prints, so the
 * picture cannot disagree with the verdict beside it.
 *
 * The terrain plotted is **curvature-adjusted**: each sample is lowered by how
 * far the surface has fallen away from the observer at that distance. That is
 * what the sight line was actually tested against, and it is why the sea can
 * slope downwards here while being level in the world.
 */

const WIDTH = 320;
const HEIGHT = 132;
const PAD = { left: 30, right: 6, top: 8, bottom: 18 };

interface Props {
  analysis: SightLineAnalysis;
}

export default function TerrainProfileChart({ analysis }: Props) {
  const samples = analysis.lineOfSight.samples;
  const measured = samples.filter(
    (s): s is AnalysedSample & { apparentTerrainMeters: number } =>
      s.apparentTerrainMeters !== undefined,
  );
  if (measured.length < 2) return null;

  const maxDistance = samples[samples.length - 1]?.distanceMeters ?? 0;
  if (maxDistance <= 0) return null;

  const elevations = [
    ...measured.map((s) => s.apparentTerrainMeters),
    ...samples.map((s) => s.lineElevationMeters),
  ];
  const lowest = Math.min(...elevations);
  const highest = Math.max(...elevations);
  // A flat sea would otherwise collapse to a zero-height band.
  const span = Math.max(highest - lowest, 10);
  const headroom = span * 0.12;
  const top = highest + headroom;
  const bottom = lowest - headroom;

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (distance: number) => PAD.left + (distance / maxDistance) * plotWidth;
  const y = (elevation: number) =>
    PAD.top + ((top - elevation) / (top - bottom)) * plotHeight;

  const terrainLine = measured
    .map((s) => `${x(s.distanceMeters).toFixed(2)},${y(s.apparentTerrainMeters).toFixed(2)}`)
    .join(" ");
  const terrainArea = `${PAD.left},${(HEIGHT - PAD.bottom).toFixed(2)} ${terrainLine} ${(
    PAD.left + plotWidth
  ).toFixed(2)},${(HEIGHT - PAD.bottom).toFixed(2)}`;

  const first = samples[0];
  const last = samples[samples.length - 1];

  // Contiguous runs where terrain stands through the line.
  const blockedRuns: { from: number; to: number }[] = [];
  for (const sample of measured) {
    if (!sample.interior || (sample.clearanceMeters ?? 0) >= 0) continue;
    const previous = blockedRuns[blockedRuns.length - 1];
    if (previous && sample.distanceMeters - previous.to <= analysis.profile.spacingMeters * 4) {
      previous.to = sample.distanceMeters;
    } else {
      blockedRuns.push({ from: sample.distanceMeters, to: sample.distanceMeters });
    }
  }

  const minimumAt = analysis.lineOfSight.minimumClearanceAtMeters;
  const minimumSample = measured.find((s) => s.distanceMeters === minimumAt);

  const describedDistance =
    maxDistance >= 1000
      ? `${(maxDistance / 1000).toFixed(2)} km`
      : `${Math.round(maxDistance)} m`;

  return (
    <figure className="profile-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Terrain profile over ${describedDistance}: ${
          analysis.classification === "OBSTRUCTED"
            ? "terrain stands through the sight line"
            : "sampled terrain stays below the sight line"
        }`}
      >
        <g className="profile-axes">
          <line
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={HEIGHT - PAD.bottom}
          />
          <line
            x1={PAD.left}
            y1={HEIGHT - PAD.bottom}
            x2={WIDTH - PAD.right}
            y2={HEIGHT - PAD.bottom}
          />
        </g>

        <polygon className="profile-terrain" points={terrainArea} />
        <polyline className="profile-terrain-edge" points={terrainLine} />

        {blockedRuns.map((run) => (
          <rect
            key={run.from}
            className="profile-blocked"
            x={x(run.from)}
            y={PAD.top}
            width={Math.max(x(run.to) - x(run.from), 1.5)}
            height={plotHeight}
          />
        ))}

        <line
          className={`profile-sight profile-sight-${analysis.classification.toLowerCase()}`}
          x1={x(first.distanceMeters)}
          y1={y(first.lineElevationMeters)}
          x2={x(last.distanceMeters)}
          y2={y(last.lineElevationMeters)}
        />

        {minimumSample && (
          <line
            className="profile-minimum"
            x1={x(minimumSample.distanceMeters)}
            y1={y(minimumSample.lineElevationMeters)}
            x2={x(minimumSample.distanceMeters)}
            y2={y(minimumSample.apparentTerrainMeters)}
          />
        )}

        <circle
          className="profile-eye"
          cx={x(first.distanceMeters)}
          cy={y(first.lineElevationMeters)}
          r={3.5}
        />
        <circle
          className="profile-target"
          cx={x(last.distanceMeters)}
          cy={y(last.lineElevationMeters)}
          r={3.5}
        />

        <text className="profile-tick" x={2} y={y(highest) + 3}>
          {Math.round(highest)}
        </text>
        <text className="profile-tick" x={2} y={y(lowest) + 3}>
          {Math.round(lowest)}
        </text>
        <text className="profile-tick" x={PAD.left} y={HEIGHT - 5}>
          0
        </text>
        <text
          className="profile-tick profile-tick-end"
          x={WIDTH - PAD.right}
          y={HEIGHT - 5}
        >
          {describedDistance}
        </text>
      </svg>
      <figcaption className="note muted">
        Elevation in metres against distance from the camera. Terrain is shown
        curvature-adjusted, as the sight line was tested against it.
      </figcaption>
    </figure>
  );
}
