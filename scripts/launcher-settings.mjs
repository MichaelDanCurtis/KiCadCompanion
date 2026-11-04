// Capture explicit, non-secret launch configuration. GUI apps do not reliably
// inherit the shell used to install/build them. Never copy the whole environment.
export function launcherEnvironment(config) {
  return {
    BENCHLINE_WORKSPACE: config.projectSelected ? config.workspace : '',
    BENCHLINE_STATE_DIR: config.stateRoot,
    BENCHLINE_BOARDS_DIR: config.boardsDir,
    BENCHLINE_PORT: String(config.port),
    BENCHLINE_AUTOCONNECT: config.autoConnect ? '1' : '0',
    BENCHLINE_PYTHON: config.observerPython,
    CODEX_BIN: config.codex, KONNECT_BIN: config.konnect,
    KICAD_CLI: config.cli, KICAD_PYTHON: config.modelPython,
    KICAD_PCB_EDITOR: config.pcbEditor,
    COMPANION_KICAD_CONFIG_DIR: config.kiCadConfigDir,
    ...(config.modelDir ? { KICAD_3DMODEL_DIR: config.modelDir } : {}),
    // Prevent an inherited prototype workspace from defeating an empty preview.
    COMPANION_WORKSPACE: '', COMPANION_RUNTIME_DIR: '',
  };
}

// Native bundles are built on one host but may be unpacked on another. Keep
// their launch metadata relative to the bundle's checkout and let the server
// resolve optional host tools from the target environment at runtime.
export function portableLauncherSettings() {
  return {
    node: 'node',
    script: 'scripts/launch.mjs',
    workingDirectory: '../../../../',
    env: {
      BENCHLINE_WORKSPACE: '',
      BENCHLINE_STATE_DIR: '.runtime/benchline',
      BENCHLINE_BOARDS_DIR: 'projects',
      BENCHLINE_PORT: '4318',
      BENCHLINE_AUTOCONNECT: '0',
      COMPANION_WORKSPACE: '',
      COMPANION_RUNTIME_DIR: '',
    },
  };
}
export const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
