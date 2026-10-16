# Event Horizon

A browser simulation of black holes and general relativity. You pilot a probe around a black hole, and everything you see comes from integrating geodesics of the Schwarzschild and Kerr spacetimes: the lensed starfield, the Einstein ring, the photon ring, the shadow and the accretion disk with its Doppler beaming and redshift. Nothing is a pre-made picture.

Plain JavaScript, WebGPU with a WebGL2 fallback, no backend. It runs as a single-file claude.ai Artifact.

## Modes

- **View**: the ray-traced picture from the probe. Every pixel traces a photon back from the camera through Kerr spacetime. Fly freely, hover or orbit. Presets for M87\*, Sgr A\*, Interstellar's Gargantua and a stellar-mass hole; spin from 0 to 0.998; toggles for the disk, the starfield, coordinate grids and the Doppler and redshift effects.
- **Orbits**: drop test particles and watch perihelion precession, the innermost stable orbit, plunges, zoom-whirl orbits and Lense–Thirring precession of tilted orbits. Tracked particles run on the CPU in double precision; the swarm integrates up to 16,384 particles on the GPU.
- **Tides**: a person, a Sun-like star or an Earth-like planet falls straight in. Shows the stretch, the tidal tensor and where tides beat the body's cohesion.
- **Clocks**: the probe's clock against a far-away clock, with the "1 hour here = X far away" readout as you hover closer to the horizon.
- **Chirp**: a post-Newtonian inspiral of two black holes with an approximate merger and ringdown, drawn as a strain plot and played as sound.
- **Validation**: the checks below, computed live by the same integrators.

## How it works

Geodesics are integrated in Mino time λ (dτ = Σ dλ) with Carter's separated equations. The second-order form, d²r/dλ² = R′(r)/2 and d²θ/dλ² = Θ′(θ)/2, has no square roots, so turning points need no sign tracking, and it is the same for light and matter. The energy E, angular momentum L and Carter constant Q come from the initial direction in the frame of a zero angular momentum observer. The GPU shaders (`src/render/glsl.js`, `src/render/wgsl.js`) run the same equations as `src/physics/kerr.js`, in single precision.

## Validation

Every check is within 1% of the textbook value (`npm test` fails otherwise):

| Check | Computed with | Textbook |
| --- | --- | --- |
| Mercury's perihelion shift | orbit integrator, two revolutions | 42.98″ per century |
| Shadow diameter | bisection on integrated light rays | 3√3 ≈ 5.196 Schwarzschild radii |
| Shadow edge in the GPU picture (browser only) | width of the rendered shadow | 3√3 M |
| ISCO for spin 0, 0.5, 0.9, 0.998 | minimum of circular-orbit energy, plus a nudged-orbit test | 6M and the Bardeen–Press–Teukolsky formula |
| Light bending by the Sun | null geodesic grazing the Sun | 1.75″ (Eddington 1919) |
| GW150914 chirp mass | read back from the generated waveform's frequency sweep | 28.6 M☉ (GWTC-1) |
| GW150914 sweep 35 → 150 Hz | integrated chirp | Peters quadrupole formula |

The shadow check also gives M87\*'s angular size: 39.7 µas, against the 42 ± 3 µas ring the EHT measured.

## Simplifications

- The accretion disk is geometrically thin and opaque, with circular Keplerian orbits down to the ISCO and nothing inside. Its emission profile is the non-relativistic thin-disk one, and its colours are blackbody colours for a 5,500 K inner disk so the shifts show to the eye. There is no plasma physics, no jet and no light travel-time delay across the disk.
- The far sky is procedural, and a ray counts as escaped at a finite radius.
- The camera's frame is that of a zero angular momentum observer (hovering), optionally boosted by a circular-orbit speed.
- Tides use the Schwarzschild tidal tensor for every spin. A person's breaking point (about 100 g across the body) is an order-of-magnitude figure.
- The chirp's inspiral is 2PN TaylorT4 for non-spinning holes. The merger and ringdown are a smooth approximation that reaches the ringdown frequency and damping time of the final hole from fits to numerical relativity. A full numerical-relativity merger is out of scope.

## Running it

```sh
npm test                 # integrator, validation, tides and chirp tests
npm run build            # dist/event-horizon.html (Artifact body) and dist/index.html
node test/browser/artifact-check.mjs   # needs playwright
```

During development, serve the repo root and open `index.html`; the modules load directly.
