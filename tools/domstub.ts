/**
 * Just enough DOM for the city to build itself in node.
 *
 * The textures are never sampled by a collision test - they only have to not
 * throw on the way past.
 */
const noop = () => undefined;
function ctx2d(): unknown {
  const self: Record<string, unknown> = {};
  const grad = { addColorStop: noop };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, k: string) {
      if (k === 'canvas') return canvas(1, 1);
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') {
        return () => grad;
      }
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h,
      });
      if (k in t) return t[k];
      return noop;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  };
  return new Proxy(self, handler);
}
function canvas(w = 1, h = 1): unknown {
  return {
    width: w, height: h,
    getContext: () => ctx2d(),
    toDataURL: () => 'data:,',
  };
}
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement: (tag: string) => (tag === 'canvas' ? canvas(256, 256) : { style: {}, appendChild: noop }),
  createElementNS: () => ({ style: {} }),
};
g.window = g;
g.self = g;
export {};
