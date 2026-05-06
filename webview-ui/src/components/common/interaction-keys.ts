export function nextRovingIndex(currentIndex: number, itemCount: number, key: string): number {
  if (itemCount <= 0) return -1
  if (key === "Home") return 0
  if (key === "End") return itemCount - 1
  if (key === "ArrowDown" || key === "ArrowRight") return (Math.max(currentIndex, 0) + 1) % itemCount
  if (key === "ArrowUp" || key === "ArrowLeft") return (Math.max(currentIndex, 0) - 1 + itemCount) % itemCount
  return currentIndex
}

export function isDismissKey(key: string): boolean {
  return key === "Escape"
}

export function isRovingKey(key: string): boolean {
  return key === "ArrowDown" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowLeft" || key === "Home" || key === "End"
}
