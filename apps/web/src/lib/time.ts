/** mm:ss:ff where ff is the frame number at the composition's fps. */
export function formatTime(seconds: number, fps: number): string {
  const clamped = Math.max(0, seconds);
  const s = Math.floor(clamped);
  const frames = Math.round((clamped - s) * fps);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  const ff = frames.toString().padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}
