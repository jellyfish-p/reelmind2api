export const IMAGE_GENERATION_COST = 5
export const VIDEO_CREDITS_PER_SECOND = 10

export function videoGenerationCost(duration: unknown): number {
  const seconds = Number(duration)
  const billableSeconds = Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : 1
  return billableSeconds * VIDEO_CREDITS_PER_SECOND
}
