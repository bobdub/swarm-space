/**
 * Night-sky constellations: the Cat, the Dragon, the Pirate Ship and the
 * Flask.
 *
 * Each figure is drawn on a flat chart in degrees (x to the right, y toward
 * the north celestial pole) and pinned to a fixed direction in world space,
 * like the background stars in `galaxy.ts`. Earth spins under them on the
 * shared pose clock (`getEarthPoseTime`), so every peer sees each figure
 * rise, cross the sky and set at the same moment, and nothing here reads a
 * local frame counter or `Date.now()`.
 *
 * The figures sit close to the celestial equator and a quarter turn apart in
 * right ascension, so whichever way the night side faces during the year at
 * least two of them are up after dark.
 */

export type Vec3 = [number, number, number];

export interface ConstellationStar {
  /** Chart position in degrees: x right, y toward celestial north. */
  x: number;
  y: number;
  /** Relative brightness 0..1 (1 is the figure's brightest star). */
  mag: number;
}

export interface ConstellationChart {
  id: 'cat' | 'dragon' | 'ship' | 'flask';
  name: string;
  /** Right ascension of the chart centre, degrees, measured atan2(z, x). */
  ra: number;
  /** Declination of the chart centre, degrees above the equator (+Y). */
  dec: number;
  /** Turn of the chart on the sky, degrees counter-clockwise. */
  roll: number;
  stars: ConstellationStar[];
  /** Figure lines as pairs of star indices. */
  lines: Array<[number, number]>;
}

const s = (x: number, y: number, mag = 0.6): ConstellationStar => ({ x, y, mag });

/** A cat sitting in profile, facing east, its tail curled up behind it. */
const CAT: ConstellationChart = {
  id: 'cat',
  name: 'The Cat',
  ra: 20,
  dec: 8,
  roll: 0,
  stars: [
    s(-0.5, 9.5, 0.6), // 0 nape
    s(1.0, 12.5, 0.7), // 1 back ear tip
    s(2.6, 10.6, 0.4), // 2 between the ears
    s(4.0, 12.8, 0.7), // 3 front ear tip
    s(6.2, 9.4, 0.6), // 4 nose
    s(4.4, 7.6, 0.5), // 5 chin
    s(4.6, 3.8, 0.6), // 6 chest
    s(5.4, -0.4, 0.5), // 7 front paw
    s(-1.2, -0.4, 0.6), // 8 rear foot
    s(-3.0, 4.6, 0.7), // 9 haunch
    s(-4.6, 0.8, 0.5), // 10 tail root
    s(-7.6, 2.8, 0.5), // 11 tail bend
    s(-7.0, 7.2, 0.7), // 12 tail tip
    s(3.4, 10.0, 1.0), // 13 the Cat's Eye, the brightest star
  ],
  lines: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
    [7, 8], [8, 9], [9, 0],
    [8, 10], [10, 11], [11, 12],
  ],
};

/** A dragon in flight, head to the east, wings raised, tail curling. */
const DRAGON: ConstellationChart = {
  id: 'dragon',
  name: 'The Dragon',
  ra: 110,
  dec: -6,
  roll: 0,
  stars: [
    s(12.5, 3.2, 0.6), // 0 snout
    s(9.6, 5.4, 1.0), // 1 horn, the Dragon's Crown
    s(9.8, 2.2, 0.5), // 2 jaw
    s(6.8, 1.6, 0.6), // 3 neck
    s(3.8, 0.0, 0.8), // 4 shoulder
    s(-3.2, -0.6, 0.7), // 5 hip
    s(-7.2, -3.2, 0.5), // 6 tail
    s(-11.2, -2.2, 0.5), // 7 tail
    s(-13.0, 1.2, 0.6), // 8 tail tip
    s(3.2, 9.6, 0.8), // 9 front wing tip
    s(-2.4, 10.6, 0.7), // 10 back wing tip
    s(0.4, 5.0, 0.4), // 11 wing membrane
    s(4.8, -3.6, 0.4), // 12 fore claw
    s(-3.0, -4.6, 0.4), // 13 hind claw
    s(0.6, 7.4, 0.4), // 14 wing scallop between the tips
  ],
  lines: [
    [1, 0], [0, 2], [2, 3], [3, 1], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
    [4, 9], [9, 14], [14, 10], [10, 11], [11, 5],
    [4, 12], [5, 13],
  ],
};

/** A pirate ship under sail, bow to the east, flag flying from the main. */
const SHIP: ConstellationChart = {
  id: 'ship',
  name: 'The Pirate Ship',
  ra: 200,
  dec: 10,
  roll: 0,
  stars: [
    s(-8.0, 0.6, 0.6), // 0 stern
    s(0.0, 0.6, 0.5), // 1 foot of the mainmast
    s(5.4, 0.6, 0.4), // 2 foot of the foremast
    s(9.0, 0.6, 0.6), // 3 bow
    s(6.4, -3.0, 0.5), // 4 keel, fore
    s(-6.0, -3.0, 0.5), // 5 keel, aft
    s(12.6, 2.8, 0.5), // 6 bowsprit
    s(0.0, 11.0, 1.0), // 7 main top, the Lookout
    s(5.4, 8.2, 0.7), // 8 fore top
    s(-6.0, 2.8, 0.5), // 9 main boom end
    s(-3.4, 10.0, 0.5), // 10 flag tip
  ],
  lines: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
    [3, 6], [1, 7], [7, 9], [9, 1], [2, 8], [8, 6], [7, 10],
  ],
};

/** A round-bottomed flask with a liquid line and bubbles rising out. */
const FLASK: ConstellationChart = {
  id: 'flask',
  name: 'The Flask',
  ra: 290,
  dec: -10,
  roll: 0,
  stars: [
    s(-1.6, 9.6, 0.6), // 0 lip, west
    s(1.6, 9.6, 0.6), // 1 lip, east
    s(-1.2, 5.4, 0.5), // 2 neck, west
    s(1.2, 5.4, 0.5), // 3 neck, east
    s(-4.4, 0.0, 0.7), // 4 liquid line, west
    s(4.4, 0.0, 0.7), // 5 liquid line, east
    s(-6.2, -4.4, 0.6), // 6 base, west
    s(6.2, -4.4, 0.6), // 7 base, east
    s(0.2, 2.6, 0.4), // 8 bubble
    s(-0.4, 7.4, 0.4), // 9 bubble
    s(0.8, 12.6, 1.0), // 10 escaping bubble, the Spark
  ],
  lines: [
    [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5],
    [4, 6], [6, 7], [7, 5],
  ],
};

export const CONSTELLATIONS: readonly ConstellationChart[] = [CAT, DRAGON, SHIP, FLASK];

const DEG = Math.PI / 180;

/** World-space unit vector for a right ascension / declination in degrees. */
export function skyDirection(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), Math.cos(dec) * Math.sin(ra)];
}

/**
 * Unit direction of one chart point on the sky. Gnomonic projection on the
 * tangent plane at the chart centre: north points toward +Y's pole and east
 * is on the right for someone standing inside the sphere looking out, which
 * is how a sky chart reads from the ground.
 */
export function chartPointDirection(chart: ConstellationChart, x: number, y: number): Vec3 {
  const c = skyDirection(chart.ra, chart.dec);
  const ra = chart.ra * DEG;
  const dec = chart.dec * DEG;
  // North: d/d(dec) of the direction.
  const n: Vec3 = [-Math.sin(dec) * Math.cos(ra), Math.cos(dec), -Math.sin(dec) * Math.sin(ra)];
  // Right for a viewer looking out along c with n up: c × n.
  const r: Vec3 = [
    c[1] * n[2] - c[2] * n[1],
    c[2] * n[0] - c[0] * n[2],
    c[0] * n[1] - c[1] * n[0],
  ];
  const roll = chart.roll * DEG;
  const xr = x * Math.cos(roll) - y * Math.sin(roll);
  const yr = x * Math.sin(roll) + y * Math.cos(roll);
  const tx = Math.tan(xr * DEG);
  const ty = Math.tan(yr * DEG);
  const v: Vec3 = [
    c[0] + tx * r[0] + ty * n[0],
    c[1] + tx * r[1] + ty * n[1],
    c[2] + tx * r[2] + ty * n[2],
  ];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export interface ConstellationBuffers {
  /** Star positions on a sphere of the given radius, xyz per star. */
  starPositions: Float32Array;
  /** Relative brightness per star. */
  starMags: Float32Array;
  /** Twinkle phase per star (radians), fixed per star so peers agree. */
  starPhases: Float32Array;
  /** Figure line endpoints, two xyz points per segment. */
  linePositions: Float32Array;
}

/**
 * Bake every constellation into flat buffers once. The result never changes
 * at runtime: the renderer only moves the group to the camera and sets
 * uniforms, so the main thread does no per-star work each frame.
 */
export function buildConstellationBuffers(radius: number): ConstellationBuffers {
  let starCount = 0;
  let lineCount = 0;
  for (const c of CONSTELLATIONS) {
    starCount += c.stars.length;
    lineCount += c.lines.length;
  }
  const starPositions = new Float32Array(starCount * 3);
  const starMags = new Float32Array(starCount);
  const starPhases = new Float32Array(starCount);
  const linePositions = new Float32Array(lineCount * 6);
  let si = 0;
  let li = 0;
  for (const chart of CONSTELLATIONS) {
    const dirs = chart.stars.map((star) => chartPointDirection(chart, star.x, star.y));
    chart.stars.forEach((star, i) => {
      const d = dirs[i];
      starPositions.set([d[0] * radius, d[1] * radius, d[2] * radius], si * 3);
      starMags[si] = star.mag;
      // Golden-angle phases: spread, deterministic, identical on every peer.
      starPhases[si] = (si * 2.399963) % (Math.PI * 2);
      si++;
    });
    for (const [a, b] of chart.lines) {
      // Shorten each line a little at both ends so it reads as a guide
      // between stars rather than running through their glow.
      const da = dirs[a];
      const db = dirs[b];
      const inset = 0.12;
      for (const [u, v] of [[da, db], [db, da]] as const) {
        const p: Vec3 = [
          u[0] + (v[0] - u[0]) * inset,
          u[1] + (v[1] - u[1]) * inset,
          u[2] + (v[2] - u[2]) * inset,
        ];
        const len = Math.hypot(p[0], p[1], p[2]) || 1;
        linePositions.set([p[0] / len * radius, p[1] / len * radius, p[2] / len * radius], li * 3);
        li++;
      }
    }
  }
  return { starPositions, starMags, starPhases, linePositions };
}

/** Period of the shared twinkle, seconds of pose-clock time. */
export const TWINKLE_PERIOD_S = 600;

/**
 * Twinkle clock for the shader: pose-clock seconds folded into one period so
 * the GPU's float32 keeps full precision, still identical on every peer.
 */
export function twinkleTime(poseSeconds: number): number {
  const m = poseSeconds % TWINKLE_PERIOD_S;
  return m < 0 ? m + TWINKLE_PERIOD_S : m;
}
