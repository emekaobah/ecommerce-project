/** Every number anywhere in a response, numeric strings included, to prove a figure isn't in it. */
export function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return [value]
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return [Number(value)]
  if (value && typeof value === "object") return Object.values(value).flatMap(numbersIn)
  return []
}
