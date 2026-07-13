export function assertBundledRendererSender(actualUrl: string | undefined, allowedRendererUrl: string): void {
  if (!actualUrl || actualUrl !== allowedRendererUrl) throw Object.assign(new Error('IPC sender is not the bundled lifecycle renderer.'), { code: 'IPC_SENDER_REJECTED' })
}
