import {z} from 'zod';
import {openCandidateModelProfile} from './provider-profile.mjs';

const fail = (message = 'Model transport qualification failed.') => Object.assign(Error(message), {status: 422});
const selectedModel = z.string().min(1).max(200);
const startInput = z.object({ephemeral: z.literal(true), sandbox: z.literal('read-only'),
  approvalPolicy: z.literal('never'), developerInstructions: z.string().max(16000), dynamicTools: z.array(z.unknown()).length(3)}).strict();
const turnInput = z.object({threadId: z.string().min(1).max(200),
  input: z.array(z.object({type: z.literal('text'), text: z.string().min(1).max(16000)}).strict()).length(1)}).strict();
const interruptInput = z.object({threadId: z.string().min(1).max(200), turnId: z.string().min(1).max(200)}).strict();

export async function availableTextModels(rpc) {
  const models = [], cursors = new Set(); let cursor;
  for (let page = 0; page < 5; page++) {
    const result = await rpc.request('model/list', {limit: 100, includeHidden: false, ...(cursor ? {cursor} : {})});
    if (!Array.isArray(result?.data) || result.data.length > 100) throw fail();
    for (const entry of result.data) {
      const model = selectedModel.parse(entry.model);
      if (models.some(m => m.model === model)) throw fail();
      if (typeof entry.hidden !== 'boolean' || typeof entry.isDefault !== 'boolean') throw fail();
      models.push({model, hidden: entry.hidden, isDefault: entry.isDefault,
        text: Array.isArray(entry.inputModalities) && entry.inputModalities.includes('text')});
    }
    if (result.nextCursor == null) return models.filter(m => !m.hidden && m.text).map(({model, isDefault}) => ({model, isDefault}));
    cursor = z.string().min(1).max(4096).parse(result.nextCursor);
    if (cursors.has(cursor)) throw fail(); cursors.add(cursor);
  }
  throw fail('Model catalogue pagination exceeded the supported bound.');
}

export function assertModelThread(result, {model, cwd}) {
  if (result?.model !== model || result.modelProvider !== 'openai' || result.cwd !== cwd ||
      result.approvalPolicy !== 'never' || result.sandbox?.type !== 'readOnly' || result.sandbox.networkAccess !== false ||
      result.thread?.ephemeral !== true || result.thread.modelProvider !== 'openai' ||
      !Array.isArray(result.instructionSources) || result.instructionSources.length ||
      !Array.isArray(result.runtimeWorkspaceRoots) || result.runtimeWorkspaceRoots.length) throw fail();
  return z.string().min(1).max(200).parse(result.thread.id);
}

/** Signed-in candidate only. This is not a public launcher or a mode-enablement
 * switch. The caller supplies host-owned paths/model, never model arguments.
 * Tests may inject a local protocol fixture; production routes cannot do so.
 */
export async function openCandidateModelTransport({binary, root, model, signal, openProfile = openCandidateModelProfile}) {
  selectedModel.parse(model); signal?.throwIfAborted();
  const {rpc, cwd} = await openProfile({binary, root, signal});
  try {
    signal?.throwIfAborted();
    const account = await rpc.request('account/read', {refreshToken: false});
    if (account?.requiresOpenaiAuth !== true || account.account?.type !== 'chatgpt') {
      throw fail('Sign in explicitly through Benchline account setup, then disconnect setup before model qualification.');
    }
    const models = await availableTextModels(rpc);
    if (!models.some(m => m.model === model)) throw fail('Selected model is not available as a visible text model; no fallback was used.');
    signal?.throwIfAborted();
    const request = rpc.request.bind(rpc); let threadId = null, opening = false;
    rpc.request = async (method, params, timeout) => {
      try {
        signal?.throwIfAborted();
        if (method === 'thread/start') {
          if (threadId || opening) throw fail(); opening = true;
          const input = startInput.parse(params);
          if (JSON.stringify(input.dynamicTools.map(t => t?.name).sort()) !== JSON.stringify([
            'benchline_action_status', 'benchline_execute_action', 'benchline_prepare_action']) ||
              input.dynamicTools.some(t => t?.type !== 'function')) throw fail();
          const result = await request(method, {...input, model, modelProvider: 'openai', cwd,
            allowProviderModelFallback: false, environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [], serviceName: 'benchline'}, timeout);
          threadId = assertModelThread(result, {model, cwd}); return result;
        }
        if (method !== 'turn/start' && method !== 'turn/interrupt') throw fail();
        const input = (method === 'turn/start' ? turnInput : interruptInput).parse(params);
        if (!threadId || input.threadId !== threadId) throw fail();
        return await request(method, input, timeout);
      } catch (error) {await rpc.close(); throw fail();}
    };
    const onEvent = rpc.onEvent;
    rpc.onEvent = message => {
      if (['account/updated', 'account/login/completed'].includes(message?.method)) {rpc.close().catch(() => {}); return;}
      onEvent?.(message);
    };
    return rpc;
  } catch (error) {await rpc.close(); throw error.status === 422 ? error : fail();}
}
