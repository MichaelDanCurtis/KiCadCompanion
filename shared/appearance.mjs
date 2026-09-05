export const BOARD_COLORS = ['kicad', 'white', 'black', 'green', 'red'];
export const DEFAULT_APPEARANCE = { version: 1, theme: 'kicad', boardColor: 'kicad' };
export function parseAppearance(value) {
  if (value?.version !== 1) return { ...DEFAULT_APPEARANCE };
  return { version: 1, theme: ['kicad', 'original'].includes(value.theme) ? value.theme : 'kicad',
    boardColor: BOARD_COLORS.includes(value.boardColor) ? value.boardColor : 'kicad' };
}
// KiCad 10 default PCB colors; keys correspond to its saved color-theme schema.
export const DEFAULT_BOARD_PALETTE = {
  background: '#001023', grid: '#848484', edge: '#d0d2cd', front: '#c83434', back: '#4d7fc4',
  inner1: '#7fc87f', inner2: '#ce7d2c', silk: '#f2eda1', pad: '#c2c200', highlight: '#04ff43',
};
export function boardPalette(color, kicad = DEFAULT_BOARD_PALETTE) {
  const common = { ...DEFAULT_BOARD_PALETTE, ...kicad, fill: 'rgba(100,100,100,.12)', body: '#20252b', text: '#f2eda1' };
  const finishes = {
    white: { fill: '#e5e7e2', edge: '#bfc6ba', silk: '#293d32', body: '#25352d', front: '#647d60', back: '#4d72a3', pad: '#b18b38', highlight: '#a33a08' },
    black: { fill: '#171b20', edge: '#636a72', silk: '#e7e8df', front: '#6d7970', back: '#537dac', pad: '#dab66c', highlight: '#fff2a5' },
    green: { fill: '#15573d', edge: '#72aa7e', silk: '#f0efcd', front: '#83b67e', back: '#7aa8d5', pad: '#e0bd73', highlight: '#fff3a0' },
    red: { fill: '#722b33', edge: '#c58080', silk: '#f9e8d3', front: '#d88c79', back: '#8cb8e0', pad: '#edca81', highlight: '#fff3a0' },
  };
  return { ...common, ...(finishes[color] || {}), text: color === 'white' ? '#fffbee' : common.text };
}
// Join unordered, reversible straight Edge.Cuts segments. Never invent closure
// across gaps. Multiple closed contours use evenodd fill so cutouts stay empty.
export function outlinePath(shapes = []) {
  const key = p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const edges = shapes.filter(s => s.layer === 'BL_Edge_Cuts' && valid(s.start) && valid(s.end));
  const links = new Map();
  edges.forEach((s,i) => { for (const p of [s.start,s.end]) { const k=key(p); links.set(k,[...(links.get(k)||[]),i]); } });
  if ([...links.values()].some(a => a.length !== 2)) return '';
  const unused = new Set(edges.map((_,i)=>i)), contours=[];
  while (unused.size) {
    const first=edges[unused.values().next().value].start;
    let current=first, path=`M ${first.x} ${first.y}`, count=0;
    do {
      const i=links.get(key(current))?.find(i=>unused.has(i));
      if(i===undefined) return '';
      unused.delete(i);
      const e=edges[i]; current=key(e.start)===key(current)?e.end:e.start;
      path+=` L ${current.x} ${current.y}`; count++;
    } while(key(current)!==key(first));
    if(count<3)return '';
    contours.push(path+' Z');
  }
  return contours.join(' ');
}
