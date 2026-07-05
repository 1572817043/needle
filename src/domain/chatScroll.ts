export function isChatNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 48
) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
