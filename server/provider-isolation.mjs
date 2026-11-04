import {createHash} from 'node:crypto';
import {isAbsolute, join} from 'node:path';
import {canonical} from './actions.mjs';

// Qualification applies only to the local synthetic-provider experiment below.
// It does not enable authenticated production sessions or attest OS isolation.
export const probeQualification = Object.freeze({
  version: 'codex-cli 0.153.4',
  binarySha256: 'a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629',
  featureNamesSha256: 'f069e5e51d0ef20b0d5905b1a43e01b67bef91677c8432b2c2df01401a6eab1c',
  productionEnabled: false,
});
const requireValue = (ok, message) => {if (!ok) throw Error(message);};
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function parseProbeFeatures(output) {
  const names = output.trim().split('\n').map(line => line.trim().split(/\s+/)[0]).sort();
  requireValue(names.every(n => /^[a-z][a-z0-9_]+$/.test(n)), 'Invalid feature inventory');
  requireValue(new Set(names).size === names.length, 'Duplicate feature inventory');
  requireValue(sha256(JSON.stringify(names)) === probeQualification.featureNamesSha256,
    'Codex feature inventory changed; requalification required');
  return names;
}

export function assertProbeBinary(version, bytes) {
  requireValue(version.trim() === probeQualification.version && sha256(bytes) === probeQualification.binarySha256,
    'Codex binary changed or platform not qualified; do not reuse isolation evidence');
}

export function probeEnvironment(profileRoot, base = process.env) {
  requireValue(isAbsolute(profileRoot), 'Probe root must be absolute');
  // CODEX_HOME is used for its intended purpose: a separate child-process profile.
  // Never copy auth.json, shared config, tokens, proxies, MCP sockets or plugin env.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SYSTEMROOT']
    .filter(key => typeof base[key] === 'string').map(key => [key, base[key]]));
  return {...env, CODEX_HOME: join(profileRoot, 'codex')};
}

export function probeConfiguration(featureNames, endpoint) {
  const url = new URL(endpoint);
  requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port &&
    url.pathname === '/v1' && !url.username && !url.password && !url.search && !url.hash,
  'Synthetic provider endpoint must be explicit loopback /v1');
  requireValue(sha256(JSON.stringify([...featureNames].sort())) === probeQualification.featureNamesSha256,
    'Unqualified feature inventory');
  return [
    'model_provider="benchline_probe"', 'model="benchline-probe"',
    'approval_policy="never"', 'sandbox_mode="read-only"', 'web_search="disabled"',
    'project_doc_max_bytes=0', 'cli_auth_credentials_store="file"', 'allow_login_shell=false',
    'mcp_servers={}', 'plugins={}', 'history.persistence="none"', 'analytics.enabled=false',
    'feedback.enabled=false', '[model_providers.benchline_probe]', 'name="Benchline local qualification only"',
    `base_url=${JSON.stringify(url.href)}`, 'wire_api="responses"', 'requires_openai_auth=false',
    'supports_websockets=false', 'request_max_retries=0', 'stream_max_retries=0', '[features]',
    ...featureNames.map(name => `${name}=${name === 'skip_host_skill_discovery'}`), '',
  ].join('\n');
}

export function assertEffectiveProbeConfig(config, featureNames, endpoint) {
  requireValue(config?.model_provider === 'benchline_probe' && config.model === 'benchline-probe', 'Wrong synthetic provider');
  assertIsolatedCommonConfig(config, featureNames);
  const provider = config.model_providers?.benchline_probe;
  requireValue(provider?.base_url === endpoint && provider.requires_openai_auth === false && provider.supports_websockets === false,
    'Unexpected model transport');
  for (const key of ['env_key', 'experimental_bearer_token', 'auth', 'http_headers', 'env_http_headers']) {
    requireValue(provider[key] == null, 'Unexpected provider credentials or headers');
  }
  return {configurationMatches: true, productionEnabled: false};
}

export function assertIsolatedCommonConfig(config, featureNames) {
  requireValue(config.approval_policy === 'never' && config.sandbox_mode === 'read-only' && config.web_search === 'disabled',
    'Effective permission settings differ from probe policy');
  for (const name of featureNames) {
    // This pinned binary lists the removed flag but omits it from config/read.
    // Do not generalize absence into false for active or newly discovered flags.
    if (name === 'apps_mcp_path_override' && config.features?.[name] === undefined) continue;
    requireValue(config.features?.[name] === (name === 'skip_host_skill_discovery'),
      `Unexpected effective feature: ${name} (${JSON.stringify(config.features?.[name])})`);
  }
  for (const [name, value] of Object.entries(config.features || {})) {
    requireValue(featureNames.includes(name) || value === false, 'Unexpected enabled feature');
  }
  for (const key of ['mcp_servers', 'plugins', 'marketplaces']) requireValue(config[key] && Object.keys(config[key]).length === 0,
    `Unexpected inherited ${key}`);
  for (const key of ['hooks', 'notify', 'instructions', 'developer_instructions', 'model_instructions_file']) {
    requireValue(config[key] == null, `Unexpected inherited ${key}`);
  }
  requireValue(config.project_doc_max_bytes === 0 && config.cli_auth_credentials_store === 'file' &&
    config.allow_login_shell === false && config.history?.persistence === 'none', 'Unexpected profile defaults');
}

export function assertProbeToolInventory(tools, dynamicTools) {
  requireValue(Array.isArray(tools), 'Missing observed model tool inventory');
  const names = tools.map(t => t.name);
  const expected = new Map(dynamicTools.map(t => [t.name, t]));
  requireValue(!expected.has('request_user_input') && new Set(names).size === names.length, 'Tool collision');
  for (const tool of tools) {
    requireValue(tool.type === 'function', 'Unexpected native or namespaced tool');
    // This non-mutating built-in cannot be removed by the observed configuration.
    // The client rejects its server requests; it never supplies action approval.
    if (tool.name === 'request_user_input') continue;
    const wanted = expected.get(tool.name);
    requireValue(wanted && canonical(tool.parameters) === canonical(wanted.inputSchema), 'Unexpected tool or altered schema');
  }
  requireValue([...expected.keys()].every(name => names.includes(name)), 'Missing mediated tool');
  return {names: [...names].sort(), productionEnabled: false};
}
