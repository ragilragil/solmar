// A small seeded generator built on xorshift32: the same seed always gives the
// same stream, which is what makes the city layout and the screenshot scenes
// repeatable. The helpers (range / int / pick) are the only way the game draws
// from it, so a scene can be replayed exactly by its seed.
export function createRandom(seed) {
  let s = (seed | 0) || 1;
  if (s < 0) s = -s;
  function next() {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  }
  function range(a, b) {
    return a + next() * (b - a);
  }
  function int(a, b) {
    return Math.floor(range(a, b + 1));
  }
  function pick(list) {
    return list[Math.floor(next() * list.length)];
  }
  return { next, range, int, pick };
}
