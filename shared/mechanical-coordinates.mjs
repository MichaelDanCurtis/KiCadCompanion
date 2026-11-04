const units = new Set(['mm', 'inch']);
const faces = new Set(['top', 'bottom']);

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

/**
 * Convert a board-local point into enclosure coordinates.
 * Bottom-side coordinates are mirrored across the board Y axis before the
 * declared in-plane rotation.  This is a pure transform; it does not grant
 * native write or fit authority.
 */
export function transformBoardPoint(point, {
  units: sourceUnits = 'mm',
  face = 'top',
  rotationDeg = 0,
  originMM = {xMM: 0, yMM: 0, zMM: 0},
} = {}) {
  if (!units.has(sourceUnits)) throw new Error(`unsupported source units: ${sourceUnits}`);
  if (!faces.has(face)) throw new Error(`unsupported board face: ${face}`);
  const scale = sourceUnits === 'inch' ? 25.4 : 1;
  let x = finite(point.x, 'point.x') * scale;
  let y = finite(point.y, 'point.y') * scale;
  const z = finite(point.z ?? 0, 'point.z') * scale;
  const angle = finite(rotationDeg, 'rotationDeg') * Math.PI / 180;
  if (face === 'bottom') x = -x;
  const rotated = {
    xMM: x * Math.cos(angle) - y * Math.sin(angle) + finite(originMM.xMM, 'originMM.xMM'),
    yMM: x * Math.sin(angle) + y * Math.cos(angle) + finite(originMM.yMM, 'originMM.yMM'),
    zMM: z + finite(originMM.zMM, 'originMM.zMM'),
  };
  return Object.fromEntries(Object.entries(rotated).map(([key, value]) => [key, Math.round(value * 1e9) / 1e9]));
}

