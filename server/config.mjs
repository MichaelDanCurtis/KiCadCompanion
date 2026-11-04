import { existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {ipcAddressSchema} from './adapters/konnect-binding.mjs';

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = path => existsSync(path) ? realpathSync(path) : resolve(path);
export function configuration({env=process.env, platform=process.platform, home=homedir(), root=appRoot}={}) {
  // Legacy workspace/tool settings remain explicit compatibility inputs. Never
  // reuse the prototype runtime: it contains history and permission grants.
  const projectSelected=Boolean((env.BENCHLINE_WORKSPACE||env.COMPANION_WORKSPACE||'').trim());
  const workspace=canonical(resolve(env.BENCHLINE_WORKSPACE||env.COMPANION_WORKSPACE||join(root,'projects')));
  // Keep the configured state path stable before and after first creation.
  const stateRoot=resolve(env.BENCHLINE_STATE_DIR||join(root,'.runtime','benchline'));
  const projectKey=projectSelected?createHash('sha256').update(workspace).digest('hex').slice(0,24):'unconfigured';
  const runtime=join(stateRoot,'projects',projectKey);
  const boardsDir=canonical(resolve(workspace,env.BENCHLINE_BOARDS_DIR||env.COMPANION_BOARDS_DIR||'.'));
  const boardRelative=relative(workspace,boardsDir);
  if(boardRelative==='..'||boardRelative.startsWith('../')||boardRelative.startsWith('..\\')||isAbsolute(boardRelative))throw new Error('BENCHLINE_BOARDS_DIR / COMPANION_BOARDS_DIR must stay within the selected workspace');
  const port=Number(env.BENCHLINE_PORT||env.COMPANION_PORT||4318);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('BENCHLINE_PORT / COMPANION_PORT must be an integer between 1024 and 65535');
  const kicadApp=env.KICAD_APP||'/Applications/KiCad/KiCad.app';
  const support=env.KICAD_SUPPORT_DIR||join(kicadApp,'Contents/SharedSupport');
  const base=env.KICAD_CONFIG_HOME||(platform==='darwin'?join(home,'Library/Preferences/kicad'):platform==='win32'?join(env.APPDATA||join(home,'AppData/Roaming'),'kicad'):join(env.XDG_CONFIG_HOME||join(home,'.config'),'kicad'));
  const actionKonnectConfig=env.BENCHLINE_KONNECT_CONFIG||null,actionIpcAddress=env.BENCHLINE_KICAD_IPC||null;
  if(Boolean(actionKonnectConfig)!==Boolean(actionIpcAddress))throw Error('BENCHLINE_KONNECT_CONFIG and BENCHLINE_KICAD_IPC must be set together');
  if(actionKonnectConfig&&(!isAbsolute(actionKonnectConfig)||/[\0\r\n]/.test(actionKonnectConfig)))throw Error('BENCHLINE_KONNECT_CONFIG must be an absolute local path');
  if(actionIpcAddress)ipcAddressSchema.parse(actionIpcAddress);
  const providerRuntime=env.BENCHLINE_PROVIDER_RUNTIME?.trim()||null,providerModel=env.BENCHLINE_PROVIDER_MODEL?.trim()||null;
  if(providerRuntime!==null&&providerRuntime!=='local-dispatch-v1')throw Error('Unknown BENCHLINE_PROVIDER_RUNTIME');
  if(Boolean(providerRuntime)!==Boolean(providerModel))throw Error('BENCHLINE_PROVIDER_RUNTIME and BENCHLINE_PROVIDER_MODEL must be set together');
  if(providerModel&&(providerModel.length>200||/[\0\r\n]/.test(providerModel)))throw Error('BENCHLINE_PROVIDER_MODEL must be one explicit model identifier');
  const nativeModelRegistration=env.BENCHLINE_NATIVE_MODEL_REGISTRATION||null;
  if(nativeModelRegistration&&(!isAbsolute(nativeModelRegistration)||/[\0\r\n]/.test(nativeModelRegistration)))throw Error('BENCHLINE_NATIVE_MODEL_REGISTRATION must be an absolute host configuration path');
  const moduleSources=env.BENCHLINE_MODULE_SOURCES||null;
  if(moduleSources&&(!isAbsolute(moduleSources)||/[\0\r\n]/.test(moduleSources)))throw Error('BENCHLINE_MODULE_SOURCES must be an absolute host configuration path');
  const digiKey=env.BENCHLINE_DIGIKEY||null;
  if(digiKey&&(!isAbsolute(digiKey)||/[\0\r\n]/.test(digiKey)))throw Error('BENCHLINE_DIGIKEY must be an absolute host configuration path');
  return {product:'benchline',workspace,projectSelected,projectKey,stateRoot,runtime,port,boardsDir,autoConnect:(env.BENCHLINE_AUTOCONNECT??env.COMPANION_AUTOCONNECT)!=='0',
    actionKonnectConfig,actionIpcAddress,providerRuntime,providerModel,nativeModelRegistration,
    editorObservation:env.BENCHLINE_EDITOR_OBSERVATION||null,moduleSources,digiKey,
    kiCadConfigDir:env.COMPANION_KICAD_CONFIG_DIR||join(base,'10.0'),
    cli:env.KICAD_CLI||(platform==='darwin'?join(kicadApp,'Contents/MacOS/kicad-cli'):'kicad-cli'),
    modelPython:env.KICAD_PYTHON||(platform==='darwin'?join(kicadApp,'Contents/Frameworks/Python.framework/Versions/3.9/bin/python3.9'):'python3'),
    observerPython:env.BENCHLINE_PYTHON||env.COMPANION_PYTHON||join(root,'.runtime',platform==='win32'?'venv/Scripts/python.exe':'venv/bin/python'),
    modelDir:env.KICAD_3DMODEL_DIR||(platform==='darwin'?join(support,'3dmodels'):null),
    pcbEditor:env.KICAD_PCB_EDITOR||(platform==='darwin'?join(dirname(kicadApp),'PCB Editor.app'):'pcbnew'),
    codex:env.CODEX_BIN||(platform==='darwin'&&existsSync('/Applications/ChatGPT.app/Contents/Resources/codex')?'/Applications/ChatGPT.app/Contents/Resources/codex':'codex'),
    konnect:env.KONNECT_BIN||(existsSync(join(home,'.local/bin/konnect'))?join(home,'.local/bin/konnect'):'konnect')};
}
export const config=configuration();
