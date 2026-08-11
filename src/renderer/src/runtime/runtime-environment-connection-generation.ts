const connectionGenerationByEnvironment = new Map<string, number>()
let latestConnectionGeneration = 0

/** Identifies the current live connection epoch for one saved runtime environment. */
export function getRuntimeEnvironmentConnectionGeneration(environmentId: string): number {
  const existing = connectionGenerationByEnvironment.get(environmentId)
  if (existing !== undefined) {
    return existing
  }
  connectionGenerationByEnvironment.set(environmentId, latestConnectionGeneration)
  return latestConnectionGeneration
}

/** Retires work that was created against the environment's previous connection. */
export function advanceRuntimeEnvironmentConnectionGeneration(environmentId: string): number {
  const next = ++latestConnectionGeneration
  connectionGenerationByEnvironment.set(environmentId, next)
  return next
}

/** Releases an environment's registry entry after its prior generation was retired. */
export function retireRuntimeEnvironmentConnectionGeneration(environmentId: string): void {
  connectionGenerationByEnvironment.delete(environmentId)
}

export function getRuntimeEnvironmentConnectionGenerationCountForTests(): number {
  return connectionGenerationByEnvironment.size
}

export function resetRuntimeEnvironmentConnectionGenerationsForTests(): void {
  connectionGenerationByEnvironment.clear()
  latestConnectionGeneration = 0
}
