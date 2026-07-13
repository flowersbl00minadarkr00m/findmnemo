export interface SafeSpawnCommand { executable: string; args: string[] }

const SAFE_EXECUTABLE = /^[A-Za-z0-9._-]+\.cmd$/i
const SAFE_ARGUMENT = /^[A-Za-z0-9._:/-]+$/

export function safeSpawnCommand(executable: string, args: readonly string[]): SafeSpawnCommand {
  if (process.platform !== 'win32' || !executable.toLowerCase().endsWith('.cmd')) return { executable, args: [...args] }
  if (!SAFE_EXECUTABLE.test(executable) || args.some((arg) => !SAFE_ARGUMENT.test(arg))) throw new Error('UNSAFE_COMMAND_SHIM')
  const commandLine = [executable, ...args].join(' ')
  return { executable: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', commandLine] }
}
