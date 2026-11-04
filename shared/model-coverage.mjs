// Summarize availability separately from population and partial model lists.
export function modelCoverage(report) {
  if(report?.schemaVersion!==2 || !Array.isArray(report.components)) return null;
  if(report.components.some(c=>!c||typeof c.reference!=='string'||typeof c.dnp!=='boolean'||!Array.isArray(c.models)||
    c.models.some(m=>!m||typeof m.exists!=='boolean'||typeof m.visible!=='boolean'||!Number.isFinite(m.opacity)||m.opacity<0||m.opacity>1))) return null;
  const omitted=report.components.filter(c=>c.dnp);
  const populated=report.components.filter(c=>!c.dnp);
  const visible=m=>m.visible&&m.opacity>0;
  const available=populated.filter(c=>c.models.some(m=>visible(m)&&m.exists));
  const missing=populated.filter(c=>!c.models.some(m=>visible(m)&&m.exists));
  const partial=available.filter(c=>c.models.some(m=>visible(m)&&!m.exists));
  return {populated,omitted,available,missing,partial};
}
