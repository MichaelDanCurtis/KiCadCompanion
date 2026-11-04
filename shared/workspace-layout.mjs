export const defaultLayout = Object.freeze({version: 1, primary: 45, collapsed: null});
export const layoutBounds = Object.freeze({min: 25, max: 70});

export function normalizeLayout(value) {
  if (!value || value.version !== 1) return {...defaultLayout};
  return {version: 1,
    primary: typeof value.primary === 'number' && Number.isFinite(value.primary)
      ? Math.min(layoutBounds.max, Math.max(layoutBounds.min, value.primary)) : defaultLayout.primary,
    collapsed: ['primary', 'secondary'].includes(value.collapsed) ? value.collapsed : null};
}

// Preferences belong to this browser profile and origin, never the product manifest.
export function layoutStorageKey(scope) {
  return `benchline.workspace-layout.v1:${encodeURIComponent(scope)}`;
}
