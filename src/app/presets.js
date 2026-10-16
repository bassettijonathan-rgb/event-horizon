// Black holes to visit. Geometry is scale-free in units of M; the mass sets
// the physical sizes, times and tides shown in the readouts.

export const HOLES = [
  {
    id: 'm87',
    name: 'M87*',
    blurb: '6.5 billion suns, 16.8 Mpc away. Seen about 17° from its spin axis, as the Event Horizon Telescope saw it in 2019.',
    mass: 6.5e9,
    spin: 0.9,
    camera: { r: 90, inclination: 17, fov: 26 },
    disk: { outer: 20 },
  },
  {
    id: 'sgra',
    name: 'Sgr A*',
    blurb: 'The hole at the centre of the Milky Way: 4.3 million suns, 8.3 kpc away, imaged by the EHT in 2022.',
    mass: 4.3e6,
    spin: 0.6,
    camera: { r: 50, inclination: 35, fov: 28 },
    disk: { outer: 18 },
  },
  {
    id: 'gargantua',
    name: 'Gargantua',
    blurb: 'The spinning giant from Interstellar: 100 million suns, spinning near the maximum, seen almost edge-on.',
    mass: 1e8,
    spin: 0.998,
    camera: { r: 42, inclination: 84, fov: 32 },
    disk: { outer: 22 },
  },
  {
    id: 'stellar',
    name: 'Stellar-mass',
    blurb: 'A 10-sun hole like Cygnus X-1, left behind by a massive star. Small enough that its tides tear a person apart from far away.',
    mass: 10,
    spin: 0.7,
    camera: { r: 60, inclination: 70, fov: 30 },
    disk: { outer: 16 },
  },
];

export const CHIRPS = [
  { id: 'gw150914', name: 'GW150914', m1: 35.6, m2: 30.6, z: 0.09, distanceMpc: 440, note: 'The first detection, 14 September 2015.' },
  { id: 'gw170814', name: 'GW170814', m1: 30.7, m2: 25.3, z: 0.12, distanceMpc: 580, note: 'The first one Virgo heard too.' },
  { id: 'light', name: 'Two 10 M☉ holes', m1: 10, m2: 10, z: 0.05, distanceMpc: 230, note: 'Lighter holes chirp higher and longer.' },
];
