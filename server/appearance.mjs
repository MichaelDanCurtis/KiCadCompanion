import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { DEFAULT_BOARD_PALETTE } from '../shared/appearance.mjs';
import { config } from './config.mjs';

export function themePalette(theme) {
  const b=theme?.board||{};
  const fields={background:b.background,grid:b.grid,edge:b.edge_cuts,front:b.copper?.f,back:b.copper?.b,
    inner1:b.copper?.in1,inner2:b.copper?.in2,silk:b.f_silks,pad:b.pad_plated_hole};
  // Only literal colors cross into the renderer; never URLs, CSS or expressions.
  const color=v=>typeof v==='string' && (/^#[\da-f]{6}([\da-f]{2})?$/i.test(v)||/^rgba?\(\s*[\d.,\s]+\)$/.test(v));
  return {...DEFAULT_BOARD_PALETTE,...Object.fromEntries(Object.entries(fields).filter(([,v])=>color(v)))};
}
export async function readKiCadAppearance(directory = config.kiCadConfigDir) {
  const fallback = { name:'KiCad Default', source:'built-in palette', palette:{...DEFAULT_BOARD_PALETTE} };
  try {
    const settings=JSON.parse(await readFile(join(directory,'pcbnew.json'),'utf8'));
    const theme=settings.appearance?.color_theme;
    if(theme==='_builtin_default')return {...fallback,source:'KiCad saved preferences'};
    if(!theme||theme.startsWith('_builtin_'))return {...fallback,note:'Selected theme is not imported; using KiCad Default.'};
    if(basename(theme)!==theme)throw new Error('Unsupported theme path');
    const data=JSON.parse(await readFile(join(directory,'colors',theme.endsWith('.json')?theme:theme+'.json'),'utf8'));
    return {name:typeof data.meta?.name==='string'?data.meta.name:theme,source:'KiCad saved color theme',palette:themePalette(data)};
  } catch { return {...fallback,note:'Saved theme unavailable; using KiCad Default.'}; }
}
