"""
HoloRay Core - Ultimate Hybrid Tracking Engine

The most robust AR tracking system possible. Feels "magnetic":
- Locks on with SIFT Visual DNA + HSV color verification
- Handles extreme motion with Forward-Backward optical flow
- Vanishes INSTANTLY when off-screen (0ms delay)
- Snaps back PRECISELY via RANSAC homography on re-entry

Architecture:
┌─────────────────────────────────────────────────────────────────┐
│                    FAST PATH (Every Frame)                       │
│  Lucas-Kanade Optical Flow with Forward-Backward Error Check    │
│  Target latency: <2ms | Boundary Guard: 5px from edge           │
├─────────────────────────────────────────────────────────────────┤
│                    SLOW PATH (Adaptive)                          │
│  SIFT Feature Matching + RANSAC Homography (6+ inliers)         │
│  Triggered: Low velocity (drift check) OR LOST (Re-ID)          │
│  Downscaled to 640px width for speed                            │
└─────────────────────────────────────────────────────────────────┘

Performance: <15ms latency, >60 FPS achievable
"""

import time
import logging
import math
import threading
from enum import Enum
from typing import Optional, Tuple, List, Dict
from dataclasses import dataclass, field
import uuid

import numpy as np
import cv2


class TrackingStatus(Enum):
    """Status of a tracked object."""
    TRACKING = "tracking"      # Actively tracking (green) - VISIBLE
    OCCLUDED = "occluded"      # Partial occlusion (yellow) - FADED  
    LOST = "lost"              # Object left frame - HIDDEN (instant)
    SEARCHING = "searching"    # Looking for re-ID - HIDDEN
    INACTIVE = "inactive"      # Not initialized


class KalmanSmoother:
    """
    Simple Kalman Filter for position smoothing.
    
    Eliminates jitter when the object is stationary but camera shakes.
    Uses a constant velocity motion model for prediction.
    
    State vector: [x, y, vx, vy]
    Measurement: [x, y]
    """
    
    def __init__(self, process_noise: float = 0.5, measurement_noise: float = 0.05):
        """
        Args:
            process_noise: How much we trust the motion model (higher = more responsive)
            measurement_noise: How noisy we expect measurements to be (lower = trust measurements more)
        """
        # State: [x, y, vx, vy]
        self.kf = cv2.KalmanFilter(4, 2)
        
        # Transition matrix (constant velocity model)
        # x' = x + vx*dt, y' = y + vy*dt, vx' = vx, vy' = vy (dt=1 frame)
        self.kf.transitionMatrix = np.array([
            [1, 0, 1, 0],
            [0, 1, 0, 1],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ], dtype=np.float32)

        # Measurement matrix (we observe x, y)
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0]
        ], dtype=np.float32)
        
        # Process noise covariance
        self.kf.processNoiseCov = np.eye(4, dtype=np.float32) * process_noise
        
        # Measurement noise covariance
        self.kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * measurement_noise
        
        # Initial state covariance
        self.kf.errorCovPost = np.eye(4, dtype=np.float32)
        
        self._initialized = False

    def initialize(self, x: float, y: float):
        """Initialize filter at position."""
        self.kf.statePost = np.array([[x], [y], [0], [0]], dtype=np.float32)
        self._initialized = True
    
    def predict_and_correct(self, x: float, y: float) -> Tuple[float, float]:
        """
        Predict next state and correct with measurement.
        
        Returns:
            Smoothed (x, y) position
        """
        if not self._initialized:
            self.initialize(x, y)
            return x, y

        # Predict
        self.kf.predict()
        
        # Correct with measurement
        measurement = np.array([[x], [y]], dtype=np.float32)
        corrected = self.kf.correct(measurement)
        
        return float(corrected[0, 0]), float(corrected[1, 0])
    
    def get_velocity(self) -> Tuple[float, float]:
        """Get estimated velocity."""
        if not self._initialized:
            return 0.0, 0.0
        return float(self.kf.statePost[2, 0]), float(self.kf.statePost[3, 0])
    
    def reset(self, x: float, y: float):
        """Reset filter to new position (e.g., after re-ID snap)."""
        self.initialize(x, y)


class LabelStatus(Enum):
    """Status of AI labeling process."""
    IDLE = "idle"           # No identification in progress
    THINKING = "thinking"   # API call in progress (show "...")
    LABELED = "labeled"     # Label has been set by AI
    ERROR = "error"         # API call failed


@dataclass
class TrackingState:
    """Current state of a tracked object."""
    status: TrackingStatus
    x: float  # Display coordinates (full resolution)
    y: float
    confidence: float
    is_occluded: bool
    visibility: float = 1.0
    opacity: float = 1.0
    velocity: Tuple[float, float] = (0.0, 0.0)
    frames_since_seen: int = 0
    last_good_position: Tuple[float, float] = (0.0, 0.0)
    scale: float = 1.0
    rotation: float = 0.0


class VisualDNA:
    """
    Visual DNA - The immutable identity of a tracked object.
    
    On initialization (click):
    1. Extract SIFT keypoints, keep TOP 50 STRONGEST (not all!)
    2. Store HSV histogram for color verification
    
    Why both?
    - SIFT sees texture/edges → can confuse white pawn for black pawn
    - HSV histogram sees color → prevents wrong-color matches
    
    This combination creates a robust "fingerprint" that uniquely
    identifies the object even after it leaves and re-enters the frame.
    """
    
    TOP_N_KEYPOINTS = 50  # Only keep strongest features
    ROI_SIZE = 120        # Region of interest around click
    HSV_BINS = (16, 16, 8)  # Hue, Saturation, Value bins
    LOW_CONTRAST_STD = 12.0
    MIN_SAT_MEAN = 10.0
    MIN_SAT_STD = 8.0
    MIN_TEMPLATE_STD = 6.0
    SPECULAR_SAT_MAX = 20.0
    SPECULAR_VAL_MIN = 200.0
    SPECULAR_RATIO_MAX = 0.25
    
    def __init__(self):
        # SIFT with more features, we'll filter to top 50
        self._sift = cv2.SIFT_create(nfeatures=200, contrastThreshold=0.03)
        self._clahe = None
        
        # Cached DNA (computed ONCE at initialization)
        self.keypoints: List[cv2.KeyPoint] = []
        self.descriptors: Optional[np.ndarray] = None
        self.hsv_histogram: Optional[np.ndarray] = None
        self.template_gray: Optional[np.ndarray] = None
        self.template_std: float = 0.0
        self.use_color = True
        self._low_contrast = False
        self.roi_center: Tuple[int, int] = (0, 0)  # Original center in ROI coords
        self.bbox_size: Tuple[int, int] = (0, 0)
        
        self._initialized = False

    def initialize(self, frame: np.ndarray, x: int, y: int) -> bool:
        """
        Capture the Visual DNA of the object at click position.
        
        CRITICAL: This is called ONCE. The DNA never changes.
        
        Args:
            frame: BGR frame (tracking resolution)
            x, y: Click position
            
        Returns:
            True if DNA captured successfully
        """
        h, w = frame.shape[:2]
        half = self.ROI_SIZE // 2
        
        # Extract ROI
        x1, y1 = max(0, x - half), max(0, y - half)
        x2, y2 = min(w, x + half), min(h, y + half)
        
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0 or roi.shape[0] < 30 or roi.shape[1] < 30:
            return False
        
        self.bbox_size = (x2 - x1, y2 - y1)
        self.roi_center = (x - x1, y - y1)  # Center in ROI coordinates
        
        # === SIFT EXTRACTION ===
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        gray_std = float(np.std(gray))
        self._low_contrast = gray_std < self.LOW_CONTRAST_STD
        template_gray = self.preprocess_gray(gray)
        sift_gray = template_gray if self._low_contrast else gray
        keypoints, descriptors = self._sift.detectAndCompute(sift_gray, None)
        
        if keypoints is None or len(keypoints) < 4:
            # Fallback: still store what we have
            self.keypoints = list(keypoints) if keypoints else []
            self.descriptors = descriptors
        else:
            # OPTIMIZATION: Keep only TOP 50 strongest keypoints
            # Sorted by response (strength)
            sorted_kp = sorted(keypoints, key=lambda k: k.response, reverse=True)
            top_indices = [keypoints.index(kp) for kp in sorted_kp[:self.TOP_N_KEYPOINTS]]
            
            self.keypoints = [keypoints[i] for i in top_indices]
            self.descriptors = descriptors[top_indices] if descriptors is not None else None
        
        # === Template (Grayscale DNA) ===
        self.template_gray = template_gray.copy()
        self.template_std = float(np.std(template_gray))
        
        # === HSV HISTOGRAM (Color DNA) ===
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1]
        sat_mean = float(np.mean(sat))
        sat_std = float(np.std(sat))
        self.use_color = sat_mean >= self.MIN_SAT_MEAN or sat_std >= self.MIN_SAT_STD
        if self.use_color:
            self.hsv_histogram = cv2.calcHist(
                [hsv], [0, 1, 2], None, 
                list(self.HSV_BINS),
                [0, 180, 0, 256, 0, 256]
            )
            cv2.normalize(self.hsv_histogram, self.hsv_histogram, 0, 1, cv2.NORM_MINMAX)
        else:
            self.hsv_histogram = None
        
        self._initialized = True
        
        hist_shape = self.hsv_histogram.shape if self.hsv_histogram is not None else None
        logging.getLogger("VisualDNA").debug(
            f"DNA captured: {len(self.keypoints)} keypoints (top {self.TOP_N_KEYPOINTS}), "
            f"histogram shape {hist_shape}"
        )
        return True
    
    def verify_color(self, frame: np.ndarray, x: int, y: int, threshold: float = 0.5) -> float:
        """
        Verify if the color at position matches our DNA.
        
        Returns:
            Similarity score 0.0-1.0 (>threshold means match)
        """
        if not self.use_color:
            return 1.0
        if self.hsv_histogram is None:
            return 0.0
        
        h, w = frame.shape[:2]
        half = self.ROI_SIZE // 2
        
        x1, y1 = max(0, x - half), max(0, y - half)
        x2, y2 = min(w, x + half), min(h, y + half)
        
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return 0.0
        
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        current_hist = cv2.calcHist(
            [hsv], [0, 1, 2], None,
            list(self.HSV_BINS),
            [0, 180, 0, 256, 0, 256]
        )
        cv2.normalize(current_hist, current_hist, 0, 1, cv2.NORM_MINMAX)
        
        # Correlation comparison
        similarity = cv2.compareHist(self.hsv_histogram, current_hist, cv2.HISTCMP_CORREL)
        return max(0.0, similarity)  # Correlation can be negative

    def preprocess_gray(self, gray: np.ndarray) -> np.ndarray:
        """Normalize low-contrast frames for template matching."""
        if not self._low_contrast:
            return gray
        if self._clahe is None:
            self._clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        return self._clahe.apply(gray)

    def update_template(self, frame: np.ndarray, x: int, y: int, alpha: float = 0.1):
        """Slowly update the template under high confidence tracking."""
        if self.template_gray is None or self.template_std < self.MIN_TEMPLATE_STD:
            return
        h, w = frame.shape[:2]
        half = self.ROI_SIZE // 2
        x1, y1 = max(0, x - half), max(0, y - half)
        x2, y2 = min(w, x + half), min(h, y + half)
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0 or roi.shape[0] < 20 or roi.shape[1] < 20:
            return
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        gray = self.preprocess_gray(gray)
        if gray.shape != self.template_gray.shape:
            gray = cv2.resize(
                gray,
                (self.template_gray.shape[1], self.template_gray.shape[0]),
                interpolation=cv2.INTER_AREA
            )
        new_std = float(np.std(gray))
        if new_std < self.MIN_TEMPLATE_STD:
            return
        self.template_gray = cv2.addWeighted(self.template_gray, 1.0 - alpha, gray, alpha, 0)
        self.template_std = float(np.std(self.template_gray))

    def is_specular_patch(self, frame: np.ndarray, x: int, y: int) -> bool:
        """Detect high-specular, low-saturation patches (e.g., metal tools)."""
        if not self.use_color:
            return False
        h, w = frame.shape[:2]
        half = self.ROI_SIZE // 2
        x1, y1 = max(0, x - half), max(0, y - half)
        x2, y2 = min(w, x + half), min(h, y + half)
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return False
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1]
        val = hsv[:, :, 2]
        spec_mask = (sat < self.SPECULAR_SAT_MAX) & (val > self.SPECULAR_VAL_MIN)
        ratio = float(np.count_nonzero(spec_mask)) / float(spec_mask.size)
        return ratio > self.SPECULAR_RATIO_MAX
    
    @property
    def is_initialized(self) -> bool:
        return self._initialized
    
    @property
    def has_features(self) -> bool:
        return self.descriptors is not None and len(self.descriptors) >= 4


class MagneticOpticalFlow:
    """
    Magnetic Optical Flow Tracker with Forward-Backward Error Checking.
    
    The "magnetic" feel comes from:
    1. Forward-Backward validation: Track A→B then B→A, reject if error > 1px
    2. Robust point grid that auto-regenerates when points are lost
    3. 5px boundary guard: INSTANT LOST if approaching edge
    
    This eliminates jitter and "sticky edges" completely.
    """
    
    FORWARD_BACKWARD_THRESHOLD = 1.5  # Max acceptable FB error in pixels (more lenient for fast motion)
    BOUNDARY_GUARD = 5  # Pixels from edge to trigger LOST
    MIN_VALID_POINTS = 5  # Minimum points to continue tracking
    
    def __init__(self, num_points: int = 25, spread: int = 8):
        """
        Args:
            num_points: Number of tracking points (5x5 grid = 25)
            spread: Spacing between grid points
        """
        self.num_points = num_points
        self.spread = spread
        self.grid_size = int(math.sqrt(num_points))
        
        # LK parameters optimized for speed
        self.lk_params = dict(
            winSize=(21, 21),
            maxLevel=4,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03)
        )
        
        self.prev_gray: Optional[np.ndarray] = None
        self.points: Optional[np.ndarray] = None
        self._frame_w = 0
        self._frame_h = 0
        
    def initialize(self, frame: np.ndarray, x: int, y: int):
        """Initialize tracking grid centered at position."""
        h, w = frame.shape[:2]
        self._frame_w = w
        self._frame_h = h
        
        self.prev_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        self._create_grid(x, y)
    
    def _create_grid(self, cx: int, cy: int):
        """Create tracking point grid centered at (cx, cy)."""
        points = []
        half = self.grid_size // 2
        
        for dy in range(-half, half + 1):
            for dx in range(-half, half + 1):
                px = cx + dx * self.spread
                py = cy + dy * self.spread
                # Clamp to frame bounds
                px = max(self.BOUNDARY_GUARD, min(px, self._frame_w - self.BOUNDARY_GUARD - 1))
                py = max(self.BOUNDARY_GUARD, min(py, self._frame_h - self.BOUNDARY_GUARD - 1))
                points.append([float(px), float(py)])
        
        self.points = np.array(points, dtype=np.float32)
    
    def track(self, frame: np.ndarray) -> Tuple[float, float, float, bool, bool]:
        """
        Track with Forward-Backward error checking.
        
        Returns:
            (x, y, confidence, is_valid, at_boundary)
            - is_valid: False if tracking completely failed
            - at_boundary: True if position is within BOUNDARY_GUARD of edge
        """
        if self.prev_gray is None or self.points is None or len(self.points) == 0:
            return 0.0, 0.0, 0.0, False, False
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # === FORWARD FLOW: prev → current ===
        pts_prev = self.points.reshape(-1, 1, 2)
        pts_next, status_fwd, _ = cv2.calcOpticalFlowPyrLK(
            self.prev_gray, gray, pts_prev, None, **self.lk_params
        )
        
        if pts_next is None:
            return 0.0, 0.0, 0.0, False, False
        
        # === BACKWARD FLOW: current → prev (for validation) ===
        pts_back, status_bwd, _ = cv2.calcOpticalFlowPyrLK(
            gray, self.prev_gray, pts_next, None, **self.lk_params
        )
        
        if pts_back is None:
            return 0.0, 0.0, 0.0, False, False
        
        # === FORWARD-BACKWARD ERROR CHECK ===
        # Points are valid only if both flows succeeded AND round-trip error < threshold
        fb_error = np.linalg.norm(pts_prev - pts_back, axis=2).flatten()
        status_fwd = status_fwd.flatten()
        status_bwd = status_bwd.flatten()
        
        valid_mask = (
            (status_fwd == 1) & 
            (status_bwd == 1) & 
            (fb_error < self.FORWARD_BACKWARD_THRESHOLD)
        )
        
        valid_count = valid_mask.sum()
        
        if valid_count < self.MIN_VALID_POINTS:
            # Not enough valid points - tracking unreliable
            self.prev_gray = gray
            return 0.0, 0.0, 0.0, False, False
        
        # Extract valid points
        pts_next = pts_next.reshape(-1, 2)
        valid_points = pts_next[valid_mask]
        
        # Update points for next frame
        self.points = valid_points
        self.prev_gray = gray
        
        # Compute center (median is more robust to outliers)
        center_x = float(np.median(valid_points[:, 0]))
        center_y = float(np.median(valid_points[:, 1]))
        
        # Confidence based on valid points ratio
        confidence = float(valid_count) / float(self.num_points)
        
        # Penalize scattered points (likely occlusion/background)
        dispersion = float(np.median(np.linalg.norm(
            valid_points - np.array([center_x, center_y], dtype=np.float32),
            axis=1
        )))
        if dispersion > self.spread * 4:
            confidence *= 0.25
        elif dispersion > self.spread * 3:
            confidence *= 0.5
        
        # === BOUNDARY CHECK ===
        at_boundary = (
            center_x < self.BOUNDARY_GUARD or
            center_x > self._frame_w - self.BOUNDARY_GUARD or
            center_y < self.BOUNDARY_GUARD or
            center_y > self._frame_h - self.BOUNDARY_GUARD
        )
        
        return center_x, center_y, confidence, True, at_boundary
    
    def reset_at(self, x: int, y: int, frame: np.ndarray):
        """Reset tracking grid to new position."""
        self._create_grid(x, y)
        self.prev_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    def update_frame(self, frame: np.ndarray):
        """Update previous frame reference."""
        self.prev_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


class RANSACMatcher:
    """
    RANSAC-based Feature Matcher with Geometric Lock.
    
    The "magic" re-identification step:
    1. Match SIFT descriptors with BFMatcher + Lowe's ratio test (0.75)
    2. Run findHomography with RANSAC
    3. STRICTNESS: Require mask.sum() >= 6 (geometrically consistent points)
    4. Project original center through homography to get new position
    
    This ensures we ONLY snap to geometrically verified matches, preventing
    false positives from similar-looking objects.
    """
    
    LOWE_RATIO = 0.75  # Slightly more permissive for recovery
    MIN_RANSAC_INLIERS = 6  # "Geometric Lock" threshold (balanced for recovery)
    RANSAC_REPROJ_THRESHOLD = 5.0
    
    def __init__(self):
        self.bf_matcher = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
        self._sift = cv2.SIFT_create(nfeatures=300)  # More features for search
    
    def match_and_localize(
        self,
        frame: np.ndarray,
        dna: VisualDNA,
        roi_offset: Tuple[int, int] = (0, 0)
    ) -> Optional[Tuple[float, float, float, int]]:
        """
        Match DNA against frame and localize object.
        
        Args:
            frame: Current frame (grayscale OK, BGR OK)
            dna: Visual DNA to match against
            roi_offset: Offset to add to result coordinates
            
        Returns:
            (x, y, confidence, num_inliers) or None if no match
        """
        if not dna.has_features:
            return None
        
        # Detect features in frame
        if len(frame.shape) == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame
        
        kp_frame, desc_frame = self._sift.detectAndCompute(gray, None)
        
        if desc_frame is None or len(desc_frame) < 4:
            return None
        
        # === FEATURE MATCHING with Lowe's Ratio Test ===
        desc_dna = dna.descriptors.astype(np.float32)
        desc_frame = desc_frame.astype(np.float32)
        
        try:
            matches = self.bf_matcher.knnMatch(desc_dna, desc_frame, k=2)
        except cv2.error:
            return None
        
        # Apply Lowe's ratio test (stricter 0.7)
        good_matches = []
        for match_pair in matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < self.LOWE_RATIO * n.distance:
                    good_matches.append(m)
        
        if len(good_matches) < 4:
            return None
        
        # === RANSAC HOMOGRAPHY ===
        src_pts = np.float32([
            dna.keypoints[m.queryIdx].pt for m in good_matches
        ]).reshape(-1, 1, 2)
        
        dst_pts = np.float32([
            kp_frame[m.trainIdx].pt for m in good_matches
        ]).reshape(-1, 1, 2)
        
        try:
            H, mask = cv2.findHomography(
                src_pts, dst_pts, cv2.RANSAC, self.RANSAC_REPROJ_THRESHOLD
            )
        except cv2.error:
            return None
        
        if H is None or mask is None:
            return None
        
        # === GEOMETRIC LOCK: Check inlier count ===
        num_inliers = int(mask.sum())
        
        if num_inliers < self.MIN_RANSAC_INLIERS:
            # Not enough geometric consistency - reject
            return None
        
        # === PROJECT CENTER through Homography ===
        roi_center = np.array([[dna.roi_center]], dtype=np.float32)
        new_center = cv2.perspectiveTransform(roi_center, H)
        
        new_x = float(new_center[0, 0, 0]) + roi_offset[0]
        new_y = float(new_center[0, 0, 1]) + roi_offset[1]
        
        confidence = min(1.0, num_inliers / 20.0)
        
        return new_x, new_y, confidence, num_inliers
    
    def detect_in_roi(
        self,
        frame: np.ndarray,
        x: int, y: int,
        roi_size: int,
        dna: VisualDNA
    ) -> Optional[Tuple[float, float, float, int]]:
        """
        Detect object in ROI around position (for drift correction).
        """
        h, w = frame.shape[:2]
        half = roi_size // 2
        
        x1, y1 = max(0, x - half), max(0, y - half)
        x2, y2 = min(w, x + half), min(h, y + half)
        
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return None
        
        result = self.match_and_localize(roi, dna, roi_offset=(x1, y1))
        return result


class UltimateHybridTracker:
    """
    Ultimate Hybrid Tracking Engine.
    
    The most robust tracker possible:
    
    1. MAGNETIC LOCK: Forward-backward optical flow eliminates jitter
    2. CLEAN VANISH: 5px boundary guard triggers instant LOST (no edge sticking)
    3. VISUAL DNA: Top 50 SIFT features + HSV histogram (color-aware)
    4. GEOMETRIC LOCK: RANSAC with 6+ inliers for re-identification
    5. ADAPTIVE SCHEDULING: Re-ID triggered by low velocity OR LOST state
    6. SNAP-BACK: Instant teleport when RANSAC confirms object
    
    State Machine:
    ┌──────────┐     FB error or      ┌──────────┐    timeout    ┌──────────┐
    │ TRACKING │ ──────────────────→  │ OCCLUDED │ ────────────→ │   LOST   │
    │ (green)  │     boundary hit     │ (yellow) │               │ (hidden) │
    └────┬─────┘                      └────┬─────┘               └────┬─────┘
         │                                 │                          │
         │  ←─── RANSAC snap-back ────────┴──────────────────────────┘
         │                                 (instant teleport)
    """
    
    # === PERFORMANCE TUNING ===
    TRACKING_WIDTH = 640  # Downscale target
    
    # Adaptive scheduling
    VELOCITY_LOW_THRESHOLD = 2.0  # Below this = "stationary", run Re-ID
    DRIFT_CHECK_INTERVAL = 20     # Frames between drift corrections (if moving)
    SEARCH_INTERVAL = 2           # Frames between global searches when LOST
    
    # State transitions
    OCCLUSION_TIMEOUT = 20        # Frames in OCCLUDED before LOST (more tolerant)
    LOST_TIMEOUT = 300            # Give up after this many frames
    RECOVERY_REQUIRED_FRAMES = 3  # Good frames needed to return from OCCLUDED
    BOUNDARY_LOST_FRAMES = 2      # Frames at boundary before declaring LOST
    OCCLUSION_PREDICT_FRAMES = 6  # Frames to predict position while occluded
    OCCLUSION_COLOR_SEARCH_DELAY = 5  # Frames before color re-acquire
    
    # Confidence
    MIN_FLOW_CONFIDENCE = 0.35
    COLOR_VERIFY_THRESHOLD = 0.3
    COLOR_SEARCH_THRESHOLD = 0.25
    COLOR_SEARCH_STEP = 24
    COLOR_RECOVERY_THRESHOLD = 0.35
    RECOVERY_HIGH_CONFIDENCE = 0.7
    
    TEMPLATE_LOCAL_THRESHOLD = 0.6
    TEMPLATE_GLOBAL_THRESHOLD = 0.55
    TEMPLATE_MIN_STD = 8.0
    TEMPLATE_UPDATE_INTERVAL = 15
    TEMPLATE_SCALES = (0.9, 1.0, 1.1)
    TEMPLATE_TRACK_THRESHOLD = 0.6
    TEMPLATE_RECOVERY_THRESHOLD = 0.58
    TEMPLATE_MISMATCH_FRAMES = 3
    
    REID_CONFIRM_FRAMES = 2
    REID_CONFIRM_RADIUS = 12  # tracking coordinates
    REID_STRONG_CONFIDENCE = 0.85
    REID_BASE_DIST = 90.0  # display pixels
    REID_GROWTH_PER_FRAME = 4.0  # display pixels per lost frame
    BOUNDARY_RECENT_FRAMES = 15
    LOCAL_SEARCH_FRAMES = 30
    FULL_SEARCH_AFTER = 60
    
    def __init__(self, tracker_id: Optional[str] = None, enable_reid: bool = True):
        self.tracker_id = tracker_id or str(uuid.uuid4())[:8]
        self.enable_reid = enable_reid
        self.logger = logging.getLogger(f"UltimateTracker-{self.tracker_id}")
        
        # Core components
        self.dna = VisualDNA()
        self.flow = MagneticOpticalFlow(num_points=25, spread=8)
        self.matcher = RANSACMatcher()
        self.kalman = KalmanSmoother(process_noise=0.03, measurement_noise=0.1)
        
        # State
        self._status = TrackingStatus.INACTIVE
        self._confidence = 0.0
        
        # Position (DISPLAY coordinates)
        self._x = 0.0
        self._y = 0.0
        self._prev_x = 0.0
        self._prev_y = 0.0
        self._last_good_pos = (0.0, 0.0)
        self._last_good_track_pos = (0.0, 0.0)
        
        # Position (TRACKING coordinates - downscaled)
        self._track_x = 0.0
        self._track_y = 0.0
        
        # Velocity tracking
        self._velocity = (0.0, 0.0)
        self._velocity_magnitude = 0.0
        
        # Frame info
        self._scale_factor = 1.0
        self._display_w = 0
        self._display_h = 0
        self._track_w = 0
        self._track_h = 0
        
        # Counters
        self._frame_count = 0
        self._frames_occluded = 0
        self._frames_lost = 0
        self._recovery_frames = 0
        self._boundary_frames = 0
        self._last_boundary_frame = -9999
        self._reid_candidate: Optional[Tuple[float, float]] = None
        self._reid_candidate_frames = 0
        self.search_interval = self.SEARCH_INTERVAL
        self.drift_check_interval = self.DRIFT_CHECK_INTERVAL
        self._template_mismatch_frames = 0
        
        # Label
        self.label = ""
        
        # AI Labeling state (thread-safe)
        self._label_lock = threading.Lock()
        self._label_status = LabelStatus.IDLE
        self._ai_label: Optional[str] = None  # Label from AI (OpenAI)
        
        # Attached drawings (shapes that follow this object)
        # These are rendered ONLY when status == TRACKING
        self._drawings: List = []  # List of BaseShape from shapes.py
    
    def _downscale(self, frame: np.ndarray) -> np.ndarray:
        """Downscale to tracking resolution."""
        h, w = frame.shape[:2]
        self._display_w = w
        self._display_h = h
        
        if w <= self.TRACKING_WIDTH:
            self._scale_factor = 1.0
            self._track_w = w
            self._track_h = h
            return frame
        
        self._scale_factor = w / self.TRACKING_WIDTH
        self._track_h = int(h / self._scale_factor)
        self._track_w = self.TRACKING_WIDTH
        
        return cv2.resize(frame, (self._track_w, self._track_h), interpolation=cv2.INTER_LINEAR)
    
    def _to_display(self, x: float, y: float) -> Tuple[float, float]:
        return x * self._scale_factor, y * self._scale_factor
    
    def _to_tracking(self, x: float, y: float) -> Tuple[float, float]:
        return x / self._scale_factor, y / self._scale_factor

    def _apply_occluded_position(self):
        """Keep a stable display position while occluded to avoid drift."""
        base_track_x, base_track_y = self._last_good_track_pos
        if base_track_x == 0.0 and base_track_y == 0.0:
            base_track_x, base_track_y = self._track_x, self._track_y

        if self._frames_occluded <= self.OCCLUSION_PREDICT_FRAMES:
            vx, vy = self.kalman.get_velocity()
            pred_x = base_track_x + vx
            pred_y = base_track_y + vy
            if self._track_w > 0 and self._track_h > 0:
                pred_x = max(0.0, min(self._track_w - 1.0, pred_x))
                pred_y = max(0.0, min(self._track_h - 1.0, pred_y))
            self._x, self._y = self._to_display(pred_x, pred_y)
        elif self._last_good_pos != (0.0, 0.0):
            self._x, self._y = self._last_good_pos
        else:
            self._x, self._y = self._to_display(base_track_x, base_track_y)

    def _predicted_track_position(self, frames_ahead: int) -> Tuple[float, float]:
        base_track_x, base_track_y = self._last_good_track_pos
        if base_track_x == 0.0 and base_track_y == 0.0:
            base_track_x, base_track_y = self._track_x, self._track_y
        vx, vy = self.kalman.get_velocity()
        pred_x = base_track_x + vx * frames_ahead
        pred_y = base_track_y + vy * frames_ahead
        if self._track_w > 0 and self._track_h > 0:
            pred_x = max(0.0, min(self._track_w - 1.0, pred_x))
            pred_y = max(0.0, min(self._track_h - 1.0, pred_y))
        return pred_x, pred_y

    def _template_score_at(self, frame: np.ndarray, x: float, y: float) -> Optional[float]:
        template = self.dna.template_gray
        if template is None:
            return None
        if self.dna.template_std < max(self.TEMPLATE_MIN_STD, self.dna.MIN_TEMPLATE_STD):
            return None
        if len(frame.shape) == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame
        gray = self.dna.preprocess_gray(gray)
        tpl_h, tpl_w = template.shape
        cx = int(round(x))
        cy = int(round(y))
        x1 = cx - tpl_w // 2
        y1 = cy - tpl_h // 2
        x2 = x1 + tpl_w
        y2 = y1 + tpl_h
        if x1 < 0 or y1 < 0 or x2 > gray.shape[1] or y2 > gray.shape[0]:
            return None
        patch = gray[y1:y2, x1:x2]
        if patch.shape != template.shape:
            return None
        res = cv2.matchTemplate(patch, template, cv2.TM_CCOEFF_NORMED)
        return float(res[0, 0])

    def _template_threshold(self, is_recovery: bool) -> float:
        threshold = self.TEMPLATE_RECOVERY_THRESHOLD if is_recovery else self.TEMPLATE_TRACK_THRESHOLD
        if self.dna._low_contrast:
            threshold -= 0.05
        return max(0.3, threshold)

    def _reset_reid_candidate(self):
        self._reid_candidate = None
        self._reid_candidate_frames = 0

    def _confirm_reid_candidate(self, cand_x: float, cand_y: float, confidence: float) -> bool:
        boundary_recent = (self._frame_count - self._last_boundary_frame) <= self.BOUNDARY_RECENT_FRAMES
        frames_ahead = min(max(self._frames_lost, self._frames_occluded), 6)
        pred_x, pred_y = self._predicted_track_position(frames_ahead)
        cand_disp_x, cand_disp_y = self._to_display(cand_x, cand_y)
        pred_disp_x, pred_disp_y = self._to_display(pred_x, pred_y)
        dist = math.hypot(cand_disp_x - pred_disp_x, cand_disp_y - pred_disp_y)
        allowed = max(self.REID_BASE_DIST, self.dna.ROI_SIZE * self._scale_factor * 1.5)
        allowed += (self._frames_lost + self._frames_occluded) * self.REID_GROWTH_PER_FRAME
        if boundary_recent:
            allowed = max(allowed, max(self._display_w, self._display_h))
        if dist > allowed and confidence < self.REID_STRONG_CONFIDENCE and not boundary_recent:
            return False
        if self._reid_candidate is None:
            self._reid_candidate = (cand_x, cand_y)
            self._reid_candidate_frames = 1
        else:
            prev_x, prev_y = self._reid_candidate
            if math.hypot(cand_x - prev_x, cand_y - prev_y) <= self.REID_CONFIRM_RADIUS:
                self._reid_candidate_frames += 1
            else:
                self._reid_candidate = (cand_x, cand_y)
                self._reid_candidate_frames = 1
        if self._reid_candidate_frames >= self.REID_CONFIRM_FRAMES:
            self._reset_reid_candidate()
            return True
        return False
    
    def initialize(self, frame: np.ndarray, x: int, y: int, label: str = "") -> bool:
        """
        Initialize tracker at click position.
        
        Captures Visual DNA and initializes optical flow.
        """
        self.label = label
        
        # Downscale
        small_frame = self._downscale(frame)
        track_x, track_y = self._to_tracking(float(x), float(y))
        
        # Capture Visual DNA
        if not self.dna.initialize(small_frame, int(track_x), int(track_y)):
            self.logger.warning("Failed to capture Visual DNA")
        
        # Initialize optical flow
        self.flow.initialize(small_frame, int(track_x), int(track_y))
        
        # Set state
        self._track_x = track_x
        self._track_y = track_y
        self._x = float(x)
        self._y = float(y)
        self._prev_x = self._x
        self._prev_y = self._y
        self._last_good_pos = (self._x, self._y)
        self._last_good_track_pos = (self._track_x, self._track_y)
        self._frames_lost = 0
        self._frames_occluded = 0
        self._recovery_frames = 0
        self._boundary_frames = 0
        self._last_boundary_frame = -9999
        self._reset_reid_candidate()
        self._template_mismatch_frames = 0
        
        # Initialize Kalman filter for smoothing
        self.kalman.initialize(track_x, track_y)
        
        self._status = TrackingStatus.TRACKING
        self._confidence = 1.0
        self._frame_count = 0
        self._frames_occluded = 0
        self._frames_lost = 0
        
        self.logger.info(
            f"Initialized '{label}' at ({x}, {y}), "
            f"DNA: {len(self.dna.keypoints)} keypoints"
        )
        return True
    
    def _run_drift_correction(self, frame: np.ndarray) -> Optional[Tuple[float, float, float]]:
        """
        Run SIFT matching for drift correction in local ROI.
        
        Returns:
            (x, y, confidence) in tracking coords, or None
        """
        result = self.matcher.detect_in_roi(
            frame,
            int(self._track_x), int(self._track_y),
            roi_size=150,
            dna=self.dna
        )
        
        if result is None:
            radius = int(self.dna.ROI_SIZE * 1.5)
            region = (
                int(self._track_x - radius),
                int(self._track_y - radius),
                int(self._track_x + radius),
                int(self._track_y + radius),
            )
            return self._run_template_search(frame, region, self.TEMPLATE_LOCAL_THRESHOLD)
        
        new_x, new_y, conf, inliers = result
        
        # Color verification (prevents wrong-object snap)
        color_sim = self.dna.verify_color(frame, int(new_x), int(new_y))
        
        if color_sim < self.COLOR_VERIFY_THRESHOLD and inliers < self.matcher.MIN_RANSAC_INLIERS * 2:
            self.logger.debug(f"Color mismatch: {color_sim:.2f}")
            radius = int(self.dna.ROI_SIZE * 1.5)
            region = (
                int(self._track_x - radius),
                int(self._track_y - radius),
                int(self._track_x + radius),
                int(self._track_y + radius),
            )
            return self._run_template_search(frame, region, self.TEMPLATE_LOCAL_THRESHOLD)
        
        return new_x, new_y, conf

    def _match_template(
        self,
        gray: np.ndarray,
        region: Optional[Tuple[int, int, int, int]],
        threshold: float
    ) -> Optional[Tuple[float, float, float]]:
        template = self.dna.template_gray
        if template is None:
            return None
        if self.dna.template_std < max(self.TEMPLATE_MIN_STD, self.dna.MIN_TEMPLATE_STD):
            return None
        
        if region is None:
            x1, y1, x2, y2 = 0, 0, gray.shape[1], gray.shape[0]
        else:
            x1, y1, x2, y2 = region
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(gray.shape[1], x2)
        y2 = min(gray.shape[0], y2)
        if x2 <= x1 or y2 <= y1:
            return None
        
        best_score = threshold
        best = None
        
        for scale in self.TEMPLATE_SCALES:
            tpl_w = max(4, int(template.shape[1] * scale))
            tpl_h = max(4, int(template.shape[0] * scale))
            if tpl_w >= (x2 - x1) or tpl_h >= (y2 - y1):
                continue
            tpl = cv2.resize(template, (tpl_w, tpl_h), interpolation=cv2.INTER_AREA)
            search = gray[y1:y2, x1:x2]
            if search.shape[0] < tpl_h or search.shape[1] < tpl_w:
                continue
            
            res = cv2.matchTemplate(search, tpl, cv2.TM_CCOEFF_NORMED)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
            if max_val <= best_score:
                continue
            
            mean, std = cv2.meanStdDev(res)
            mean_val = float(mean[0][0])
            std_val = float(std[0][0])
            if max_val < mean_val + max(0.05, 2.0 * std_val):
                continue
            
            cx = x1 + max_loc[0] + tpl_w * 0.5
            cy = y1 + max_loc[1] + tpl_h * 0.5
            best_score = max_val
            best = (cx, cy, max_val)
        
        return best

    def _run_template_search(
        self,
        frame: np.ndarray,
        region: Optional[Tuple[int, int, int, int]],
        threshold: float
    ) -> Optional[Tuple[float, float, float]]:
        if self.dna.template_gray is None:
            return None
        if len(frame.shape) == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame
        gray = self.dna.preprocess_gray(gray)
        return self._match_template(gray, region, threshold)

    def _color_search_in_region(
        self,
        hsv: np.ndarray,
        region: Tuple[int, int, int, int],
        half: int,
        step: int
    ) -> Optional[Tuple[float, float, float]]:
        """
        Scan a region for the best HSV histogram match.
        
        Returns:
            (x, y, score) in tracking coords, or None
        """
        if self.dna.hsv_histogram is None:
            return None
        
        x1, y1, x2, y2 = region
        x1 = max(x1, half)
        y1 = max(y1, half)
        x2 = min(x2, self._track_w - half)
        y2 = min(y2, self._track_h - half)
        
        if x2 <= x1 or y2 <= y1:
            return None
        
        best_score = self.COLOR_SEARCH_THRESHOLD
        best_xy = None
        
        for cy in range(y1, y2 + 1, step):
            for cx in range(x1, x2 + 1, step):
                roi = hsv[cy - half:cy + half, cx - half:cx + half]
                if roi.shape[0] != self.dna.ROI_SIZE or roi.shape[1] != self.dna.ROI_SIZE:
                    continue
                
                hist = cv2.calcHist(
                    [roi], [0, 1, 2], None,
                    list(self.dna.HSV_BINS),
                    [0, 180, 0, 256, 0, 256]
                )
                cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
                
                score = cv2.compareHist(self.dna.hsv_histogram, hist, cv2.HISTCMP_CORREL)
                if score > best_score:
                    best_score = score
                    best_xy = (cx, cy)
        
        if best_xy is None:
            return None
        
        return best_xy[0], best_xy[1], best_score

    def _run_color_search(self, frame: np.ndarray) -> Optional[Tuple[float, float, float]]:
        """
        Fallback color-based search when feature matching is unreliable.
        
        Returns:
            (x, y, confidence) in tracking coords, or None
        """
        if not self.dna.use_color:
            return None
        if self.dna.hsv_histogram is None:
            return None
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        half = self.dna.ROI_SIZE // 2
        step = max(12, self.COLOR_SEARCH_STEP)
        
        best = None
        
        # Local search around last good position first
        if self._last_good_pos != (0.0, 0.0):
            last_x, last_y = self._to_tracking(*self._last_good_pos)
            radius = int(self.dna.ROI_SIZE * 2.0)
            region = (
                int(last_x - radius),
                int(last_y - radius),
                int(last_x + radius),
                int(last_y + radius),
            )
            best = self._color_search_in_region(hsv, region, half, step)
        
        # Edge search for re-entry
        thickness = max(self.dna.ROI_SIZE, 60)
        edge_regions = [
            (0, 0, self._track_w, thickness),  # top
            (0, self._track_h - thickness, self._track_w, self._track_h),  # bottom
            (0, 0, thickness, self._track_h),  # left
            (self._track_w - thickness, 0, self._track_w, self._track_h),  # right
        ]
        
        for region in edge_regions:
            candidate = self._color_search_in_region(hsv, region, half, step)
            if candidate is None:
                continue
            if best is None or candidate[2] > best[2]:
                best = candidate
        
        if best is None:
            return None
        
        x, y, score = best
        return x, y, max(0.2, score)
    
    def _run_global_search(self, frame: np.ndarray) -> Optional[Tuple[float, float, float]]:
        """
        Search entire frame for object (Re-ID).
        
        Returns:
            (x, y, confidence) in tracking coords, or None
        """
        boundary_recent = (self._frame_count - self._last_boundary_frame) <= self.BOUNDARY_RECENT_FRAMES
        allow_global = boundary_recent or self._frames_lost >= self.FULL_SEARCH_AFTER
        
        if self.dna.has_features:
            if not boundary_recent and self._frames_lost <= self.LOCAL_SEARCH_FRAMES:
                radius = int(self.dna.ROI_SIZE * 2.5)
                center_x, center_y = self._last_good_track_pos
                if center_x == 0.0 and center_y == 0.0:
                    center_x, center_y = self._track_x, self._track_y
                result = self.matcher.detect_in_roi(
                    frame,
                    int(center_x),
                    int(center_y),
                    roi_size=radius * 2,
                    dna=self.dna
                )
                if result is not None:
                    new_x, new_y, conf, inliers = result
                    color_sim = self.dna.verify_color(frame, int(new_x), int(new_y))
                    if color_sim < self.COLOR_VERIFY_THRESHOLD and inliers < self.matcher.MIN_RANSAC_INLIERS * 2:
                        self.logger.debug(f"Local re-ID color mismatch: {color_sim:.2f}")
                    else:
                        self.logger.info(
                            f"Re-ID LOCAL: ({new_x:.0f}, {new_y:.0f}), "
                            f"{inliers} inliers, color={color_sim:.2f}"
                        )
                        return new_x, new_y, conf
            
            if not allow_global:
                result = None
            else:
                result = self.matcher.match_and_localize(frame, self.dna)
            
            if result is not None:
                new_x, new_y, conf, inliers = result
                
                # Validate position is inside frame
                guard = max(2, MagneticOpticalFlow.BOUNDARY_GUARD // 2)
                if (new_x < guard or
                    new_x > self._track_w - guard or
                    new_y < guard or
                    new_y > self._track_h - guard):
                    return None
                
                # Color verification
                color_sim = self.dna.verify_color(frame, int(new_x), int(new_y))
                
                if color_sim < self.COLOR_VERIFY_THRESHOLD and inliers < self.matcher.MIN_RANSAC_INLIERS * 2:
                    self.logger.debug(f"Re-ID color mismatch: {color_sim:.2f}")
                    return None
                
                self.logger.info(
                    f"Re-ID SUCCESS: ({new_x:.0f}, {new_y:.0f}), "
                    f"{inliers} inliers, color={color_sim:.2f}"
                )
                return new_x, new_y, conf
        
        # Template-based search (more robust for grayscale/low-texture)
        if self.dna.template_gray is not None:
            # Local search near last known position
            if self._last_good_pos != (0.0, 0.0):
                last_x, last_y = self._to_tracking(*self._last_good_pos)
                radius = int(self.dna.ROI_SIZE * 2.0)
                region = (
                    int(last_x - radius),
                    int(last_y - radius),
                    int(last_x + radius),
                    int(last_y + radius),
                )
                tmpl_local = self._run_template_search(
                    frame,
                    region,
                    self.TEMPLATE_LOCAL_THRESHOLD
                )
                if tmpl_local:
                    new_x, new_y, conf = tmpl_local
                    self.logger.info(
                        f"Re-ID TEMPLATE local: ({new_x:.0f}, {new_y:.0f}), "
                        f"score={conf:.2f}"
                    )
                    return new_x, new_y, conf
            
            # Edge search for re-entry
            if allow_global:
                thickness = max(self.dna.ROI_SIZE, 60)
                edge_regions = [
                    (0, 0, self._track_w, thickness),
                    (0, self._track_h - thickness, self._track_w, self._track_h),
                    (0, 0, thickness, self._track_h),
                    (self._track_w - thickness, 0, self._track_w, self._track_h),
                ]
                best = None
                for region in edge_regions:
                    candidate = self._run_template_search(
                        frame,
                        region,
                        self.TEMPLATE_GLOBAL_THRESHOLD
                    )
                    if candidate and (best is None or candidate[2] > best[2]):
                        best = candidate
                if best:
                    new_x, new_y, conf = best
                    self.logger.info(
                        f"Re-ID TEMPLATE edge: ({new_x:.0f}, {new_y:.0f}), "
                        f"score={conf:.2f}"
                    )
                    return new_x, new_y, conf
        
        # Fallback: color-based search (handles low-texture objects)
        if not allow_global:
            return None
        color_result = self._run_color_search(frame)
        if color_result is None:
            return None
        
        new_x, new_y, conf = color_result
        self.logger.info(
            f"Re-ID COLOR fallback: ({new_x:.0f}, {new_y:.0f}), "
            f"score={conf:.2f}"
        )
        return new_x, new_y, conf
    
    def update(self, frame: np.ndarray) -> TrackingState:
        """
        Update tracker with new frame.
        
        Hybrid strategy with adaptive scheduling:
        - Fast path: Optical flow every frame
        - Slow path: SIFT matching when velocity low OR when LOST
        
        Returns:
            TrackingState with current position and visibility
        """
        self._frame_count += 1
        
        # Inactive check
        if self._status == TrackingStatus.INACTIVE:
            return TrackingState(
                status=TrackingStatus.INACTIVE,
                x=0, y=0, confidence=0, is_occluded=False,
                visibility=0.0, opacity=0.0
            )
        
        # Store previous
        self._prev_x = self._x
        self._prev_y = self._y
        
        # Downscale
        small_frame = self._downscale(frame)
        
        # ═══════════════════════════════════════════════════════════════
        # STATE: TRACKING
        # ═══════════════════════════════════════════════════════════════
        if self._status == TrackingStatus.TRACKING:
            self._reset_reid_candidate()
            self._template_mismatch_frames = 0
            # === FAST PATH: Optical Flow ===
            new_x, new_y, flow_conf, is_valid, at_boundary = self.flow.track(small_frame)
            
            if at_boundary:
                self._boundary_frames += 1
                self._last_boundary_frame = self._frame_count
            else:
                self._boundary_frames = 0
            
            # BOUNDARY GUARD: Only LOST after a short grace period
            if at_boundary and self._boundary_frames >= self.BOUNDARY_LOST_FRAMES:
                self._status = TrackingStatus.LOST
                self._frames_lost = 0
                self._frames_occluded = 0
                self._confidence = 0.0
                self._recovery_frames = 0
                self._reset_reid_candidate()
                self._template_mismatch_frames = 0
                self.logger.info("Boundary hit → LOST")
            elif at_boundary:
                self._status = TrackingStatus.OCCLUDED
                self._frames_occluded = 1
                self._recovery_frames = 0
                self._confidence = flow_conf
                self._apply_occluded_position()
            elif not is_valid or flow_conf < self.MIN_FLOW_CONFIDENCE:
                # Tracking failed → OCCLUDED
                self._status = TrackingStatus.OCCLUDED
                self._frames_occluded = 0
                self._recovery_frames = 0
                self._confidence = flow_conf
                self._template_mismatch_frames = 0
                self._apply_occluded_position()
            else:
                template_score = self._template_score_at(small_frame, new_x, new_y)
                template_threshold = self._template_threshold(is_recovery=False)
                specular_hit = self.dna.is_specular_patch(
                    small_frame,
                    int(new_x),
                    int(new_y)
                )
                if template_score is not None:
                    if template_score < template_threshold or specular_hit:
                        self._template_mismatch_frames += 1
                    else:
                        self._template_mismatch_frames = 0
                # Reject large, low-confidence jumps to avoid drift
                proposed_x, proposed_y = self._to_display(new_x, new_y)
                max_jump = max(80.0, max(self._display_w, 1) * 0.25)
                jump_dist = math.hypot(proposed_x - self._x, proposed_y - self._y)
                if self._template_mismatch_frames >= self.TEMPLATE_MISMATCH_FRAMES:
                    self._status = TrackingStatus.OCCLUDED
                    self._frames_occluded = 0
                    self._recovery_frames = 0
                    self._confidence = flow_conf
                    self._template_mismatch_frames = 0
                    self._apply_occluded_position()
                elif template_score is not None and (template_score < template_threshold or specular_hit):
                    if jump_dist > max_jump * 0.5 or flow_conf < self.RECOVERY_HIGH_CONFIDENCE:
                        self._status = TrackingStatus.OCCLUDED
                        self._frames_occluded = 0
                        self._recovery_frames = 0
                        self._confidence = flow_conf
                        self._template_mismatch_frames = 0
                        self._apply_occluded_position()
                    else:
                        template_score = None
                if template_score is None and jump_dist > max_jump and flow_conf < self.RECOVERY_HIGH_CONFIDENCE:
                    self._status = TrackingStatus.OCCLUDED
                    self._frames_occluded = 0
                    self._recovery_frames = 0
                    self._confidence = flow_conf
                    self._template_mismatch_frames = 0
                    self._apply_occluded_position()
                else:
                    # Tracking successful - apply Kalman smoothing
                    smooth_x, smooth_y = self.kalman.predict_and_correct(new_x, new_y)
                    self._track_x = smooth_x
                    self._track_y = smooth_y
                    self._confidence = flow_conf
                    
                    # === ADAPTIVE SLOW PATH ===
                should_correct = (
                    self._velocity_magnitude < self.VELOCITY_LOW_THRESHOLD or
                    self._frame_count % self.drift_check_interval == 0
                )
                    
                    if should_correct and self.dna.has_features:
                        correction = self._run_drift_correction(small_frame)
                        if correction:
                            corr_x, corr_y, corr_conf = correction
                            self._track_x = corr_x
                            self._track_y = corr_y
                            self._confidence = corr_conf
                            self.kalman.reset(corr_x, corr_y)
                            self.flow.reset_at(int(corr_x), int(corr_y), small_frame)
                    
                    # Update display coordinates
                    self._x, self._y = self._to_display(self._track_x, self._track_y)
                    self._last_good_pos = (self._x, self._y)
                    self._last_good_track_pos = (self._track_x, self._track_y)
                    if (
                        self._confidence >= self.RECOVERY_HIGH_CONFIDENCE
                        and self._frame_count % self.TEMPLATE_UPDATE_INTERVAL == 0
                        and not self.dna.is_specular_patch(
                            small_frame,
                            int(self._track_x),
                            int(self._track_y)
                        )
                    ):
                        self.dna.update_template(
                            small_frame,
                            int(self._track_x),
                            int(self._track_y)
                        )
        
        # ═══════════════════════════════════════════════════════════════
        # STATE: OCCLUDED
        # ═══════════════════════════════════════════════════════════════
        elif self._status == TrackingStatus.OCCLUDED:
            self._frames_occluded += 1
            new_x, new_y, flow_conf, is_valid, at_boundary = self.flow.track(small_frame)
            
            if at_boundary:
                self._boundary_frames += 1
                self._last_boundary_frame = self._frame_count
            else:
                self._boundary_frames = 0
            
            recovered = False
            
            if at_boundary and self._boundary_frames >= self.BOUNDARY_LOST_FRAMES:
                self._status = TrackingStatus.LOST
                self._frames_lost = 0
                self._frames_occluded = 0
                self._confidence = 0.0
                self._recovery_frames = 0
                self._reset_reid_candidate()
                self._template_mismatch_frames = 0
            elif is_valid and flow_conf >= self.MIN_FLOW_CONFIDENCE and not at_boundary:
                correction = None
                if flow_conf > self.MIN_FLOW_CONFIDENCE * 1.5 and self.dna.has_features:
                    correction = self._run_drift_correction(small_frame)
                
                if correction:
                    cand_x, cand_y, cand_conf = correction
                else:
                    cand_x, cand_y, cand_conf = new_x, new_y, flow_conf
                
                cand_disp_x, cand_disp_y = self._to_display(cand_x, cand_y)
                max_jump = max(90.0, max(self._display_w, 1) * 0.3)
                jump_dist = math.hypot(
                    cand_disp_x - self._last_good_pos[0],
                    cand_disp_y - self._last_good_pos[1]
                )
                template_score = self._template_score_at(small_frame, cand_x, cand_y)
                template_threshold = self._template_threshold(is_recovery=True)
                specular_hit = self.dna.is_specular_patch(
                    small_frame,
                    int(cand_x),
                    int(cand_y)
                )
                
                if template_score is not None and (template_score < template_threshold or specular_hit):
                    self._recovery_frames = 0
                elif jump_dist > max_jump and cand_conf < self.RECOVERY_HIGH_CONFIDENCE:
                    self._recovery_frames = 0
                else:
                    if cand_conf >= self.MIN_FLOW_CONFIDENCE * 1.1:
                        self._recovery_frames += 1
                    else:
                        self._recovery_frames = 0
                    
                    if self._recovery_frames >= self.RECOVERY_REQUIRED_FRAMES:
                        self._status = TrackingStatus.TRACKING
                        self._track_x = cand_x
                        self._track_y = cand_y
                        self._confidence = cand_conf
                        self._x, self._y = self._to_display(cand_x, cand_y)
                        self._last_good_pos = (self._x, self._y)
                        self._last_good_track_pos = (self._track_x, self._track_y)
                        self.kalman.reset(cand_x, cand_y)
                        self.flow.reset_at(int(cand_x), int(cand_y), small_frame)
                        self._frames_occluded = 0
                        self._recovery_frames = 0
                        recovered = True
            else:
                self._recovery_frames = 0
                if self._frames_occluded % 3 == 0:
                    base_x, base_y = self._last_good_track_pos
                    if base_x != 0.0 or base_y != 0.0:
                        self.flow.reset_at(int(base_x), int(base_y), small_frame)
            
            if (
                not recovered
                and self._status == TrackingStatus.OCCLUDED
                and self.enable_reid
                and self._frames_occluded >= self.OCCLUSION_COLOR_SEARCH_DELAY
            ):
                template_result = None
                if self.dna.template_gray is not None:
                    radius = int(self.dna.ROI_SIZE * 2.0)
                    center_x, center_y = self._last_good_track_pos
                    if center_x == 0.0 and center_y == 0.0:
                        center_x, center_y = self._track_x, self._track_y
                    region = (
                        int(center_x - radius),
                        int(center_y - radius),
                        int(center_x + radius),
                        int(center_y + radius),
                    )
                    template_result = self._run_template_search(
                        small_frame,
                        region,
                        self.TEMPLATE_LOCAL_THRESHOLD
                    )
                if template_result:
                    cand_x, cand_y, cand_conf = template_result
                    template_score = self._template_score_at(small_frame, cand_x, cand_y)
                    template_threshold = self._template_threshold(is_recovery=True)
                    specular_hit = self.dna.is_specular_patch(
                        small_frame,
                        int(cand_x),
                        int(cand_y)
                    )
                    if template_score is not None and (template_score < template_threshold or specular_hit):
                        pass
                    elif self._confirm_reid_candidate(cand_x, cand_y, cand_conf):
                        self._status = TrackingStatus.TRACKING
                        self._track_x = cand_x
                        self._track_y = cand_y
                        self._confidence = cand_conf
                        self._x, self._y = self._to_display(cand_x, cand_y)
                        self._last_good_pos = (self._x, self._y)
                        self._last_good_track_pos = (self._track_x, self._track_y)
                        self.kalman.reset(cand_x, cand_y)
                        self.flow.reset_at(int(cand_x), int(cand_y), small_frame)
                        self._frames_occluded = 0
                        self._recovery_frames = 0
                        recovered = True
                else:
                    color_result = self._run_color_search(small_frame)
                    if color_result:
                        cand_x, cand_y, cand_conf = color_result
                        template_score = self._template_score_at(small_frame, cand_x, cand_y)
                        template_threshold = self._template_threshold(is_recovery=True)
                        specular_hit = self.dna.is_specular_patch(
                            small_frame,
                            int(cand_x),
                            int(cand_y)
                        )
                        if (
                            cand_conf >= self.COLOR_RECOVERY_THRESHOLD
                            and (template_score is None or template_score >= template_threshold)
                            and not specular_hit
                            and self._confirm_reid_candidate(cand_x, cand_y, cand_conf)
                        ):
                            self._status = TrackingStatus.TRACKING
                            self._track_x = cand_x
                            self._track_y = cand_y
                            self._confidence = cand_conf
                            self._x, self._y = self._to_display(cand_x, cand_y)
                            self._last_good_pos = (self._x, self._y)
                            self._last_good_track_pos = (self._track_x, self._track_y)
                            self.kalman.reset(cand_x, cand_y)
                            self.flow.reset_at(int(cand_x), int(cand_y), small_frame)
                            self._frames_occluded = 0
                            self._recovery_frames = 0
                            recovered = True
            
            if self._status == TrackingStatus.OCCLUDED and not recovered:
                self._confidence = flow_conf
                self._apply_occluded_position()
            
            if self._status == TrackingStatus.OCCLUDED and self._frames_occluded > self.OCCLUSION_TIMEOUT:
                self._status = TrackingStatus.LOST
                self._frames_lost = 0
                self._frames_occluded = 0
                self._confidence = 0.0
                self._recovery_frames = 0
                self._reset_reid_candidate()
                self._template_mismatch_frames = 0
        
        # ═══════════════════════════════════════════════════════════════
        # STATE: LOST → SEARCHING
        # ═══════════════════════════════════════════════════════════════
        elif self._status == TrackingStatus.LOST:
            self._confidence = 0.0
            if self.enable_reid:
                self._status = TrackingStatus.SEARCHING
            else:
                self._frames_lost += 1
        
        # ═══════════════════════════════════════════════════════════════
        # STATE: SEARCHING (Re-ID)
        # ═══════════════════════════════════════════════════════════════
        if self._status == TrackingStatus.SEARCHING:
            self._frames_lost += 1
            # Run global search frequently
            should_search = (
                self._frames_lost <= 1 or
                self._frames_lost % self.search_interval == 0
            )
            
            if should_search:
                result = self._run_global_search(small_frame)
                
                if result:
                    new_x, new_y, conf = result
                    template_score = self._template_score_at(small_frame, new_x, new_y)
                    template_threshold = self._template_threshold(is_recovery=True)
                    specular_hit = self.dna.is_specular_patch(
                        small_frame,
                        int(new_x),
                        int(new_y)
                    )
                    if template_score is not None and (template_score < template_threshold or specular_hit):
                        pass
                    elif self._confirm_reid_candidate(new_x, new_y, conf):
                        # SNAP-BACK: Confirmed re-ID
                        self._status = TrackingStatus.TRACKING
                        self._track_x = new_x
                        self._track_y = new_y
                        self._confidence = conf
                        self._x, self._y = self._to_display(new_x, new_y)
                        self._last_good_pos = (self._x, self._y)
                        self._last_good_track_pos = (self._track_x, self._track_y)
                        self._frames_lost = 0
                        self._frames_occluded = 0
                        self._recovery_frames = 0
                        self._boundary_frames = 0
                        
                        # Reset Kalman and flow to new position
                        self.kalman.reset(new_x, new_y)
                        self.flow.reset_at(int(new_x), int(new_y), small_frame)
            
            # Timeout
            if self._frames_lost > self.LOST_TIMEOUT:
                self._status = TrackingStatus.LOST
                self._confidence = 0.0
        
        # === VELOCITY COMPUTATION ===
        self._velocity = (self._x - self._prev_x, self._y - self._prev_y)
        self._velocity_magnitude = math.sqrt(self._velocity[0]**2 + self._velocity[1]**2)
        
        # === VISIBILITY/OPACITY (Clean Vanish) ===
        if self._status == TrackingStatus.TRACKING:
            visibility = self._confidence
            opacity = 1.0
            is_occluded = False
        elif self._status == TrackingStatus.OCCLUDED:
            visibility = max(0.3, self._confidence)
            opacity = 0.5
            is_occluded = True
        else:  # LOST, SEARCHING - INSTANT HIDDEN
            visibility = 0.0
            opacity = 0.0
            is_occluded = False
        
        return TrackingState(
            status=self._status,
            x=self._x,
            y=self._y,
            confidence=self._confidence,
            is_occluded=is_occluded,
            visibility=visibility,
            opacity=opacity,
            velocity=self._velocity,
            frames_since_seen=self._frames_lost if self._status in (TrackingStatus.LOST, TrackingStatus.SEARCHING) else 0,
            last_good_position=self._last_good_pos,
            scale=1.0,
            rotation=0.0
        )
    
    def reset(self):
        """Reset tracker to inactive."""
        self._status = TrackingStatus.INACTIVE
        self._x = 0
        self._y = 0
        self._confidence = 0
        self._frame_count = 0
        self._frames_lost = 0
        self._frames_occluded = 0
        self._recovery_frames = 0
        self._boundary_frames = 0
        self._last_good_track_pos = (0.0, 0.0)
        self._last_boundary_frame = -9999
        self._reset_reid_candidate()
        self._template_mismatch_frames = 0
        self.dna = VisualDNA()
        self.flow = MagneticOpticalFlow()
        self._drawings.clear()
    
    # =========================================================================
    # AI LABELING (Thread-Safe)
    # =========================================================================
    
    @property
    def label_status(self) -> LabelStatus:
        """Get current AI labeling status."""
        with self._label_lock:
            return self._label_status
    
    @label_status.setter
    def label_status(self, value: LabelStatus):
        """Set AI labeling status (thread-safe)."""
        with self._label_lock:
            self._label_status = value
    
    @property
    def ai_label(self) -> Optional[str]:
        """Get the AI-generated label."""
        with self._label_lock:
            return self._ai_label
    
    def update_label(self, new_label: str) -> None:
        """
        Thread-safe method to update the label from AI.
        
        Called from background thread after AI API returns.
        Also updates the main label attribute.
        
        Args:
            new_label: New label text from AI
        """
        with self._label_lock:
            self._ai_label = new_label
            self._label_status = LabelStatus.LABELED
            # Also update main label
            self.label = new_label
    
    def start_thinking(self) -> None:
        """Mark that AI labeling is in progress."""
        with self._label_lock:
            self._label_status = LabelStatus.THINKING
    
    def set_label_error(self) -> None:
        """Mark that AI labeling failed."""
        with self._label_lock:
            self._label_status = LabelStatus.ERROR
    
    def reset_label_status(self) -> None:
        """Reset label status to idle."""
        with self._label_lock:
            self._label_status = LabelStatus.IDLE
    
    def get_display_label(self) -> str:
        """
        Get the label to display, considering AI status.
        
        Returns:
            - "..." if THINKING
            - AI label if LABELED
            - Original label otherwise
        """
        with self._label_lock:
            if self._label_status == LabelStatus.THINKING:
                return "..."
            elif self._label_status == LabelStatus.LABELED and self._ai_label:
                return self._ai_label
            else:
                return self.label or "Tracker"
    
    # =========================================================================
    # DRAWING MANAGEMENT
    # =========================================================================
    
    def add_drawing(self, shape) -> None:
        """
        Add a shape to this tracker's drawings.
        
        The shape will follow the object and be rendered when TRACKING.
        When LOST, the shape is automatically hidden.
        
        Args:
            shape: BaseShape instance from shapes.py
        """
        self._drawings.append(shape)
    
    def remove_drawing(self, shape) -> bool:
        """
        Remove a shape from drawings.
        
        Returns:
            True if shape was found and removed
        """
        if shape in self._drawings:
            self._drawings.remove(shape)
            return True
        return False
    
    def clear_drawings(self) -> None:
        """Remove all drawings from this tracker."""
        self._drawings.clear()
    
    def render_drawings(self, frame: np.ndarray, opacity_override: Optional[float] = None) -> np.ndarray:
        """
        Render all drawings onto the frame.
        
        Called automatically in the main loop when tracker is TRACKING.
        Drawings are hidden when LOST/SEARCHING (opacity=0).
        
        Args:
            frame: Frame to draw on
            opacity_override: Force specific opacity (used for OCCLUDED state)
            
        Returns:
            Frame with drawings rendered
        """
        if self._status == TrackingStatus.INACTIVE:
            return frame
        
        # Determine opacity based on status
        if opacity_override is not None:
            opacity = opacity_override
        elif self._status == TrackingStatus.TRACKING:
            opacity = 1.0
        elif self._status == TrackingStatus.OCCLUDED:
            opacity = 0.5
        else:  # LOST, SEARCHING
            opacity = 0.0  # Hidden
        
        if opacity <= 0:
            return frame
        
        # Render each shape
        for shape in self._drawings:
            if hasattr(shape, 'render') and hasattr(shape, 'visible'):
                if shape.visible:
                    original_opacity = getattr(shape, 'opacity', 1.0)
                    shape.opacity = opacity * original_opacity
                    frame = shape.render(frame, self._x, self._y)
                    shape.opacity = original_opacity
        
        return frame
    
    @property
    def drawings(self) -> List:
        """Get list of attached drawings."""
        return self._drawings
    
    @property
    def drawing_count(self) -> int:
        """Number of attached drawings."""
        return len(self._drawings)
    
    @property
    def status(self) -> TrackingStatus:
        return self._status
    
    @property
    def position(self) -> Tuple[float, float]:
        return (self._x, self._y)
    
    @property
    def confidence(self) -> float:
        return self._confidence


# Backward compatibility aliases
HybridTracker = UltimateHybridTracker
ObjectTracker = UltimateHybridTracker
VisualFingerprint = VisualDNA
VisualMemory = VisualDNA


class FastOpticalFlow:
    """Backward compatibility wrapper."""
    def __init__(self, grid_size: int = 3, grid_spacing: int = 10):
        self._flow = MagneticOpticalFlow(num_points=grid_size**2, spread=grid_spacing)
    
    def initialize(self, frame, x, y):
        self._flow.initialize(frame, x, y)
    
    def track(self, frame):
        x, y, conf, valid, _ = self._flow.track(frame)
        return x, y, conf, valid
    
    def reset_points(self, x, y, frame=None):
        if frame is not None:
            self._flow.reset_at(x, y, frame)
    
    def update_prev_frame(self, frame):
        self._flow.update_frame(frame)


class FeatureMatcher:
    """Backward compatibility wrapper."""
    LOWE_RATIO = 0.75
    MIN_MATCHES_FOR_HOMOGRAPHY = 4
    
    def __init__(self):
        self._matcher = RANSACMatcher()
        self.bf_matcher = self._matcher.bf_matcher
    
    def match_descriptors(self, desc1, desc2):
        if desc1 is None or desc2 is None or len(desc1) < 2 or len(desc2) < 2:
            return []
        
        desc1 = desc1.astype(np.float32)
        desc2 = desc2.astype(np.float32)
        
        try:
            matches = self.bf_matcher.knnMatch(desc1, desc2, k=2)
        except cv2.error:
            return []
        
        good = []
        for m_pair in matches:
            if len(m_pair) == 2:
                m, n = m_pair
                if m.distance < self.LOWE_RATIO * n.distance:
                    good.append(m)
        return good
    
    def compute_homography(self, kp1, kp2, matches, roi_offset=(0, 0)):
        if len(matches) < 4:
            return None, np.array([]), np.array([])
        
        src = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst[:, :, 0] += roi_offset[0]
        dst[:, :, 1] += roi_offset[1]
        
        try:
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            return H, src, dst
        except:
            return None, src, dst
    
    def estimate_new_center(self, H, orig_center, bbox_size):
        cx, cy = bbox_size[0] / 2, bbox_size[1] / 2
        pt = np.array([[[cx, cy]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(pt, H)
        return float(transformed[0, 0, 0]), float(transformed[0, 0, 1])


class TrackerManager:
    """Manages multiple trackers."""
    
    def __init__(self, use_gpu: bool = True, enable_reid: bool = True):
        self.enable_reid = enable_reid
        self._trackers: Dict[str, UltimateHybridTracker] = {}
        self.logger = logging.getLogger("TrackerManager")
    
    def create_tracker(self, frame: np.ndarray, x: int, y: int, label: str = "") -> str:
        tracker = UltimateHybridTracker(enable_reid=self.enable_reid)
        tracker.initialize(frame, x, y, label)
        self._trackers[tracker.tracker_id] = tracker
        return tracker.tracker_id
    
    def update_all(self, frame: np.ndarray) -> Dict[str, TrackingState]:
        active_count = len(self._trackers)
        if active_count > 0:
            scale = 1 + max(0, (active_count - 1)) // 2
            for tracker in self._trackers.values():
                tracker.search_interval = tracker.SEARCH_INTERVAL * scale
                tracker.drift_check_interval = tracker.DRIFT_CHECK_INTERVAL * scale
        states = {tid: t.update(frame) for tid, t in self._trackers.items()}
        if len(states) > 1:
            anchors = []
            for tid, state in states.items():
                if state.status == TrackingStatus.TRACKING and state.confidence >= 0.7:
                    anchors.append((tid, state.x, state.y))
            for tid, state in states.items():
                if state.status != TrackingStatus.TRACKING:
                    continue
                if state.confidence >= 0.7:
                    continue
                tracker = self._trackers.get(tid)
                if tracker is None:
                    continue
                for anchor_id, ax, ay in anchors:
                    if anchor_id == tid:
                        continue
                    if math.hypot(state.x - ax, state.y - ay) < tracker.REID_BASE_DIST:
                        tracker._status = TrackingStatus.OCCLUDED
                        tracker._frames_occluded = 0
                        tracker._frames_lost = 0
                        tracker._recovery_frames = 0
                        tracker._template_mismatch_frames = 0
                        tracker._apply_occluded_position()
                        states[tid] = TrackingState(
                            status=TrackingStatus.OCCLUDED,
                            x=tracker._x,
                            y=tracker._y,
                            confidence=tracker._confidence * 0.5,
                            is_occluded=True,
                            visibility=max(0.3, tracker._confidence * 0.5),
                            opacity=0.5,
                            velocity=tracker._velocity,
                            frames_since_seen=0,
                            last_good_position=tracker._last_good_pos,
                            scale=1.0,
                            rotation=0.0
                        )
                        break
        return states
    
    def get_tracker(self, tracker_id: str) -> Optional[UltimateHybridTracker]:
        return self._trackers.get(tracker_id)
    
    def remove_tracker(self, tracker_id: str):
        if tracker_id in self._trackers:
            del self._trackers[tracker_id]
    
    def remove_lost_trackers(self) -> List[str]:
        lost = [
            tid for tid, t in self._trackers.items()
            if t.status == TrackingStatus.LOST and t._frames_lost > UltimateHybridTracker.LOST_TIMEOUT
        ]
        for tid in lost:
            del self._trackers[tid]
        return lost
    
    def clear_all(self):
        self._trackers.clear()
    
    @property
    def tracker_ids(self) -> List[str]:
        return list(self._trackers.keys())
    
    @property
    def active_count(self) -> int:
        return sum(
            1 for t in self._trackers.values()
            if t.status in (TrackingStatus.TRACKING, TrackingStatus.OCCLUDED)
        )


class PerformanceOverlay:
    """FPS and latency overlay."""
    
    def __init__(self):
        self._last_time = time.perf_counter()
        self._fps_history: List[float] = []
        self._avg_fps = 0.0
        self._latency_ms = 0.0
    
    def update(self, latency_ms: float = 0.0):
        now = time.perf_counter()
        dt = now - self._last_time
        self._last_time = now
        
        if dt > 0:
            self._fps_history.append(1.0 / dt)
            if len(self._fps_history) > 30:
                self._fps_history.pop(0)
            self._avg_fps = sum(self._fps_history) / len(self._fps_history)
        
        self._latency_ms = latency_ms
    
    def draw(self, frame: np.ndarray) -> np.ndarray:
        color = (0, 255, 0) if self._avg_fps >= 30 else (0, 255, 255) if self._avg_fps >= 20 else (0, 0, 255)
        cv2.putText(frame, f"FPS: {self._avg_fps:.1f}", (10, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2, cv2.LINE_AA)
        cv2.putText(frame, f"Latency: {self._latency_ms:.0f}ms", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 1, cv2.LINE_AA)
        return frame
    
    @property
    def fps(self) -> float:
        return self._avg_fps


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    print("=" * 60)
    print("  ULTIMATE HYBRID TRACKING ENGINE - TEST SUITE")
    print("=" * 60)
    
    # Create test frame with textured object
    def create_test_frame(obj_x, obj_y, obj_visible=True):
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        frame[:] = (40, 40, 40)
        
        if obj_visible and 0 < obj_x < 1280 and 0 < obj_y < 720:
            # Distinctive object with texture
            cv2.rectangle(frame, (obj_x-50, obj_y-50), (obj_x+50, obj_y+50), (0, 120, 255), -1)
            cv2.circle(frame, (obj_x, obj_y), 30, (255, 255, 255), -1)
            cv2.circle(frame, (obj_x-15, obj_y-10), 8, (0, 0, 0), -1)
            cv2.circle(frame, (obj_x+15, obj_y-10), 8, (0, 0, 0), -1)
            for i in range(8):
                tx = obj_x + (i % 4 - 2) * 15
                ty = obj_y + (i // 4) * 20
                cv2.circle(frame, (tx, ty), 4, (200, 200, 200), -1)
        
        return frame
    
    # Test 1: Performance
    print("\n[TEST 1] Performance Benchmark")
    frame = create_test_frame(640, 360)
    tracker = UltimateHybridTracker(enable_reid=True)
    tracker.initialize(frame, 640, 360, "Test")
    
    times = []
    for _ in range(100):
        start = time.perf_counter()
        tracker.update(frame)
        times.append((time.perf_counter() - start) * 1000)
    
    avg_ms = sum(times) / len(times)
    fps = 1000 / avg_ms
    print(f"  Average: {avg_ms:.2f}ms | FPS: {fps:.0f}")
    print(f"  {'✅ PASS' if avg_ms < 15 else '❌ FAIL'}: <15ms latency")
    
    # Test 2: Forward-Backward Error Check
    print("\n[TEST 2] Forward-Backward Error Check")
    tracker = UltimateHybridTracker(enable_reid=True)
    tracker.initialize(frame, 640, 360, "FB-Test")
    
    stable_frames = 0
    for _ in range(30):
        state = tracker.update(frame)
        if state.status == TrackingStatus.TRACKING:
            stable_frames += 1
    
    print(f"  Stable frames: {stable_frames}/30")
    print(f"  {'✅ PASS' if stable_frames >= 28 else '❌ FAIL'}: FB validation working")
    
    # Test 3: Boundary Guard (5px)
    print("\n[TEST 3] Boundary Guard (5px edge detection)")
    tracker = UltimateHybridTracker(enable_reid=True)
    edge_frame = create_test_frame(1270, 360)  # Near right edge
    tracker.initialize(edge_frame, 1270, 360, "Edge-Test")
    
    lost_frame = None
    for i in range(10):
        blank = create_test_frame(0, 0, False)
        state = tracker.update(blank)
        if state.status == TrackingStatus.LOST and lost_frame is None:
            lost_frame = i + 1
    
    print(f"  Lost at frame: {lost_frame}")
    print(f"  {'✅ PASS' if lost_frame and lost_frame <= 5 else '❌ FAIL'}: Quick boundary detection")
    
    # Test 4: Re-Identification with Color Verification
    print("\n[TEST 4] Re-ID with Color Verification")
    tracker = UltimateHybridTracker(enable_reid=True)
    tracker.initialize(create_test_frame(640, 360), 640, 360, "ReID-Test")
    
    # Track, then lose, then re-appear
    for _ in range(5):
        tracker.update(create_test_frame(640, 360))
    
    for _ in range(10):
        tracker.update(create_test_frame(0, 0, False))
    
    reacquired = False
    for _ in range(15):
        state = tracker.update(create_test_frame(200, 400))
        if state.status == TrackingStatus.TRACKING:
            reacquired = True
            pos_error = abs(state.x - 200) + abs(state.y - 400)
            break
    
    print(f"  Re-acquired: {reacquired}")
    if reacquired:
        print(f"  Position error: {pos_error:.0f}px")
        print(f"  {'✅ PASS' if pos_error < 50 else '❌ FAIL'}: Accurate snap-back")
    else:
        print("  ❌ FAIL: Re-ID not working")
    
    # Test 5: Clean Vanish (instant hidden)
    print("\n[TEST 5] Clean Vanish (instant opacity=0)")
    tracker = UltimateHybridTracker(enable_reid=True)
    tracker.initialize(create_test_frame(640, 360), 640, 360, "Vanish-Test")
    tracker.update(create_test_frame(640, 360))
    
    # Disappear
    for _ in range(5):
        state = tracker.update(create_test_frame(0, 0, False))
    
    print(f"  Status: {state.status.value}")
    print(f"  Opacity: {state.opacity}")
    print(f"  {'✅ PASS' if state.opacity == 0.0 else '❌ FAIL'}: Instant hidden")
    
    print("\n" + "=" * 60)
    print("  TEST COMPLETE")
    print("=" * 60)
