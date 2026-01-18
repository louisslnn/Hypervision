import { useEffect, useState } from "react";

type CameraState = {
  status: "idle" | "ready" | "error";
  error?: string;
};

export function useCamera(videoRef: React.RefObject<HTMLVideoElement>, enabled: boolean) {
  const [state, setState] = useState<CameraState>({ status: "idle" });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    const video = videoRef.current;
    if (!video) {
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (!active) {
          return;
        }
        video.srcObject = stream;
        video.play().catch(() => undefined);
        setState({ status: "ready" });
      })
      .catch((error) => {
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "Camera error"
        });
      });

    return () => {
      active = false;
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [enabled, videoRef]);

  return state;
}
