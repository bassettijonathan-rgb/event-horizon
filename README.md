# Event Horizon

A browser simulation of black holes and general relativity. Everything on screen comes from integrating geodesics of the Schwarzschild and Kerr spacetimes; nothing is a pre-made picture.

Work in progress. This first milestone is the physics core and its tests:

- `src/physics/kerr.js`: Kerr geometry in Boyer–Lindquist coordinates and geodesics in Mino time, using the conserved energy, angular momentum and Carter constant.
- `src/physics/orbits.js`: the orbit integrator, plus perihelion precession, light bending, the shadow edge, the ISCO and zoom-whirl orbits.
- `src/physics/tidal.js`: tidal stretching of a falling person, star or planet.
- `src/physics/chirp.js`: a post-Newtonian inspiral chirp with an approximate merger and ringdown.
- `src/physics/validation.js`: the checks shown in the Validation panel.

```sh
npm test
```
