// "What you're seeing" cards: one short, plain explanation per effect.
// `action` names a shortcut the app can run from the card.

export const CARDS = {
  shadow: {
    title: 'The shadow',
    text: 'The dark patch is every direction from which no light reaches you: those rays end in the hole. It is about 2.6 times wider than the horizon itself, because light passing close by gets pulled in too.',
  },
  photonRing: {
    title: 'The photon ring',
    text: 'Right at the shadow’s edge, light can circle the hole before escaping. Each extra loop makes a thinner, fainter copy of everything around it, piled up into a sharp bright ring.',
  },
  secondary: {
    title: 'The disk seen twice',
    text: 'The disk is flat, yet you see it wrapped over the top and under the bottom of the hole. That is the far side of the disk, its light bent up and around towards you.',
  },
  doppler: {
    title: 'Doppler beaming',
    text: 'The disk orbits at a good fraction of light speed. The side coming towards you is brighter and bluer; the side moving away is dimmer and redder.',
    action: 'doppler',
    actionLabel: 'Toggle the effect',
  },
  redshift: {
    title: 'Gravitational redshift',
    text: 'Light climbing out from near the hole loses energy, so the inner disk looks redder and dimmer than it really is. Near the edge of the shadow it fades to nothing.',
  },
  einstein: {
    title: 'The Einstein ring',
    text: 'There is a bright blue star straight behind the hole. Its light goes around every side at once, so you see it as a ring instead of a dot.',
    action: 'einstein',
    actionLabel: 'Line up the star',
  },
  lensing: {
    title: 'Lensed stars',
    text: 'Stars near the hole look smeared into arcs and some appear twice, once on each side. Gravity acts like a lens with a very strong, uneven curve.',
  },
  dragging: {
    title: 'Frame dragging',
    text: 'A spinning hole drags space around with it. Light going with the spin can get closer than light going against it, so the shadow is flattened on one side.',
  },
  probeMotion: {
    title: 'Flying in orbit',
    text: 'When the probe orbits, it moves at a large fraction of light speed. The sky crowds into the direction of travel and brightens there: aberration.',
  },
  precession: {
    title: 'Precession',
    text: 'In Newton’s gravity an orbit is a fixed ellipse. In Einstein’s, each loop starts a little further round, tracing a rosette. Mercury’s orbit does this by 43″ a century.',
  },
  isco: {
    title: 'The innermost stable orbit',
    text: 'Closer than the dashed amber circle, no orbit is stable: any nudge sends a particle spiralling in. It is 6M for a hole without spin and moves inward as spin grows.',
  },
  zoomWhirl: {
    title: 'Zoom-whirl',
    text: 'An orbit that dips just outside the critical radius whirls around the hole several times before zooming back out. Newtonian orbits never do this.',
  },
  plunge: {
    title: 'Plunging',
    text: 'Inside the innermost stable orbit, a particle falls in within a few turns. Seen from far away it slows and freezes at the horizon; its own clock says it crossed.',
  },
  tilted: {
    title: 'Lense–Thirring precession',
    text: 'A tilted orbit around a spinning hole wobbles: the plane of the orbit turns around the spin axis, dragged along by the spinning space.',
  },
  swarm: {
    title: 'A swarm on the GPU',
    text: 'Thousands of particles, each on its own exact geodesic, integrated in parallel on your graphics card. Those that fall in disappear; the rest spread into a ring.',
  },
  tides: {
    title: 'Spaghettification',
    text: 'Gravity pulls harder on the near end of a falling body than the far end, and squeezes it from the sides. Small holes have far stronger tides at their horizon than giant ones.',
  },
  tensor: {
    title: 'The tidal tensor',
    text: 'Three numbers describe the tide: one stretch along the fall line (+2GM/r³) and two squeezes across it (−GM/r³). Multiply by the body’s size to get the pull difference.',
  },
  clocks: {
    title: 'Time dilation',
    text: 'Clocks near the hole tick slower than clocks far away. Hovering just outside the horizon, an hour for you can be years for everyone else.',
  },
  chirp: {
    title: 'The chirp',
    text: 'Two holes spiral together, losing energy to gravitational waves. The orbit shrinks, so the wave rises in pitch and loudness, then rings down as one hole.',
  },
  ringdown: {
    title: 'Ringdown',
    text: 'The merged hole wobbles and settles like a struck bell, at a pitch set by its mass and spin.',
  },
};

export const MODE_CARDS = {
  view: ['shadow', 'photonRing', 'secondary', 'doppler', 'redshift', 'einstein', 'lensing', 'dragging', 'probeMotion'],
  orbits: ['precession', 'isco', 'zoomWhirl', 'plunge', 'tilted', 'swarm'],
  tides: ['tides', 'tensor'],
  clocks: ['clocks'],
  chirp: ['chirp', 'ringdown'],
  validation: [],
};
