import { accessSync, constants, statSync } from 'node:fs'
import path from 'node:path'

export interface ResolveOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  isExecutable?: (file: string) => boolean
}

// No Windows, CLIs instalados via npm são "shims" (.cmd). O .ps1 é ignorado de
// propósito: não dá para executá-lo diretamente como processo.
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat']

function defaultIsExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** Procura um comando no PATH e devolve o caminho absoluto, ou null. */
export function resolveCommand(name: string, options: ResolveOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const isExecutable = options.isExecutable ?? defaultIsExecutable

  const isWindows = platform === 'win32'
  const p = isWindows ? path.win32 : path.posix
  const pathVar = (isWindows ? (env.Path ?? env.PATH) : env.PATH) ?? ''
  const extensions = isWindows ? WINDOWS_EXTENSIONS : ['']

  const searchDirs = pathVar.split(p.delimiter).filter(Boolean)
  if (name === 'agy' || name === 'antigravity') {
    if (isWindows) {
      if (env.LOCALAPPDATA) searchDirs.push(p.join(env.LOCALAPPDATA, 'agy', 'bin'))
      if (env.USERPROFILE) searchDirs.push(p.join(env.USERPROFILE, 'AppData', 'Local', 'agy', 'bin'))
    } else {
      if (env.HOME) searchDirs.push(p.join(env.HOME, '.local', 'bin'))
      searchDirs.push('/usr/local/bin')
    }
  }

  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const candidate = p.join(dir, name + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}
