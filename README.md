# Solar House MVP ...

A browser-first prototype for the "drop a house anywhere on Earth and watch the sun/shadows move" concept.

## Stack

- React + TypeScript + Vite
- CesiumJS 1.145
- GLB/glTF house model
- Client-side solar-position calculation
- Cesium visual shadows
- Mobile/touch-friendly controls

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL.

### Cesium ion token

The MVP works without a token using the WGS84 ellipsoid, but you will want a Cesium ion token for streamed terrain/imagery/3D datasets.

Copy `.env.example` to `.env` and add:

```bash
VITE_CESIUM_ION_TOKEN=your_token
```

Then restart Vite.

## Interaction

1. Click/tap the globe to move the house to that location.
2. Use the heading slider to rotate it.
3. Drag the time slider.
4. Press PLAY to run the sun through the day.
5. Change the date to inspect seasonal changes.

## Important

This MVP's shadows are a visual simulation. It is **not yet a certified solar/energy analysis tool**. The analytical ray-casting/irradiance engine should be added separately from the renderer.
