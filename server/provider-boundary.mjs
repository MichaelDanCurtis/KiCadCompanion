// Fail closed until an independently tested provider exposes only mediated tools.
// A workspace-write sandbox and approval prompts do not constrain direct MCP,
// hosted connectors, browser actions, or every shell/network route.
export const providerBoundary=Object.freeze({version:1,provider:'codex-app-server',modes:{
  discuss:{supported:false,reason:'Discuss provider isolation is not verified. No agent process or turn will start.'},
  agent:{supported:false,reason:'Direct agent tool dispatch is paused until all actions use the revision-bound gate.'},
}});
export function requireProviderMode(mode){const m=providerBoundary.modes[mode];if(!m?.supported)throw Object.assign(new Error(m?.reason||'Unknown provider mode'),{status:422});}
