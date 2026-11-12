/**
 * The three tiny helpers every patient-page component needs, in one place so a
 * component file is only about its own markup.
 */

/** A required element. A missing id is a build error, not a runtime shrug. */
export function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing #${id}`);
  }
  return node as T;
}

/** An element that may legitimately be absent on a trimmed build. */
export function optional<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
