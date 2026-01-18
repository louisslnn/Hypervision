export type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
};

export type Handedness = "Left" | "Right" | "Unknown";

export type HandLandmarksDTO = {
  handId: string;
  landmarks: LandmarkPoint[];
  handedness: Handedness;
  score?: number;
};
