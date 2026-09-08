# MVP implementation notes

- The Cesium globe currently starts at Sydney and uses the WGS84 ellipsoid if no ion token is provided.
- The sample house is a tiny procedural GLB included in `public/models`.
- The MVP's click handler is intentionally a first skeleton; next iteration should use `camera.pickEllipsoid` / terrain-aware picking and convert the picked Cartesian to Cartographic.
- The solar algorithm is intentionally lightweight and visual. For quantitative analysis, use a validated solar ephemeris and climate/irradiance datasets.
- The next major engineering step is a real `LocationPicker` service that turns a screen tap into a lat/lon and immediately repositions the house.

## Next phase

See [`docs/PHASE-1.md`](docs/PHASE-1.md) — Interactive Site Sandbox. Supersedes the `LocationPicker` note above: the tap-to-place flow is folded into the `SceneObject` + `ObjectLayer` refactor described there.
