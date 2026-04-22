/**
 * Unit conversion utility for household inventory.
 *
 * Each group maps unit names → factor relative to the group's base unit.
 *
 * Sources:
 *   Weight  — https://officeguide.cc/weight-unit-converter/
 *             台斤=600g (Taiwan), 市斤=500g (PRC 1959), lbs exact = 453.59237g
 *   Length  — 1 inch = 25.4 mm (exact, 1959 international standard)
 *             1 ft = 304.8 mm, 1 yard = 914.4 mm
 *   Area    — 1 坪 = 3.305785 m²  https://www.conversion-website.com/area/from-ping.html
 *             1 甲 = 2934 坪 = 9699.17 m²
 *   Volume  — SI + common kitchen/US measures
 */

// ── Weight (base: g) ──────────────────────────────────────────
const WEIGHT_G: Record<string, number> = {
  // Metric
  mg: 0.001,
  g: 1,
  公克: 1,
  克: 1,
  kg: 1000,
  公斤: 1000,

  // Traditional / Taiwan
  台斤: 600,
  斤: 600, // 台斤 in Taiwan context (600 g)

  // Mainland China
  市斤: 500,

  // Imperial
  lbs: 453.59237,
  lb: 453.59237,
  磅: 453.59237,
  oz: 28.34952,
  盎司: 28.34952,
};

// ── Length (base: mm) ─────────────────────────────────────────
const LENGTH_MM: Record<string, number> = {
  // Metric
  微米: 0.001,
  mm: 1,
  毫米: 1,
  cm: 10,
  公分: 10,
  m: 1000,
  公尺: 1000,
  米: 1000,
  km: 1_000_000,
  公里: 1_000_000,

  // Imperial (exact by international definition)
  inch: 25.4,
  in: 25.4,
  吋: 25.4,
  英吋: 25.4,
  ft: 304.8,
  feet: 304.8,
  foot: 304.8,
  英尺: 304.8,
  yd: 914.4,
  yard: 914.4,
  英碼: 914.4,
};

// ── Area (base: m²) ───────────────────────────────────────────
const AREA_M2: Record<string, number> = {
  // Metric
  'mm²': 0.000_001,
  'cm²': 0.000_1,
  'm²': 1,
  平方公尺: 1,
  'km²': 1_000_000,
  公頃: 10_000,
  hectare: 10_000,

  // Taiwan / traditional
  坪: 3.305_785,
  甲: 9_699.17, // 2934 坪
  分: 969.917, // 1/10 甲

  // Imperial
  'ft²': 0.092_903,
  'in²': 0.000_645_16,
  acre: 4_046.856,
};

// ── Volume (base: ml) ─────────────────────────────────────────
const VOLUME_ML: Record<string, number> = {
  // Metric / SI
  ml: 1,
  毫升: 1,
  cc: 1, // 1 cc = 1 ml
  cl: 10,
  dl: 100,
  l: 1000,
  L: 1000,
  公升: 1000,
  升: 1000,

  // Kitchen measures (US standard)
  茶匙: 5,
  tsp: 5,
  湯匙: 15,
  tbsp: 15,
  杯: 240, // US cup
  cup: 240,

  // US fluid
  'fl oz': 29.5735,
  floz: 29.5735,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
};

// ─────────────────────────────────────────────────────────────

const GROUPS: Record<string, number>[] = [WEIGHT_G, LENGTH_MM, AREA_M2, VOLUME_ML];

function lookupFactor(unit: string, table: Record<string, number>): number | undefined {
  return table[unit] ?? table[unit.toLowerCase()];
}

/**
 * Convert `value` from `fromUnit` to `toUnit`.
 * Returns `null` when the units belong to different dimensions or are unrecognised.
 */
export function convertUnit(value: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return value;

  for (const group of GROUPS) {
    const from = lookupFactor(fromUnit, group);
    const to = lookupFactor(toUnit, group);
    if (from !== undefined && to !== undefined) {
      return (value * from) / to;
    }
  }

  return null;
}
