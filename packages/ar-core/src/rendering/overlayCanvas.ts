export function syncCanvasToVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const width = video.clientWidth || video.videoWidth;
  const height = video.clientHeight || video.videoHeight;

  if (width > 0 && height > 0) {
    canvas.width = width;
    canvas.height = height;
  }
}
