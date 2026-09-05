import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function configuration({env=process.env, platform=process.platform, home=homedir(), root=appRoot}={}) {
  const workspace=resolve(env.COMPANION_WORKSPACE||join(root,'projects'));
  const runtime=resolve(env.COMPANION_RUNTIME_DIR||join(root,'.runtime'));
  const boardsDir=resolve(workspace,env.COMPANION_BOARDS_DIR||'.');
  const boardRelative=relative(workspace,boardsDir);
  if(boardRelative==='..'||boardRelative.startsWith('../')||boardRelative.startsWith('..\\')||isAbsolute(boardRelative))throw new Error('COMPANION_BOARDS_DIR must stay within COMPANION_WORKSPACE');
  const port=Number(env.COMPANION_PORT||4317);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('COMPANION_PORT must be an integer between 1024 and 65535');
  const kicadApp=env.KICAD_APP||'/Applications/KiCad/KiCad.app';
  const support=env.KICAD_SUPPORT_DIR||join(kicadApp,'Contents/SharedSupport');
  const base=env.KICAD_CONFIG_HOME||(platform==='darwin'?join(home,'Library/Preferences/kicad'):platform==='win32'?join(env.APPDATA||join(home,'AppData/Roaming'),'kicad'):join(env.XDG_CONFIG_HOME||join(home,'.config'),'kicad'));
  return {workspace,runtime,port,boardsDir,autoConnect:env.COMPANION_AUTOCONNECT!=='0',
    kiCadConfigDir:env.COMPANION_KICAD_CONFIG_DIR||join(base,'10.0'),
    cli:env.KICAD_CLI||(platform==='darwin'?join(kicadApp,'Contents/MacOS/kicad-cli'):'kicad-cli'),
    modelPython:env.KICAD_PYTHON||(platform==='darwin'?join(kicadApp,'Contents/Frameworks/Python.framework/Versions/3.9/bin/python3.9'):'python3'),
    observerPython:env.COMPANION_PYTHON||join(runtime,platform==='win32'?'venv/Scripts/python.exe':'venv/bin/python'),
    modelDir:env.KICAD_3DMODEL_DIR||(platform==='darwin'?join(support,'3dmodels'):null),
    pcbEditor:env.KICAD_PCB_EDITOR||(platform==='darwin'?join(dirname(kicadApp),'PCB Editor.app'):'pcbnew'),
    codex:env.CODEX_BIN||(platform==='darwin'&&existsSync('/Applications/ChatGPT.app/Contents/Resources/codex')?'/Applications/ChatGPT.app/Contents/Resources/codex':'codex'),
    konnect:env.KONNECT_BIN||(existsSync(join(home,'.local/bin/konnect'))?join(home,'.local/bin/konnect'):'konnect')};
}
export const config=configuration();
