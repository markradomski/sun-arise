# Surf Cam Mode — implementation proposal

**Status:** proposal only, nothing implemented
**Branch:** `feature/lulworth-surf-cam`
**Baseline commit:** `11f9a3a`

Evaluate candidate camera installations at 43 Hurst Street, Lulworth TAS 7252, overlooking Lulworth / Tam O'Shanter Bay, so a surfer can judge whether a mounted camera would actually see the break.

The question the mode answers is **"from this mount, at this height, pointing this way, what water is in frame and is anything in the way?"** — not "how much sun does this get". That difference drives most of what follows.

---

## 1. Site evidence

The brief says not to assume elevation, coastline visibility or break positions. What is currently known, and how:

| Fact | Value | Source / confidence |
|---|---|---|
| Lulworth locality centre | −41.0023, 147.0858 | Wikipedia locality coordinate. **Not the property.** |
| Tam O'Shanter Bay marker | ≈ −40.997, 147.067 | Mindat point feature; a bay is an area, so this is indicative only |
| Terrain at locality centre | **25.3 m** (ellipsoidal) | Sampled from Cesium World Terrain in this app |
| Shoreline, bearing 0° (N) | ≈ 600 m away | Terrain drops 21.9 m → 0.4 m between 400 m and 600 m |
| Shoreline, bearing 315° (NW) | ≈ 600 m away | Same pattern |
| Shoreline, bearing 45° (NE) | ≈ 1000–1100 m away | Land runs out further on this bearing |
| Sea surface reading | ≈ −1.0 m ellipsoidal | Consistent across all three transects beyond the shore |

Transect, bearing 0° from the locality centre, metres out → ellipsoidal height:

```
0=25.3  200=27.7  400=21.9  600=0.4  800=-1  1000=-1  1200=-1 … 2400=-1
```

Read: the locality sits on a low rise roughly 25 m above the ellipsoid, with the ground falling to sea level about 600 m to the north and north-west. That is an encouraging starting point — but it is the **locality centre, not 43 Hurst Street**, and the elevations are ellipsoidal, not AHD. The sea reading of about −1 m is the local geoid–ellipsoid separation, so heights above actual sea level are roughly the reading **plus about 1 m**.

**Still unverified, and the mode must treat all of it as unverified:**

- The exact position of 43 Hurst Street, and which part of the property a camera could be mounted on.
- Whether the property is on the seaward or landward side of the rise. A few hundred metres either way changes the answer completely.
- Tree lines, dune vegetation, fences, sheds and neighbouring houses. **Cesium World Terrain is a bare-earth DEM — it contains none of them.** This is the single biggest source of false confidence in the whole feature.
- Where the surf break actually is. "Tam O'Shanter Bay" is an area; a break is a specific peak that the user must place.
- Mount feasibility, power, network, council and neighbour overlooking constraints.

---

## 2. What to reuse unchanged

The existing architecture carries most of this feature.

| Module | Reuse |
|---|---|
| `cesium/CesiumScene.ts` | Viewer, ion token, terrain, lighting. No change. |
| `cesium/terrain.ts` | `createTerrain`, `sampleElevations` (batched `sampleTerrainMostDetailed`), `loadedHeight`. This is the whole terrain-query layer and it is already the right shape. |
| `cesium/TerrainSampler.ts` | The per-object token pattern that discards superseded async results. A viewshed has exactly the same staleness problem, at much larger scale. |
| `scene/geo.ts` | `offsetByBearing` (true great-circle — correct at surf-cam distances), `circlePoints`. |
| `scene/types.ts` | `GeoPosition`, `GeoRotation`, `TerrainStatus`, and the renderer-free discipline. |
| `state/store.ts` | Zustand store, `updateObject` patching, selection. Extend, don't fork. |
| `cesium/DragController.ts` | Gesture ownership (`UI → MANIPULATOR → SCENE OBJECT → GROUND → CAMERA`), pointer capture, `globe.pick(ray)` ground picking, the handle hit-test. Placing a camera and aiming it are the same interaction grammar as placing and rotating a house. |
| `cesium/CameraController.ts` | Named view states, and the `lookAtTransform(Matrix4.IDENTITY)` release. Add surf-cam states here rather than inventing a second camera system. |
| `cesium/SelectionOverlay.ts` | Ring + handle, and the lesson that ground-clamped geometry needs `globe.getHeight` for its hit-test. |
| `components/Section.tsx`, `Controls.tsx` | Collapsible panel sections, segmented control, button rows, the whole visual language. |
| `scene/fieldSignature.ts` | The pattern of hashing exactly the inputs an expensive analysis depends on, so a recompute is skipped when nothing relevant changed. A viewshed needs this more than the solar field does. |
| `cesium/HeatmapOverlay.ts` | Draped `SingleTileImageryProvider` raster with alpha-based visibility, double-buffered swap and the feathered boundary. A viewshed is the same kind of raster. |

### What **not** to reuse

`solar/exposure.ts` `occludes()` is a ray/box slab test in a local ENU frame. Its assumptions are wrong here:

- It treats the ground as a **flat plane**. Over a 60 m solar grid that is immaterial; over 5 km it is a 2 m error and over 10 km nearly 8 m — comparable to the whole mounting height.
- It occludes against **box volumes** (building footprint + ridge height). The occluder for a sea view is the **terrain surface itself**, which boxes cannot represent.
- It has no notion of **atmospheric refraction**, which lifts the apparent horizon by roughly 8%.

`scene/geo.ts` `eastNorthOffset()` is an equirectangular approximation documented as being for small separations. Keep using it for metre-scale work; do not use it for camera-to-break distances. Use a proper inverse geodesic there.

So: reuse the *discipline* of the solar engine — pure TypeScript, no Cesium imports, directly unit-testable — but not its geometry.

---

## 3. New modules

Mirroring the existing `solar/` vs `cesium/` vs `scene/` split.

### `src/optics/` — pure, renderer-free, unit-testable

| Module | Responsibility |
|---|---|
| `camera.ts` | `InstallationCamera` type and derived optics: horizontal/vertical FOV from sensor width and focal length, FOV at a zoom factor, ground footprint of the frame. |
| `lineOfSight.ts` | `lineOfSight(from, to, profile)` over a sampled terrain profile, with Earth curvature and a refraction coefficient. Returns clear/blocked, the blocking distance, and the **clearance margin** in metres — the margin is what makes the result honest, since a 0.5 m clearance over bare-earth terrain means nothing once a fence exists. |
| `horizon.ts` | Geometric and refracted horizon distance for a given eye height; curvature drop at a distance. |
| `viewshed.ts` | Visible/not-visible over a set of target positions, given profiles. No Cesium types. |
| `geodesy.ts` | Inverse geodesic (distance + initial bearing) good to metres over tens of km, replacing `eastNorthOffset` at long range. |

### `src/cesium/` — renderer-side

| Module | Responsibility |
|---|---|
| `TerrainProfiler.ts` | Batched terrain profiles along rays, built on `sampleElevations`, with the `TerrainSampler` token pattern for staleness. The performance-critical piece. |
| `FrustumLayer.ts` | Draws the 3D viewing frustum as a primitive. |
| `ViewshedOverlay.ts` | Draped visible/blocked raster. Should subclass or share the `HeatmapOverlay` double-buffer and feather code rather than copy it. |
| `PreviewCamera.ts` | Off-screen `Camera` with the installation's frustum, rendered to a second canvas for the preview. **Never touches `viewer.camera`.** |

### `src/components/SurfCamPanel.tsx`

Mount height, bearing, tilt, lens/zoom, targets, candidate comparison. Built from the existing `Section` components.

---

## 4. State model

Added to the existing store, not a second store.

```ts
export interface InstallationCamera {
  id: string;
  label: string;                 // "Roof ridge", "NE corner pole"
  ground: GeoPosition;           // mount point, terrain-sampled
  mountHeightMeters: number;     // above local ground, not above ellipsoid
  bearingDeg: number;            // clockwise from true north
  tiltDeg: number;               // below horizontal, positive down
  sensorWidthMm: number;
  focalLengthMm: number;
  zoom: number;                  // optical multiplier on focal length
}

export interface SurfTarget {
  id: string;
  label: string;                 // "Outer bank", "Point"
  position: GeoPosition;         // user-placed; never inferred
}

export interface SightLine {
  targetId: string;
  distanceMeters: number;
  bearingDeg: number;
  clear: boolean;
  blockedAtMeters: number | null;
  clearanceMeters: number;       // + above the terrain, − below
  inFrame: boolean;              // inside the current frustum
}

// store additions
surfCams: Record<string, InstallationCamera>;
surfCamOrder: string[];
activeSurfCamId: string | null;
surfTargets: Record<string, SurfTarget>;
sightLines: Record<string, SightLine[]>;   // keyed by camera id
viewshed: ViewshedResult | null;           // for the active camera only
surfCamMode: "PLACE" | "AIM" | "COMPARE";
```

Two deliberate choices, both following existing precedent:

- `mountHeightMeters` is stored **relative to local ground**, with the absolute height derived. This is how a person thinks about a mount ("6 m pole"), and it survives the terrain resampling that happens when the mount is dragged — the same reason house placement stores a position and derives its level elevation.
- `sightLines` and `viewshed` are **derived cache**, not source of truth, and carry a signature like `fieldSignature.ts` so they are recomputed only when mount, aim, optics or targets actually change.

---

## 5. Interaction design

Reusing the gesture-ownership rules already in `DragController`:

1. **Place the mount** — arm, then click the ground, exactly like the existing probe placement. Terrain-sample on settle, not per pointer-move.
2. **Aim** — drag a bearing handle on the ground ring (the `SelectionOverlay` handle pattern, which already works on real trackpads). Tilt gets a slider; dragging in two axes at once is not discoverable enough to be the only route.
3. **Height, lens, zoom** — sliders and a small preset list of plausible lenses. Changing zoom narrows the drawn frustum live.
4. **Targets** — the user places each break by clicking the water. The app must never infer where a break is.
5. **Preview** — a panel-docked second canvas showing the installation camera's view. Clearly labelled as terrain and imagery only.
6. **Compare** — a table of candidate mounts against each target: distance, clear/blocked, clearance margin, in-frame.

Essential operations stay on plain pointer events, no modifier keys, per the existing input rules.

---

## 6. Terrain / viewshed algorithm

**Sight line, camera → target:**

1. Inverse geodesic for true distance and bearing.
2. Sample terrain at `N` points along the geodesic (adaptive: ~10 m spacing near the camera where small obstructions matter most, coarsening with distance).
3. For each sample at distance `d`, compare terrain height against the straight line from camera to target, correcting for curvature and refraction:

   ```
   drop(d) = d² · (1 − k) / (2R)        k ≈ 0.13, R = 6_371_000
   ```

   Equivalently, use an effective Earth radius of `R / (1 − k)` ≈ 7320 km.
4. Blocked where `terrain(d) + drop(d) > lineHeight(d)`. Report the **minimum clearance** across the profile, not just a boolean.

**Viewshed:** fan of radial profiles across the horizontal FOV (say 1° spacing, clipped to the horizon distance for the mount height), each walked outward keeping a running maximum elevation angle — a point is visible when its angle exceeds everything before it. That is `O(rays × samples)`, single-pass, and far cheaper than per-cell testing. Rasterise the fan into the existing draped-overlay pipeline.

For the mount height suggested by the area evidence (~25 m ground + a few metres of mast), the refracted horizon is roughly **19–21 km**, so horizon is not the limiting factor; near-field terrain and vegetation are.

**Honesty requirements, carried over from the terrain-status design:**

- Bare-earth only. Every result is captioned as excluding vegetation and structures.
- Clearance margin always shown. "Clear by 0.4 m" is a different answer from "clear by 15 m".
- Refraction is a standard-atmosphere coefficient, not a forecast.
- No claim about wave visibility, image quality or whether a wave is *readable* at range — only whether the geometry has a path.

---

## 7. Performance

The real risk. A single viewshed at 1° over 180° to 20 km at 10 m spacing is 360,000 samples — orders of magnitude beyond the 961-point solar grid.

- `sampleTerrainMostDetailed` batches, but the request volume and tile loading dominate. Budget a viewshed in **seconds**, and design the UI for that: compute on settle, never during a drag.
- Adaptive sampling: fine near the camera, coarse far out. Most blocking happens in the first few hundred metres.
- Cap the radius by the computed horizon distance.
- Signature-gate recomputes (`fieldSignature.ts` pattern). Bearing and tilt changes alter the **frustum** but not the **viewshed** — only mount position and height invalidate the viewshed. Separating those two caches is the biggest single win.
- Sight lines to a handful of placed targets are cheap and can stay interactive.
- Reuse the overlay double-buffering, or the viewshed will flicker on every update exactly as the sunlight map did.
- Keep the preview canvas at a modest resolution and render it on demand.

---

## 8. Staged MVP

| Stage | Scope | Proves |
|---|---|---|
| **A** | Place a mount, sample terrain, show ground elevation + mount height + refracted horizon distance | The terrain layer answers the basic question |
| **B** | Place targets; distance, bearing and single sight lines with clearance margin | The core geometry, cheaply and testably |
| **C** | Bearing, tilt, lens, zoom; draw the 3D frustum; show which targets are in frame | The optics model |
| **D** | Preview camera in a second canvas | The "what would it see" payoff |
| **E** | Radial viewshed overlay | The expensive piece, once the cheap ones are proven |
| **F** | Multiple candidates and a comparison table | The actual decision |

A–C are where the value is and carry nearly all the risk of being wrong; E is where the cost is. Stop and reassess after C.

---

## 9. Risks and assumptions

| Risk | Impact | Response |
|---|---|---|
| Bare-earth DEM omits trees, buildings, fences | **A confidently "clear" sight line that is in fact blocked by a tea-tree thicket.** The headline risk. | Caption every result; show clearance margin; state the exclusion in the UI, not just the docs |
| Property location unknown | All site-specific numbers are provisional | User places the mount; never geocode and assume |
| Break positions unknown | Targets are meaningless if invented | User places every target |
| Terrain LOD varies | Clearance of a few metres may be a tile artefact | Sample at best available LOD; treat sub-metre clearance as "marginal", not "clear" |
| Ellipsoidal vs AHD heights | ~1 m offset locally, and users think in AHD | Label units explicitly; do not silently mix |
| Viewshed cost | UI stalls | Settle-triggered, staged, signature-gated |
| Scope creep into a camera-spec tool | Dilutes the solar product | Keep the mode behind its own panel; share primitives, not concerns |

**Assumptions to confirm before building:** that the mount should be modelled as a point with a height rather than a full structure; that bare-earth visibility is useful enough to act on; and that this belongs in Sun Arise at all rather than as a sibling app sharing the `optics/` and `scene/` modules. The last one is worth deciding before stage A — the shared ground is terrain and geometry, and the two products otherwise have very little to say to each other.

---

## Appendix — sunlight field coverage with multiple houses

Recorded here because it was found while investigating a reported multi-house
occlusion bug, and it constrains any future analysis over a spread-out site.

**Occlusion is not the limitation.** Every placed house is passed to the solar
engine, and `directSunMinutes` tests the sample against all of them. A house
standing outside the analysed area still casts into it correctly: with a second
house 32 m west of the grid centre — beyond the sampled area — the shaded cell
count rose from 1229 to 1381, because its shadow reached inside.

**Coverage is the limitation.** The ground grid is 60 m square at 2 m spacing,
centred on the baseline placement if one exists and otherwise on the *first*
house. A second house more than about 30 m from that centre has neither itself
nor, usually, its shadow inside the sampled region, so the overlay shows nothing
for it. Measured at Sydney midwinter, 15:00:

| Second house, east of centre | Shaded cells |
|---|---|
| 20 m (inside the grid) | 2266 |
| 32 m | 1229 |
| 45 m | 1229 |
| 70 m | 1229 |

1229 is the single-house value. The drop is the second house leaving the
sampled area, not leaving the calculation.

**Recommended improvement, not taken here:** centre the grid on the bounding box
of all houses rather than on one of them, and size it to that extent plus a
margin for the longest shadow of the day. Both the sample count and the
per-update cost grow with the square of the extent, so this needs a deliberate
budget — either a coarser spacing at larger extents, or an explicit cap with the
coverage boundary drawn so the user can see what was analysed.
