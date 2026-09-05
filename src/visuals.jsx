import React from 'react';
import { A2uiSurface, createComponentImplementation } from '@a2ui/react/v0_9';
import { Catalog, MessageProcessor } from '@a2ui/web_core/v0_9';
import { CATALOG_ID, chartSchema, tableSchema, networkSchema } from '../shared/visuals.mjs';

const select = reference => reference && window.dispatchEvent(new CustomEvent('companion-select', { detail: reference }));
function ChartView({ props: p }) {
  const [hover, setHover] = React.useState(null);
  const values = p.data.map(d => d.value);
  const max = Math.max(...values, 0.001), min = Math.min(...values, 0);
  const range = max - min || 1;
  const x = i => 42 + i * (490 / Math.max(1, p.data.length - 1));
  const y = v => 185 - (v - min) / range * 155;
  return <div className="visual-content"><h3>{p.title}</h3><p className="source">{p.source}</p>
    {p.type === 'bar' ? <div className="bars">{p.data.map((d, i) => <button key={i} className="bar-row" disabled={!d.reference} onClick={() => select(d.reference)} title={`${d.label}: ${d.value} ${p.unit}`}>
      <span>{d.label}</span><div className="bar-track"><div style={{width: `${Math.abs(d.value) / Math.max(...values.map(Math.abs), 0.001) * 100}%`}}/></div><b>{d.value} <small>{p.unit}</small></b>
    </button>)}</div> : <><svg className="line-chart" viewBox="0 0 570 225" role="img" aria-label={p.title}>
      {[0, .5, 1].map(f => <g key={f}><line x1="42" x2="540" y1={y(min + range*f)} y2={y(min + range*f)} stroke="#304047"/><text x="0" y={y(min+range*f)+4} fill="#99acb2" fontSize="10">{(min+range*f).toFixed(1)}</text></g>)}
      <polyline points={p.data.map((d,i)=>`${x(i)},${y(d.value)}`).join(' ')} fill="none" stroke="#b6edaa" strokeWidth="2.5"/>
      {p.data.map((d,i)=><g key={i}><circle cx={x(i)} cy={y(d.value)} r="5" fill="#b6edaa" onMouseEnter={()=>setHover(d)} onFocus={()=>setHover(d)} tabIndex="0" onClick={()=>select(d.reference)}><title>{d.label}: {d.value} {p.unit}</title></circle>{(p.data.length<12 || i===0 || i===p.data.length-1)&&<text x={x(i)} y="211" textAnchor="middle" fill="#99acb2" fontSize="10">{d.label}</text>}</g>)}
    </svg><p className="source">{hover ? `${hover.label}: ${hover.value} ${p.unit}` : `Hover over a point · ${p.unit}`}</p></>}
  </div>;
}
function TableView({props:p}) { return <div className="visual-content"><h3>{p.title}</h3><p className="source">{p.source}</p><div className="table-scroll"><table><thead><tr>{p.columns.map((c,i)=><th key={i}>{c}</th>)}</tr></thead><tbody>{p.rows.map((row,i)=><tr key={i}>{row.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></div></div>; }
function NetworkView({props:p}) {
  const cols=Math.min(p.nodes.length,3), rows=Math.ceil(p.nodes.length/cols), height=rows*105+35;
  const positions=Object.fromEntries(p.nodes.map((n,i)=>[n.id,{x:95+(i%cols)*185,y:50+Math.floor(i/cols)*105}]));
  return <div className="visual-content"><h3>{p.title}</h3><p className="source">{p.source}</p><svg viewBox={`0 0 570 ${height}`} className="network" role="img" aria-label={p.title}>
    {p.edges.map((e,i)=>{const a=positions[e.from],b=positions[e.to];return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#698a79" strokeWidth="1.5"/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2-7} textAnchor="middle" fontSize="10" fill="#c0c9cf">{e.label}</text></g>})}
    {p.nodes.map(n=><g key={n.id} onClick={()=>select(n.reference)} role={n.reference?'button':undefined} tabIndex={n.reference?0:undefined} onKeyDown={e=>e.key==='Enter'&&select(n.reference)} style={{cursor:n.reference?'pointer':'default'}}><rect x={positions[n.id].x-75} y={positions[n.id].y-23} width="150" height="46" rx="8" fill="#1c2e2d" stroke="#749b84"/><text x={positions[n.id].x} y={positions[n.id].y+4} textAnchor="middle" fontSize="11" fill="#dbebdf">{n.label}</text></g>)}
  </svg></div>;
}
export const engineeringCatalog = new Catalog(CATALOG_ID, [
  createComponentImplementation({name:'Chart',schema:chartSchema},ChartView),
  createComponentImplementation({name:'DataTable',schema:tableSchema},TableView),
  createComponentImplementation({name:'Network',schema:networkSchema},NetworkView),
]);
class Boundary extends React.Component { state={error:null}; static getDerivedStateFromError(error){return {error:error.message}} render(){return this.state.error?<p className="error">Visual could not render: {this.state.error}</p>:this.props.children;} }
export function VisualSurface({messages}) {
  const result = React.useMemo(()=>{try{const processor=new MessageProcessor([engineeringCatalog]);processor.processMessages(messages);return {surfaces:[...processor.model.surfacesMap.values()]};}catch(e){return {error:e.message};}},[messages]);
  return <Boundary key={JSON.stringify(messages)}>{result.error?<p className="error">{result.error}</p>:result.surfaces.map(s=><A2uiSurface key={s.id} surface={s}/>)}</Boundary>;
}
