import { HandLandmarksDTO } from "../../types/hand";
import { TrackingQualityDTO } from "../../types/tracking";

export type HandTrackingResult = {
  landmarks: HandLandmarksDTO[];
  quality: TrackingQualityDTO;
  timestampMs: number;
};

export interface HandTrackingPort {
  init(): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): Promise<HandTrackingResult>;
  close(): void;
}
