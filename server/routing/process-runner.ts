import type { ProcessRunRequest, ProcessRunResult, RoutingProcessRunner } from './adapter-contract.js'
import { NodeBoundedProcessRunner, type BoundedProcessRunner } from '../process/bounded-process-runner.js'
import { safeSpawnCommand } from './safe-command.js'

export class NodeRoutingProcessRunner implements RoutingProcessRunner {
  private readonly runner: BoundedProcessRunner

  constructor(runner: BoundedProcessRunner = new NodeBoundedProcessRunner()) {
    this.runner = runner
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const command = safeSpawnCommand(request.executable, request.args)
    return this.runner.run({ ...request, executable: command.executable, args: command.args })
  }
}
