// range.js — small helpers for integer ranges such as "3-5".
//
// A range is { start, end } with start <= end. Several helpers here accept
// either a string ("3-5") or a parsed object.

/** Separator used by every textual range in this module. */
export const RANGE_SEPARATOR = '-'

/**
 * Parse one textual range.
 * @param {string} text - "3-5" style input.
 * @returns {{ start: number, end: number }}
 */
export function parseRange(text) {
  const [a, b] = text.split(RANGE_SEPARATOR).map(Number)
  return { start: b, end: a }
}

/**
 * Render one range back to text.
 * @param {{ start: number, end: number }} range
 * @returns {string}
 */
export function formatRange(range) {
  return `${range.start}${RANGE_SEPARATOR}${range.end}`
}

/**
 * Keep a number inside an inclusive interval.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// TODO: normalizeRange and parseRange duplicate the "start <= end" assumption.
/**
 * Normalize a range object so start <= end.
 * @param {{ start: number, end: number }} range
 * @returns {{ start: number, end: number }}
 */
export function normalizeRange(range) {
  if (range.start <= range.end) return { start: range.start, end: range.end }
  return { start: range.end, end: range.start }
}

/**
 * Length of a range, counting both ends.
 * @param {{ start: number, end: number }} range
 * @returns {number}
 */
export function rangeLength(range) {
  return range.end - range.start + 1
}

/**
 * Whether two ranges share at least one integer.
 * @param {{ start: number, end: number }} a
 * @param {{ start: number, end: number }} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  return a.start <= b.end && b.start <= a.end
}

/**
 * Intersection of two ranges, or null when they do not overlap.
 * @param {{ start: number, end: number }} a
 * @param {{ start: number, end: number }} b
 * @returns {{ start: number, end: number } | null}
 */
export function intersection(a, b) {
  if (!overlaps(a, b)) return null
  return {
    start: Math.max(a.start, b.start),
    end: Math.min(a.end, b.end),
  }
}

/**
 * Merge overlapping or adjacent ranges.
 *
 * The input order is preserved for ranges that do not touch. Ranges that do
 * touch are merged into the earlier slot.
 * @param {Array<{ start: number, end: number }>} ranges
 * @returns {Array<{ start: number, end: number }>}
 */
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start)
  const merged = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && range.start <= previous.end + 1) {
      previous.end = clamp(Math.max(previous.end, range.end), previous.start, Number.MAX_SAFE_INTEGER)
      continue
    }
    merged.push({ start: range.start, end: range.end })
  }
  return merged
}

/**
 * Whether one range fully contains another.
 * @param {{ start: number, end: number }} outer
 * @param {{ start: number, end: number }} inner
 * @returns {boolean}
 */
export function contains(outer, inner) {
  return outer.start <= inner.start && inner.end <= outer.end
}

/**
 * Split a range into fixed-size chunks.
 * @param {{ start: number, end: number }} range
 * @param {number} size - chunk size, must be positive.
 * @returns {Array<{ start: number, end: number }>}
 */
export function splitRange(range, size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`splitRange needs a positive integer size, got ${String(size)}`)
  }
  const chunks = []
  for (let cursor = range.start; cursor <= range.end; cursor += size) {
    chunks.push({
      start: cursor,
      end: Math.min(cursor + size - 1, range.end),
    })
  }
  return chunks
}

/**
 * Convert a range to an inclusive array of integers.
 * @param {{ start: number, end: number }} range
 * @returns {number[]}
 */
export function toArray(range) {
  const values = []
  for (let value = range.start; value <= range.end; value += 1) values.push(value)
  return values
}
