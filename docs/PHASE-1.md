# Phase 1 — Interactive Site Sandbox

**Status:** steps 1–5 implemented, 6–10 proposed
**Date:** 2026-09-08 (updated 2026-09-09)
**Baseline commit:** `c1c112c`

| Step | State |
|---|---|
| 1. SceneObject + store | ✅ done |
| 2. ObjectLayer reconciler | ✅ done |
| 3. Terrain | ⚠️ done, world terrain unverified — needs an ion token (decision #2) |
| 4. Selection / drag / rotate / scale | ⚠️ done; desktop scale still UI-only (see below) |
| 5. Selection overlay | ✅ done |
| 6. CameraController | ⚠️ partial — SITE view on load; named-state transitions still to do |
| 7–10 | proposed |

---

## 1. Goal

Turn the current technical demo into the first version of the actual product.

> Touch Earth → fly to the site → drop a house → move and rotate it → immediately see what the sun does.

The house stops being a map marker and becomes a manipulable object. Everything in this phase serves that one shift.

### Success test

This sequence must work end to end, and must *feel good*:

1. Open the app — Earth in orbit view
2. Tap Australia — camera flies in
3. Tap a property — camera settles at site level
4. House drops onto the terrain and becomes selected
5. Drag the house across the block
6. Rotate it
7. Press play — shadows sweep across the ground
8. Scrub the timeline
9. Move the house again and see the sunlight change

If that feels good, the product foundation is right. If it doesn't, no amount of Phase 2–5 work will save it.

---

## 2. Scope decision: defer React Three Fiber

The original phase plan called for introducing React Three Fiber in Phase 1 as an interactive object layer over Cesium. **This document recommends against that, and proposes doing the Phase 1 interaction work in Cesium directly.**

### Rationale

Cesium owns its own WebGL context, camera, render loop and depth buffer. Three.js owns its own. Bridging them means one of:

| Approach | Cost |
|---|---|
| Two canvases, per-frame camera matrix sync | **No shared depth buffer.** Terrain cannot occlude objects; a hill cannot hide a house. Sync drift on fast camera moves. |
| Three rendering into Cesium's context (`autoClear = false`) | Fragile GL state juggling. Breaks on Cesium upgrades. Cesium 1.145 is current and moving. |

Now compare against what Phase 1 actually needs: drag, rotate, scale, select, terrain-follow, camera flight, day/year animation.

**All of these are native Cesium capabilities.** `ScreenSpaceEventHandler` handles the pointer work, `Transforms.headingPitchRollToFixedFrame` is already used in the codebase, and `Model.fromGltfAsync` already loads the GLB models.

What R3F genuinely buys is a declarative authoring model and straightforward custom shaders — sunlight heatmaps, gradient overlays, polished gizmos. Those are Phase 2 and Phase 3 concerns.

### The compromise

Do the state and architecture refactor now, in Cesium, **but build the seam so R3F can drop in later.**

If `SceneObject[]` is the single source of truth and rendering sits behind a narrow interface, swapping or augmenting the renderer is a contained change. If R3F goes in now, the camera-sync tax is paid before the interaction has been validated at all.

### Revisit this when

- Sunlight heatmap surfaces are needed (Phase 3) — custom shader work
- Object count goes past ~50 and instancing matters
- The selection gizmo needs to be genuinely good rather than adequate

---

## 3. Current state

Seven real source files. Small, clean, and two of them are already correct.

| File | Assessment |
|---|---|
| [`src/cesium/CesiumScene.ts`](../src/cesium/CesiumScene.ts) | Does everything: viewer setup, one `Model`, shadow polylines, picking, camera. Needs splitting. |
| [`src/houses/HouseManager.ts`](../src/houses/HouseManager.ts) | 33 lines of passthrough. Vestigial — delete in step 2. |
| [`src/solar/SolarClock.ts`](../src/solar/SolarClock.ts) | RAF-driven observable with subscribe/emit. **Already the right pattern. Keep.** |
| [`src/solar/solarPosition.ts`](../src/solar/solarPosition.ts) | Pure NOAA approximation, zero dependencies. **Already an independent engine. Keep.** |
| [`src/App.tsx`](../src/App.tsx) | 6 × `useState` + 2 refs. Shadow geometry computed inline in the component. |
| [`src/components/Controls.tsx`](../src/components/Controls.tsx) | Presentational, no state. Fine — will be restructured in step 9. |
| [`src/types.ts`](../src/types.ts) | `HouseInstance` is flat lat/lng/heading/scale. Superseded by `SceneObject`. |

**Terrain:** `EllipsoidTerrainProvider`. Height is always 0, nothing sits on ground.

**Rendering:** a single `Model` primitive, destroyed and rebuilt on every placement call.

---

## 4. Target architecture

```
src/
  state/
    store.ts              zustand — objects, selection, camera mode, site
  scene/
    types.ts              SceneObject and friends
    geo.ts                lat/lng ↔ metres, bearing offsets
  cesium/
    CesiumScene.ts        viewer lifecycle ONLY
    ObjectLayer.ts        SceneObject[] → Cesium Models (keyed reconcile)
    DragController.ts     pointer/touch → move, rotate, scale
    SelectionOverlay.ts   ring + rotation handle
    CameraController.ts   named camera states, fly transitions
    terrain.ts            sync + async height sampling
  solar/
    solarPosition.ts      (keep)
    SolarClock.ts         (keep, + day/year axis)
    shadowGeometry.ts     moved out of App.tsx
    timezone.ts           lat/lng → UTC offset
  houses/
    catalog.ts            model manifest with per-model metadata
  components/
    ...                   UI
```

**Dependency rule:** `solar/` must not import from `cesium/` or `state/`. It stays a pure engine that can move to a Web Worker in Phase 3 without changes.

---

## 5. Work breakdown

### Step 1 — `SceneObject` model + store

Foundational. Everything downstream depends on this shape.

```ts
// src/scene/types.ts
export type ObjectType = 'house' | 'tree' | 'wall' | 'solar-panel';

export interface SceneObject {
  id: string;
  type: ObjectType;
  modelUrl: string;
  position: { latitude: number; longitude: number; height: number };
  rotation: { heading: number; pitch: number; roll: number };
  scale: number;
  clampToGround: boolean;
}
```

```ts
// src/state/store.ts
interface SolarHouseState {
  objects: Record<string, SceneObject>;
  order: string[];
  selectedId: string | null;
  cameraMode: 'ORBIT' | 'REGION' | 'SITE' | 'HOUSE';
  site: { latitude: number; longitude: number } | null;

  addObject(o: Omit<SceneObject, 'id'>): string;
  updateObject(id: string, patch: Partial<SceneObject>): void;
  removeObject(id: string): void;
  select(id: string | null): void;
}
```

**Why zustand and not `useState`:** the drag controller lives inside Cesium event handlers — imperative code outside React — and must write state that React reads. React must write state the Cesium layer reads. Zustand gives `useStore()` inside components and `store.subscribe()` outside them, with no provider plumbing. The current ref + `useState` arrangement in `App.tsx` does not survive a second object.

**Acceptance:** store unit-testable in isolation; no Cesium import anywhere in `state/` or `scene/`.

---

### Step 2 — `ObjectLayer` reconciler

Replaces `CesiumScene.placeHouse()`. Deletes `HouseManager`.

The current implementation destroys and recreates the model on every call. With N objects and live dragging that is untenable.

```ts
export class ObjectLayer {
  private models = new Map<string, Model>();
  private version = 0;

  async sync(objects: SceneObject[]) {
    const seen = new Set<string>();

    for (const obj of objects) {
      seen.add(obj.id);
      const existing = this.models.get(obj.id);

      if (existing && existing.id?.modelUrl === obj.modelUrl) {
        existing.modelMatrix = matrixFor(obj);   // cheap path — transform only
        existing.scale = obj.scale;
        existing.id = obj;
        continue;
      }
      await this.load(obj);
    }

    for (const [id, model] of this.models) {
      if (seen.has(id)) continue;
      this.scene.primitives.remove(model);
      this.models.delete(id);
    }
  }
}
```

Carry forward from the existing code:

- **Keep the `placementVersion` guard.** It exists because React Strict Mode double-mounts and quick location changes supersede pending async loads. It is correct — preserve the pattern per-object.
- **Set `model.id = obj`** so `scene.pick()` returns the `SceneObject` directly. This is what makes step 4 simple.

Cleanups landing here:

- Delete dead `requireCesium()` — [`CesiumScene.ts:243`](../src/cesium/CesiumScene.ts)
- Delete `makeBungalowModelMatrix()` — byte-identical to `makeModelMatrix()`
- Remove the `isBungalow` scale hack (`CesiumScene.ts:105`) — scale moves into catalog metadata

**Acceptance:** two houses on screen simultaneously; moving one does not reload the other.

---

### Step 3 — Terrain

Switch to `createWorldTerrainAsync()`. Requires a Cesium ion token; fall back to `EllipsoidTerrainProvider` with height 0 when absent so the app still runs without one.

**The non-obvious part:** terrain height cannot be `await`ed during a drag. `sampleTerrainMostDetailed` is async and will stutter at 60fps.

```ts
// src/cesium/terrain.ts

// DURING drag — synchronous, uses currently-loaded tiles only.
export function approxHeight(globe: Globe, carto: Cartographic): number {
  return globe.getHeight(carto) ?? 0;
}

// ON drag end — precise, settles onto real ground.
export async function settleHeight(provider, carto: Cartographic): Promise<number> {
  const [sampled] = await sampleTerrainMostDetailed(provider, [carto.clone()]);
  return sampled.height ?? 0;
}
```

Drag with the approximation, settle with the precise value on release. Animating that settle over ~200ms gives the "drop with a small bounce" from the original plan essentially for free.

Also set `scene.globe.depthTestAgainstTerrain = true` — required for step 4's `pickPosition` to return positions on the terrain surface rather than through it.

**Acceptance:** house sits on a visible slope, correctly, at multiple zoom levels.

---

### Step 4 — Selection, drag, rotate, scale

The thing that bites: **Cesium's camera controller will fight the drag.** It must be disabled for the duration.

```ts
handler.setInputAction(({ position }) => {
  const picked = this.scene.pick(position);
  if (!picked?.id?.type) return;                 // not a SceneObject

  store.getState().select(picked.id.id);
  this.dragging = picked.id.id;
  this.scene.screenSpaceCameraController.enableInputs = false;   // ← critical
}, ScreenSpaceEventType.LEFT_DOWN);

handler.setInputAction(({ endPosition }) => {
  if (!this.dragging) return;
  const cartesian = this.scene.pickPosition(endPosition)
    ?? this.scene.camera.pickEllipsoid(endPosition, this.scene.globe.ellipsoid);
  if (!cartesian) return;

  const carto = Cartographic.fromCartesian(cartesian);
  store.getState().updateObject(this.dragging, {
    position: {
      latitude:  CesiumMath.toDegrees(carto.latitude),
      longitude: CesiumMath.toDegrees(carto.longitude),
      height:    approxHeight(this.scene.globe, carto),
    },
  });
}, ScreenSpaceEventType.MOUSE_MOVE);

handler.setInputAction(async () => {
  const id = this.dragging;
  this.dragging = null;
  this.scene.screenSpaceCameraController.enableInputs = true;
  if (id) await this.settle(id);
}, ScreenSpaceEventType.LEFT_UP);
```

**Acceptance:** drag is smooth at 60fps; the globe never pans mid-drag; releasing settles the house onto terrain.

#### As implemented

[`src/cesium/DragController.ts`](../src/cesium/DragController.ts) owns *all*
pointer interaction, including `LEFT_CLICK` — moved out of `CesiumScene` so that
clicking an object selects it rather than teleporting it. `CesiumScene` now has
no input handling at all.

| Input | Action |
|---|---|
| Drag on object | Move |
| Shift + drag | Rotate heading (0.5°/px) |
| Two-finger pinch | Rotate + scale (touch) |
| Click object | Select |
| Click ground | Move selected, or drop new |
| Escape | Deselect |
| Delete / Backspace | Remove selected |

Two implementation notes worth keeping:

- **Ground picking uses `globe.pick(ray)`, not `scene.pickPosition`.** The latter
  picks the dragged model's own roof, so the object walks away under the cursor.
  Picking the globe surface specifically ignores primitives and fixes it.
- **Camera pitch of exactly −90° breaks picking** (`normalized result is not a
  number`) — the pick ray degenerates. Any camera work in step 6 must stay off
  the vertical singularity.

**Still open:** desktop scale has no pointer gesture; it is pinch-only on touch.
The heading slider in `Controls` drives the selected object, but there is no
scale equivalent yet. Worth folding into step 10's UI restructure rather than
inventing a modifier-drag for it.

---

### Step 5 — Selection overlay

Cesium has no gizmo primitives, so this is hand-rolled: a ground-clamped `EllipseGraphics` ring beneath the selected object, plus a billboard rotation handle on its edge. Roughly 60 lines.

This is the one place R3F would have been materially nicer, and it is not nice enough to justify the camera bridge.

**Acceptance:** selection state is unmistakable at site and house zoom levels.

#### As implemented

[`src/cesium/SelectionOverlay.ts`](../src/cesium/SelectionOverlay.ts) — a ground
ring, a spoke showing which way the object faces, and a handle dot at the ring
edge. Cream (`#f2efe7`) rather than the sun gold, so selection chrome never
reads as solar data.

The gotcha that shaped the implementation: **Cesium does not support entity
outlines on terrain.** An `EllipseGraphics` with `outline: true` and
`CLAMP_TO_GROUND` silently renders nothing — no warning, no error. The ring is
therefore a ground-clamped *polyline* built from 64 generated circle points,
which is supported.

Geometry is fed through `CallbackProperty`, so dragging updates the overlay
without recreating entities. The overlay is refreshed from `scene.postUpdate`
rather than the store subscription, because the model's footprint radius only
becomes readable once the GPU upload completes — several frames after the
object enters the store. `ObjectLayer.getRadius()` returns `undefined` until
then and the overlay falls back to a minimum radius.

Also added [`src/scene/geo.ts`](../src/scene/geo.ts) (`offsetByBearing`,
`circlePoints`) and refactored `shadowGeometry` onto it, removing a duplicated
copy of the same spherical trig.

---

### Step 6 — `CameraController`

```ts
const ALTITUDES = { ORBIT: 12_000_000, REGION: 400_000, SITE: 800, HOUSE: 120 };

flyTo(mode: CameraMode, target: { latitude: number; longitude: number }) {
  this.viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(target.longitude, target.latitude, ALTITUDES[mode]),
    orientation: {
      heading: 0,
      pitch: CesiumMath.toRadians(mode === 'HOUSE' ? -35 : -90),
      roll: 0,
    },
    duration: 2.5,
    easingFunction: EasingFunction.QUADRATIC_IN_OUT,
  });
}
```

The tap flow becomes: pick location → `flyTo('SITE')` → on arrival, drop house → select it.

`tiltTo3D()` and `tiltTo2D()` disappear — they become two of the named states.

**Acceptance:** orbit → site transition reads as one continuous move, not a jump cut.

#### Partially implemented

[`src/cesium/CameraController.ts`](../src/cesium/CameraController.ts) currently
provides `frameSite()` only. The app **opens** at the house rather than in
orbit — range 80 m, pitch −50°, heading 20°, set directly with no
fly-from-space, so the model is visible the moment the app is usable.

Two mechanics worth keeping:

- `camera.lookAt()` locks the camera to the target's reference frame; it must be
  followed by `lookAtTransform(Matrix4.IDENTITY)` or the user's own pan and zoom
  fight the lock.
- Initial framing is driven from `scene.postRender` and waits for
  `layer.getRadius()` to return a value, because the model's position is not
  meaningful until it has loaded and settled. The listener removes itself once
  it has framed.

Pitch is deliberately −50° and not −90°: an exactly vertical camera makes the
pick ray degenerate and breaks selection and dragging entirely (see step 4).

Still to do: the ORBIT / REGION / SITE / HOUSE named states and animated
transitions between them.

### Sun-ray polylines removed

The gold `visualShadow` / `dailyShadowTrail` polylines are gone, along with
`src/solar/shadowGeometry.ts` and the shadow legend. They did not convey
sunlight vs shade any better than Cesium's shadow map does from the real model
geometry, and they cluttered the close-up site view.

The solar engine itself is untouched — sun position, altitude, azimuth and
sunrise/sunset still drive the UI, and the real cast shadow still renders. If a
sun-path visualisation returns in Phase 3 it should be a ground overlay, not
rays from the model.

---

### Step 7 — House catalog

```
public/models/<slug>/
  model.glb
  thumbnail.webp
  metadata.json     { name, scale, footprint: {width, depth}, height }
```

Start with the three models already present, plus custom GLB upload. Per-model `scale` in metadata is what retires the `isBungalow` hack.

---

### Step 8 — Day / Year clock axis

`SolarClock` needs one new field:

```ts
interface SolarClockState {
  date: Date;
  playing: boolean;
  axis: 'day' | 'year';   // ← new
  speed: number;
}
```

In `tick()`: `axis === 'day'` advances minutes (current behaviour); `axis === 'year'` advances days while holding time-of-day constant. Roughly 15 lines.

---

### Step 9 — Mobile gestures

| Gesture | Action |
|---|---|
| One finger on object | Move |
| One finger on globe | Rotate camera |
| Pinch | Zoom |
| Two-finger twist on selected object | Rotate object |
| Tap | Select |
| Long press | Drop object |

Two-finger rotate is the non-obvious one. Cesium's `PINCH_MOVE` carries an `angleAndHeight` field — the angle delta drives heading, the distance delta drives scale:

```ts
handler.setInputAction((movement) => {
  if (!this.selectedId) return;
  const dAngle = movement.angleAndHeight.endPosition.x
               - movement.angleAndHeight.startPosition.x;
  store.getState().updateObject(this.selectedId, {
    rotation: { heading: this.startHeading + CesiumMath.toDegrees(dAngle), pitch: 0, roll: 0 },
  });
}, ScreenSpaceEventType.PINCH_MOVE);
```

---

### Step 10 — UI restructure

Move from the current left sidebar to the bottom-bar vocabulary:

```
[ HOUSE ]  [ SUN ]  [ SITE ]  [ ANALYSE ]
```

Timeline sits above the bar. Object controls (move / rotate / scale / delete) appear contextually on selection.

---

## 6. Bugs to fix on the way

### 6.0 Timezone offset applied twice — FIXED

Found while verifying steps 1–3. `solarPosition` folded `utcOffsetHours` into
`minutes`, then computed true solar time as `minutes + eqTime + 4 * longitude`.
The NOAA formula is `local + eqTime + 4*lng - 60*offset`, which reduces to
`utcMinutes + eqTime + 4*lng` — so the offset was applied a second time.

At Sydney this produced an hour angle of ~152° at local noon: sun below the
horizon, globe rendered black. Sunrise/sunset were unaffected (that path uses
local minutes correctly).

Fixed by splitting `utcMinutes` from `minutes`. Noon altitude at Sydney now
reads 50.5°, which is correct for early September.

### 6.1 UTC offset is hardcoded to Sydney — STILL OPEN

[`App.tsx`](../src/App.tsx) passes a module-level `UTC_OFFSET_HOURS = 10`.

**Every sun position outside UTC+10 is still wrong** — and flying anywhere on
Earth is the entire premise of Phase 1. Distinct from §6.0: that was a formula
error, this is a missing lookup. Blocked on decision #1.

Options:

| Option | Result | Cost |
|---|---|---|
| `tz-lookup` package | Correct civil time | One small dependency |
| `longitude / 15` | True *solar* time | None, but the clock won't match the user's watch |

**Recommendation:** `tz-lookup`. Needs a decision — see §8.

### 6.2 The shadow polylines are not shadows

[`visualShadow()`](../src/App.tsx) draws a line from the house origin along the anti-solar bearing using a hardcoded `HOUSE_HEIGHT_METERS = 8`.

Meanwhile Cesium's **real** shadow map is already enabled (`shadows: true`, model `ShadowMode.ENABLED`, globe `RECEIVE_ONLY`). So there is a genuine cast shadow *and* a synthetic proxy line drawn on top of it.

Keep both, but rename the concept: the trail becomes a **sun path trace**, which is what it actually is. Tune `viewer.shadowMap.darkness` and `softShadows` for the real shadows. Move the geometry out of `App.tsx` into `src/solar/shadowGeometry.ts`.

---

## 7. Build order

```
1. SceneObject types + store          ← no Cesium dependency
2. ObjectLayer reconciler             ← replaces placeHouse, deletes HouseManager
3. Terrain provider + height sampling
─────────────────────────────────────── mechanical, low risk
4. Selection + drag / rotate / scale   ← the feel test lives here
5. Selection overlay
6. CameraController + fly-to flow
7. House catalog
8. Day / Year clock axis
9. Mobile gestures
10. UI restructure
```

Steps 1–3 are the "refactor before adding features" the roadmap calls for, and they carry the leverage: once the scene is a keyed collection of `SceneObject`s driven by a store, Phase 2's trees and walls become catalog entries rather than new code.

Step 4 is where it becomes clear whether the interaction feels good — and it is far cheaper to iterate there once the state model is settled.

---

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Timezone: `tz-lookup` vs `longitude / 15` | `tz-lookup` — users expect civil time |
| 2 | Cesium ion token available for world terrain? | Required for step 3's full value; fallback path specified |
| 3 | Accept the R3F deferral in §2? | Yes — revisit at Phase 3 shader work |
| 4 | Custom GLB upload in Phase 1 or Phase 2? | Phase 2 — needs storage, not just a file picker |

---

## 9. Explicitly out of scope

Deferred to later phases, and worth actively resisting:

- User accounts and auth
- Weather and climate APIs
- PostGIS and any backend
- Optimisation algorithms ("find the best house position")
- Wind and rainfall simulation
- Solar panel yield calculation
- Large house catalogue
- Side-by-side house comparison
- AI analysis
- Social features

---

## Appendix — Cesium API notes

Details that cost time when discovered late:

| Concern | Detail |
|---|---|
| `pickPosition` returns wrong depth | Requires `scene.globe.depthTestAgainstTerrain = true` |
| Drag fights the camera | Must set `screenSpaceCameraController.enableInputs = false` during drag |
| Terrain height is async | `globe.getHeight()` is sync but loaded-tiles-only; `sampleTerrainMostDetailed` is precise but async |
| Picking a `Model` | Set `model.id` to retrieve the domain object from `scene.pick()` |
| Object scale | `Model.scale` is a separate property — keep the model matrix pure heading/pitch/roll |
| Two-finger rotate | Not native; derive from `PINCH_MOVE`'s `angleAndHeight` |
| React Strict Mode | Double-mounts the viewer; async model loads need a version guard (already handled — preserve it) |
