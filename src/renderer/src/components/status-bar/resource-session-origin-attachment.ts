export function canAttachSessionToOrigin(
  ptyIdsByLeafId: Record<string, string> | undefined,
  originLeafId: string,
  sessionId: string
): boolean {
  const attachedPtyId = ptyIdsByLeafId?.[originLeafId]
  return attachedPtyId === undefined || attachedPtyId === sessionId
}
