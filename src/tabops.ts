// Pure helpers for tab list operations (unit tested).

export type CloseScope = "this" | "others" | "right" | "left" | "all";

/** Indices of tabs closed by `scope` relative to the tab at `index`. */
export function indicesToClose(count: number, index: number, scope: CloseScope): number[] {
  const all = [...Array(count).keys()];
  switch (scope) {
    case "this":
      return [index];
    case "others":
      return all.filter((i) => i !== index);
    case "right":
      return all.filter((i) => i > index);
    case "left":
      return all.filter((i) => i < index);
    case "all":
      return all;
  }
}

/** Returns a copy of `items` with the element at `from` moved to position `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item);
  return copy;
}

/**
 * Target position of a dragged tab: the number of other tabs whose centre lies
 * left of the pointer.
 */
export function dropIndex(pointerX: number, otherCentres: number[]): number {
  return otherCentres.filter((x) => x < pointerX).length;
}
