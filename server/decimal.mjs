// Fixed-point decimal helpers, 8 decimal places (matches NUMERIC(28,8) in
// Postgres). Money and quantities are represented as BigInt scaled by 1e8
// everywhere in the matching engine — PRODUCT_REQUIREMENTS.md is explicit
// that "decimal monetary quantities must never use JavaScript floating-point
// arithmetic," and 0.1 + 0.2 !== 0.3 is exactly the kind of bug that rule
// exists to prevent in something that moves money.

const SCALE_DIGITS = 8;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

/** Parse a decimal string (e.g. "0.4", "10000", "1.23456789") into a scaled BigInt. */
export function parse(value) {
  const text = String(value).trim();
  // Accept normal exchange-style shorthand such as `.1` as well as `0.1`.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`Not a valid decimal amount: ${value}`);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > SCALE_DIGITS) {
    throw new Error(`Amount has more than ${SCALE_DIGITS} decimal places: ${value}`);
  }
  const paddedFraction = fraction.padEnd(SCALE_DIGITS, "0");
  const scaled = BigInt(whole || "0") * SCALE + BigInt(paddedFraction || "0");
  return negative ? -scaled : scaled;
}

/** Format a scaled BigInt back into a plain decimal string for Postgres/JSON. */
export function format(scaled) {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(SCALE_DIGITS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export const ZERO = 0n;
export const add = (a, b) => a + b;
export const sub = (a, b) => a - b;
/** Multiply two scaled amounts (e.g. quantity * price). Truncates any remainder below 1e-8 — it never manufactures value, only ever rounds down. */
export const mul = (a, b) => (a * b) / SCALE;
/** Divide two scaled amounts (e.g. budget / price -> affordable quantity). Truncates down for the same reason. */
export const div = (a, b) => (a * SCALE) / b;
export const min = (a, b) => (a < b ? a : b);
export const isPositive = (a) => a > 0n;
export const isZero = (a) => a === 0n;
