// Small id / timestamp helpers for the app layer (NOT the pure lab helpers,
// which forbid Date.now/random). The app may use time and randomness freely.

let counter = 0;

export function newId(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${counter}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
