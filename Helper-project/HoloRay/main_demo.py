#!/usr/bin/env python3
"""
HoloRay Engine - Proof of Concept Demo

Demonstrates the tracking and annotation capabilities:
1. Opens webcam feed
2. User clicks on objects to track them
3. Labels stick to objects through movement
4. Labels fade when objects are occluded (hand in front)
5. Labels reappear when objects re-enter frame
6. AI-powered object identification with OpenAI

Usage:
    python main_demo.py

Controls:
    - LEFT CLICK: Add tracker (label) or draw (when draw mode is on)
    - During label input:
        - Type label manually, OR
        - Press '*' to auto-identify with AI (OpenAI)
        - Press ENTER to confirm
        - Press ESC to cancel
    - RIGHT CLICK: Remove nearest tracker
    - D: Toggle draw mode
    - P: Pause/resume playback (video files only)
    - SHIFT (hold): Snap drawing to detected edges
    - C: Clear drawings
    - U: Undo last stroke
    - R: Reset all trackers
    - S: Cycle annotation styles
    - Q/ESC: Quit

Note: Press '*' during label input to trigger AI identification.

This is NOT the chess game - it's a generic tracking demo
that proves the HoloRay engine works for the VR Chess team.
"""

import sys
import time
import logging
import argparse
import threading
from typing import Optional

import cv2  # pyright: ignore[reportMissingImports]
import numpy as np  # pyright: ignore[reportMissingImports]

# Add src to path
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from holoray.video_pipeline import ThreadedVideoCapture, VideoFileReader
from holoray.holoray_core import TrackerManager, TrackingStatus, LabelStatus
from holoray.annotation_layer import AnnotationRenderer, AnnotationStyle, ColorScheme
from holoray.ai_labeler import AILabeler

# Default labels for demo (simulating chess pieces)
DEMO_LABELS = [
    "Object"
]

VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".webm", ".mpeg", ".mpg"
}


class HoloRayDemo:
    """
    Interactive demo of the HoloRay Tracking & Annotation Engine.
    """

    WINDOW_NAME = "HoloRay Engine Demo"

    def __init__(
            self,
            source: int | str = 0,
            use_gpu: bool = True,
            enable_reid: bool = True,
            resolution: tuple = None,
            style: AnnotationStyle = AnnotationStyle.STANDARD,
            loop: bool = False
    ):
        """
        Initialize demo.

        Args:
            source: Camera index or video file path
            use_gpu: Use GPU acceleration if available
            enable_reid: Enable re-identification
            resolution: Target resolution (width, height)
            style: Default annotation style
        """
        self.source = source
        self.use_gpu = use_gpu
        self.enable_reid = enable_reid
        self.resolution = resolution
        self.current_style = style
        self.loop = loop

        # Components
        self.video = None
        self.tracker_manager = None
        self.renderer = None
        self.ai_labeler = AILabeler()  # OpenAI-powered object identification

        # State
        self._running = False
        self._label_index = 0
        self._right_click_position = None
        self._last_frame: Optional[np.ndarray] = None  # For AI labeling

        # Label input state
        self._awaiting_label = False
        self._label_buffer = ""
        self._pending_place = None
        self._pending_tracker_id = None
        self._pending_original_label = None

        # Label input state
        self._awaiting_label = False
        # self._pending_click = None  # (x, y)
        self._label_buffer = ""
        self._pending_place = None
        self._pending_tracker_id = None
        self._pending_original_label = None

        # Drawing state
        self._draw_mode = False
        self._drawing_active = False
        self._current_stroke = []
        self._strokes = []
        self._last_draw_point = None
        self._pending_stroke = None
        self._pending_stroke_idx = None  # For label input on drawings
        self._shift_down = False
        self._stroke_palette = [
            (0, 200, 255),
            (255, 200, 0),
            (120, 255, 120),
            (255, 120, 120),
            (180, 120, 255),
            (255, 160, 60),
            (60, 220, 180),
            (240, 120, 200),
        ]
        self._stroke_color_idx = 0
        self._current_stroke_color = self._stroke_palette[0]
        self._stroke_thickness = 2
        # Tracker color palette (aligned with drawing palette)
        self._tracker_palette = self._stroke_palette
        self._tracker_color_idx = 0

        self.logger = logging.getLogger("HoloRayDemo")

    def _get_next_label(self) -> str:
        """Get next label from rotation."""
        label = DEMO_LABELS[self._label_index % len(DEMO_LABELS)]
        self._label_index += 1
        return label

    def _mouse_callback(self, event, x, y, flags, param):
        self._shift_down = bool(flags & cv2.EVENT_FLAG_SHIFTKEY)

        if event == cv2.EVENT_LBUTTONDOWN:
            # If we are already naming a just-placed tracker, ignore new placements.
            if self._awaiting_label:
                return
            if self._draw_mode:
                self._drawing_active = True
                self._current_stroke = [(x, y)]
                self._current_stroke_color = self._stroke_palette[self._stroke_color_idx]
                self._stroke_color_idx = (self._stroke_color_idx + 1) % len(self._stroke_palette)
                self._last_draw_point = (x, y)
                return

            # Request placement; actual creation happens in the main loop using a valid frame.
            self._pending_place = (x, y)
            self._awaiting_label = True
            self._label_buffer = ""
            self._pending_tracker_id = None
            self._pending_original_label = None

        elif event == cv2.EVENT_MOUSEMOVE:
            if self._draw_mode and self._drawing_active:
                if self._last_draw_point is None:
                    self._last_draw_point = (x, y)
                    self._current_stroke.append((x, y))
                    return
                dx = x - self._last_draw_point[0]
                dy = y - self._last_draw_point[1]
                if (dx * dx + dy * dy) >= 4:
                    self._current_stroke.append((x, y))
                    self._last_draw_point = (x, y)

        elif event == cv2.EVENT_LBUTTONUP:
            if self._draw_mode and self._drawing_active:
                if len(self._current_stroke) > 1:
                    self._pending_stroke = {
                        "points": self._current_stroke[:],
                        "snap": self._shift_down,
                        "color": self._current_stroke_color,
                    }
                self._current_stroke = []
                self._drawing_active = False
                self._last_draw_point = None
                return

        elif event == cv2.EVENT_RBUTTONDOWN:
            # Ignore and clear right-clicks while typing/naming to avoid stale deletes.
            if self._awaiting_label:
                self._right_click_position = None
                return
            if self._draw_mode:
                self._right_click_position = None
                return
            self._right_click_position = (x, y)

    # Naming trackers:

    def _commit_label(self, frame: np.ndarray):
        if not self._awaiting_label:
            return

        # If the tracker hasn't been created yet (very fast Enter), just ignore.
        if self._pending_tracker_id is None:
            return

        label = self._label_buffer.strip()
        if not label:
            label = self._pending_original_label or self._get_next_label()

        # Update tracker label (backend)
        tracker = self.tracker_manager.get_tracker(self._pending_tracker_id)
        if tracker is not None:
            tracker.label = label

        # Update annotation label (frontend)
        ann = self.renderer._annotations.get(self._pending_tracker_id)
        if ann is not None:
            ann.label_text = label
        
        # Update stroke label if this is a drawing
        if self._pending_stroke_idx is not None and 0 <= self._pending_stroke_idx < len(self._strokes):
            self._strokes[self._pending_stroke_idx]["label"] = label

        self.logger.info(f"Renamed tracker {self._pending_tracker_id} to '{label}'")

        # Exit naming mode
        self._awaiting_label = False
        self._pending_tracker_id = None
        self._pending_original_label = None
        self._pending_stroke_idx = None
        self._label_buffer = ""

    def _cancel_label(self):
        # If a tracker was already created for this naming session, remove it.
        if self._pending_tracker_id is not None:
            self.tracker_manager.remove_tracker(self._pending_tracker_id)
            self.renderer.remove_annotation(self._pending_tracker_id)
            self.logger.info(f"Canceled label entry — removed tracker {self._pending_tracker_id}")
        
        # If this was a drawing, remove the stroke as well
        if self._pending_stroke_idx is not None and 0 <= self._pending_stroke_idx < len(self._strokes):
            self._strokes.pop(self._pending_stroke_idx)
            self.logger.info("Canceled drawing label — removed stroke")

        # Also cancel any pending placement request not yet created
        self._pending_place = None

        self._awaiting_label = False
        self._pending_tracker_id = None
        self._pending_original_label = None
        self._pending_stroke_idx = None
        self._label_buffer = ""

    def _handle_key(self, key: int, frame: np.ndarray):
        if key == -1 or key == 255:
            return

        if self._awaiting_label:
            if key in (13, 10):  # Enter
                self._commit_label(frame)
            elif key in (27,):  # ESC
                self._cancel_label()
            elif key == ord('*'):  # '*' = AI Identify
                self._identify_pending_tracker()
            elif key in (8, 127):  # Backspace / Delete
                self._label_buffer = self._label_buffer[:-1]
            elif 32 <= key <= 126 and len(self._label_buffer) < 50:
                self._label_buffer += chr(key)
            return

        if key == ord('q') or key == 27:
            self._running = False
        elif key == ord('d'):
            self._draw_mode = not self._draw_mode
            if not self._draw_mode and self._drawing_active:
                if len(self._current_stroke) > 1:
                    self._pending_stroke = {
                        "points": self._current_stroke[:],
                        "snap": False,
                        "color": self._current_stroke_color,
                    }
                self._current_stroke = []
                self._drawing_active = False
                self._last_draw_point = None
            self.logger.info(f"Draw mode {'enabled' if self._draw_mode else 'disabled'}")
        elif key == ord('c'):
            self._strokes = []
            self._current_stroke = []
            self._drawing_active = False
            self._last_draw_point = None
            self._pending_stroke = None
            self.logger.info("Cleared drawings")
        elif key == ord('u'):
            if self._strokes:
                self._strokes.pop()
                self.logger.info("Undid last stroke")
        elif key == ord('r'):
            self._reset_all()
        elif key == ord('s'):
            self._cycle_style()
        elif key == ord('*'):
            self._identify_nearest_tracker()

    def _handle_right_click(self):
        """Handle right click - remove nearest tracker."""
        if self._awaiting_label:
            self._right_click_position = None
            return

        if self._right_click_position is None:
            return

        x, y = self._right_click_position
        self._right_click_position = None

        # Find nearest tracker
        min_dist = float('inf')
        nearest_id = None

        for tracker_id in self.tracker_manager.tracker_ids:
            tracker = self.tracker_manager.get_tracker(tracker_id)
            if tracker:
                tx, ty = tracker.position
                dist = ((tx - x) ** 2 + (ty - y) ** 2) ** 0.5
                if dist < min_dist:
                    min_dist = dist
                    nearest_id = tracker_id

        if nearest_id and min_dist < 100:  # Within 100 pixels
            self.tracker_manager.remove_tracker(nearest_id)
            self.renderer.remove_annotation(nearest_id)
            self._strokes = [
                stroke for stroke in self._strokes
                if stroke.get("tracker_id") != nearest_id
            ]
            self.logger.info(f"Removed tracker {nearest_id}")

    def _cycle_style(self):
        """Cycle through annotation styles."""
        styles = list(AnnotationStyle)
        current_idx = styles.index(self.current_style)
        self.current_style = styles[(current_idx + 1) % len(styles)]
        self.logger.info(f"Switched to style: {self.current_style.value}")

        # Update all annotations
        for tracker_id in self.tracker_manager.tracker_ids:
            if tracker_id in self.renderer._annotations:
                self.renderer._annotations[tracker_id].style = self.current_style

    def _reset_all(self):
        """Reset all trackers."""
        for tracker_id in list(self.tracker_manager.tracker_ids):
            self.tracker_manager.remove_tracker(tracker_id)
            self.renderer.remove_annotation(tracker_id)
        self._label_index = 0
        self._strokes = []
        self._current_stroke = []
        self._pending_stroke = None
        self._pending_stroke_idx = None
        self._drawing_active = False
        self._last_draw_point = None
        self._awaiting_label = False
        self._pending_tracker_id = None
        self._label_buffer = ""
        self.logger.info("All trackers reset")

    def _identify_pending_tracker(self):
        """
        Use AI (OpenAI) to identify the tracker being created (during label input).
        
        Called when user presses '*' while typing a label.
        """
        if self._pending_tracker_id is None:
            print("[AI] ⚠️ No pending tracker to identify")
            return
        
        if self._last_frame is None:
            print("[AI] ⚠️ No frame available")
            return
        
        tracker = self.tracker_manager.get_tracker(self._pending_tracker_id)
        if tracker is None:
            print("[AI] ⚠️ Tracker not found")
            return
        
        # Check if AI is available
        if not self.ai_labeler.is_available():
            print("[AI] ❌ AI not available - check OPENAI_API_KEY")
            self.logger.warning("AI labeling not available (check OPENAI_API_KEY)")
            return
        
        print(f"[AI] 🤖 Calling OpenAI to identify object at ({tracker.position[0]:.0f}, {tracker.position[1]:.0f})...")
        
        # Update UI to show thinking
        self._label_buffer = "..."
        ann = self.renderer._annotations.get(self._pending_tracker_id)
        if ann:
            ann.label_text = "..."
        
        # Mark tracker as thinking
        tracker.start_thinking()
        
        # Get position and frame copy
        tx, ty = tracker.position
        frame_copy = self._last_frame.copy()
        tracker_id = self._pending_tracker_id
        
        # Capture stroke index for closure
        stroke_idx = self._pending_stroke_idx
        
        def worker():
            """Background thread worker for AI identification."""
            try:
                print(f"[AI] 📤 Sending image crop to OpenAI...")
                label = self.ai_labeler.identify_object(
                    frame_copy, 
                    int(tx), 
                    int(ty),
                    crop_size=200
                )
                
                print(f"[AI] ✅ OpenAI response: \"{label}\"")
                
                # Update tracker
                tracker.update_label(label)
                
                # Update label buffer so user sees the result
                self._label_buffer = label
                
                # Update annotation
                ann = self.renderer._annotations.get(tracker_id)
                if ann:
                    ann.label_text = label
                
                # Update stroke label if this is a drawing
                if stroke_idx is not None and 0 <= stroke_idx < len(self._strokes):
                    self._strokes[stroke_idx]["label"] = label
                
                self.logger.info(f"AI Identified: {label}")
                
            except Exception as e:
                print(f"[AI] ❌ Error: {e}")
                self.logger.error(f"AI identification failed: {e}")
                tracker.set_label_error()
                self._label_buffer = "Error"
        
        # Launch daemon thread
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

    def _identify_nearest_tracker(self):
        """
        Use AI (OpenAI) to identify the nearest tracked object OR drawing.
        
        Runs in a background thread to avoid blocking the video feed.
        Works for both point trackers and freehand drawings.
        """
        if self._awaiting_label:
            return
        
        if self._last_frame is None:
            return
        
        h, w = self._last_frame.shape[:2]
        center_x, center_y = w / 2, h / 2
        
        # Find nearest active tracker
        nearest_tracker_id = None
        nearest_tracker_dist = float('inf')
        
        for tracker_id in self.tracker_manager.tracker_ids:
            tracker = self.tracker_manager.get_tracker(tracker_id)
            if tracker and tracker.status == TrackingStatus.TRACKING:
                # Check if not already thinking
                if tracker.label_status == LabelStatus.THINKING:
                    continue
                tx, ty = tracker.position
                dist = ((tx - center_x) ** 2 + (ty - center_y) ** 2) ** 0.5
                if dist < nearest_tracker_dist:
                    nearest_tracker_dist = dist
                    nearest_tracker_id = tracker_id
        
        # Find nearest visible stroke/drawing
        nearest_stroke_idx = None
        nearest_stroke_dist = float('inf')
        
        for idx, stroke in enumerate(self._strokes):
            if not stroke.get("visible", True):
                continue
            # Get stroke centroid
            stroke_cx, stroke_cy = self._stroke_centroid(stroke.get("points", []))
            dist = ((stroke_cx - center_x) ** 2 + (stroke_cy - center_y) ** 2) ** 0.5
            if dist < nearest_stroke_dist:
                nearest_stroke_dist = dist
                nearest_stroke_idx = idx
        
        # Decide which to identify (prefer tracker if both are close)
        if nearest_tracker_id is not None and nearest_tracker_dist <= nearest_stroke_dist:
            self._identify_tracker(nearest_tracker_id)
        elif nearest_stroke_idx is not None:
            self._identify_stroke(nearest_stroke_idx)
        else:
            self.logger.info("No active tracker or stroke to identify")
    
    def _identify_tracker(self, tracker_id: str):
        """Identify a specific tracker using AI."""
        tracker = self.tracker_manager.get_tracker(tracker_id)
        if tracker is None:
            return
        
        # Check if AI is available
        if not self.ai_labeler.is_available():
            self.logger.warning("AI labeling not available (check OPENAI_API_KEY)")
            return
        
        # Mark as thinking
        tracker.start_thinking()
        self.logger.info(f"Identifying tracker {tracker_id}...")
        
        # Update annotation to show thinking indicator
        ann = self.renderer._annotations.get(tracker_id)
        if ann:
            ann.label_text = "..."
        
        # Get position and frame copy
        tx, ty = tracker.position
        frame_copy = self._last_frame.copy()
        
        def worker():
            """Background thread worker for AI identification."""
            try:
                label = self.ai_labeler.identify_object(
                    frame_copy, 
                    int(tx), 
                    int(ty),
                    crop_size=200
                )
                tracker.update_label(label)
                
                # Also update annotation
                ann = self.renderer._annotations.get(tracker_id)
                if ann:
                    ann.label_text = label
                
                self.logger.info(f"Identified tracker: {label}")
                
            except Exception as e:
                self.logger.error(f"AI identification failed: {e}")
                tracker.set_label_error()
                # Restore original label on error
                ann = self.renderer._annotations.get(tracker_id)
                if ann:
                    ann.label_text = tracker.label or "Unknown"
        
        # Launch daemon thread
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
    
    def _identify_stroke(self, stroke_idx: int):
        """Identify a specific stroke/drawing using AI."""
        if stroke_idx < 0 or stroke_idx >= len(self._strokes):
            return
        
        stroke = self._strokes[stroke_idx]
        
        # Check if AI is available
        if not self.ai_labeler.is_available():
            self.logger.warning("AI labeling not available (check OPENAI_API_KEY)")
            return
        
        # Get stroke centroid for cropping
        points = stroke.get("points", [])
        if not points:
            return
        
        cx, cy = self._stroke_centroid(points)
        self.logger.info(f"Identifying stroke {stroke_idx} at ({cx:.0f}, {cy:.0f})...")
        
        # Show thinking indicator
        stroke["label"] = "..."
        
        frame_copy = self._last_frame.copy()
        
        def worker():
            """Background thread worker for AI identification."""
            try:
                label = self.ai_labeler.identify_object(
                    frame_copy, 
                    int(cx), 
                    int(cy),
                    crop_size=200
                )
                
                # Update stroke label
                stroke["label"] = label
                self.logger.info(f"Identified stroke: {label}")
                
            except Exception as e:
                self.logger.error(f"AI identification failed: {e}")
                stroke["label"] = ""  # Clear on error
        
        # Launch daemon thread
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

    def _maybe_place_tracker(self, frame: np.ndarray):
        """
        If the user clicked to place a tracker, create it now using the current valid frame.
        This is intentionally done in the main loop (not in the mouse callback) to avoid
        thread/frame races.
        """
        if self._pending_place is None:
            return

        if frame is None:
            # If frame is invalid, defer placement.
            return

        x, y = self._pending_place
        self._pending_place = None

        # Create tracker immediately with a default label
        default_label = self._get_next_label()

        tracker_id = self.tracker_manager.create_tracker(
            frame, x, y, label=default_label
        )

        color = self._tracker_palette[self._tracker_color_idx]
        self._tracker_color_idx = (self._tracker_color_idx + 1) % len(self._tracker_palette)
        self.renderer.create_annotation(
            tracker_id=tracker_id,
            label=default_label,
            x=x, y=y,
            style=self.current_style,
            color_scheme=ColorScheme(primary=color)
        )

        self._pending_tracker_id = tracker_id
        self._pending_original_label = default_label

        self.logger.info(f"Placed tracker '{default_label}' at ({x}, {y}) — awaiting rename")

    def _stroke_closed(self, points: list[tuple[int, int]], threshold: float = 20.0) -> bool:
        if len(points) < 3:
            return False
        dx = points[0][0] - points[-1][0]
        dy = points[0][1] - points[-1][1]
        return (dx * dx + dy * dy) <= (threshold * threshold)

    def _point_line_distance(self, point, start, end) -> float:
        px, py = point
        sx, sy = start
        ex, ey = end
        dx = ex - sx
        dy = ey - sy
        if dx == 0 and dy == 0:
            return ((px - sx) ** 2 + (py - sy) ** 2) ** 0.5
        t = ((px - sx) * dx + (py - sy) * dy) / float(dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        proj_x = sx + t * dx
        proj_y = sy + t * dy
        return ((px - proj_x) ** 2 + (py - proj_y) ** 2) ** 0.5

    def _rdp(self, points: list[tuple[int, int]], epsilon: float) -> list[tuple[int, int]]:
        if len(points) < 3:
            return points[:]
        start = points[0]
        end = points[-1]
        max_dist = 0.0
        index = 0
        for i in range(1, len(points) - 1):
            dist = self._point_line_distance(points[i], start, end)
            if dist > max_dist:
                max_dist = dist
                index = i
        if max_dist > epsilon:
            left = self._rdp(points[:index + 1], epsilon)
            right = self._rdp(points[index:], epsilon)
            return left[:-1] + right
        return [start, end]

    def _simplify_stroke(self, points: list[tuple[int, int]], epsilon: float = 2.5) -> list[tuple[int, int]]:
        if len(points) < 3:
            return points[:]
        return self._rdp(points, epsilon)

    def _ellipse_points(self, center: tuple[float, float], axes: tuple[float, float], angle_deg: float, samples: int = 40):
        cx, cy = center
        ax, ay = axes
        theta = np.deg2rad(angle_deg)
        cos_t = np.cos(theta)
        sin_t = np.sin(theta)
        pts = []
        for i in range(samples):
            t = 2 * np.pi * (i / samples)
            x = ax * np.cos(t)
            y = ay * np.sin(t)
            rx = x * cos_t - y * sin_t
            ry = x * sin_t + y * cos_t
            pts.append((int(cx + rx), int(cy + ry)))
        return pts

    def _shape_from_points(self, points: list[tuple[int, int]]) -> dict:
        if len(points) < 2:
            return {"points": points, "closed": False}

        pts = np.array(points, dtype=np.int32)
        if pts.shape[0] < 3:
            return {"points": points, "closed": False}

        hull = cv2.convexHull(pts)
        hull_area = max(1.0, cv2.contourArea(hull))
        peri = max(1.0, cv2.arcLength(hull, True))
        circularity = (4 * np.pi * hull_area) / (peri * peri)

        approx = cv2.approxPolyDP(hull, 0.02 * peri, True)
        if len(approx) == 3:
            tri = [(int(p[0][0]), int(p[0][1])) for p in approx]
            return {"points": tri, "closed": True}
        if len(approx) == 4:
            rect = cv2.minAreaRect(pts.astype(np.float32))
            box = cv2.boxPoints(rect)
            box_pts = [(int(p[0]), int(p[1])) for p in box]
            return {"points": box_pts, "closed": True}

        # Circle / oval
        if circularity > 0.8:
            (cx, cy), radius = cv2.minEnclosingCircle(pts.astype(np.float32))
            if radius <= 18:
                line_pts = [
                    (int(cx - radius), int(cy)),
                    (int(cx + radius), int(cy)),
                ]
                return {"points": line_pts, "closed": False}
            circle_pts = self._ellipse_points((cx, cy), (radius, radius), 0.0, samples=50)
            return {"points": circle_pts, "closed": True}

        if len(pts) >= 5:
            ellipse = cv2.fitEllipse(pts.astype(np.float32))
            (cx, cy), (ma, mi), angle = ellipse
            major = max(ma, mi)
            minor = max(1.0, min(ma, mi))
            if major / minor > 3.0 and major <= 120:
                ang = np.deg2rad(angle)
                dx = (major / 2.0) * np.cos(ang)
                dy = (major / 2.0) * np.sin(ang)
                line_pts = [
                    (int(cx - dx), int(cy - dy)),
                    (int(cx + dx), int(cy + dy)),
                ]
                return {"points": line_pts, "closed": False}
            ellipse_pts = self._ellipse_points((cx, cy), (ma / 2.0, mi / 2.0), angle, samples=60)
            return {"points": ellipse_pts, "closed": True}

        # Long thin: line
        rect = cv2.minAreaRect(pts.astype(np.float32))
        (cx, cy), (w, h), angle = rect
        long_side = max(w, h)
        short_side = max(1.0, min(w, h))
        if long_side / short_side > 3.0:
            line_len = long_side
            line_angle = np.deg2rad(angle)
            dx = (line_len / 2.0) * np.cos(line_angle)
            dy = (line_len / 2.0) * np.sin(line_angle)
            line_pts = [
                (int(cx - dx), int(cy - dy)),
                (int(cx + dx), int(cy + dy)),
            ]
            return {"points": line_pts, "closed": False}

        # Convex hull fallback
        hull_pts = [(int(p[0][0]), int(p[0][1])) for p in hull]
        return {"points": hull_pts, "closed": True}

    def _stroke_centroid(self, points: list[tuple[int, int]]) -> tuple[float, float]:
        if not points:
            return 0.0, 0.0
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return float(sum(xs)) / len(xs), float(sum(ys)) / len(ys)

    def _compute_hsv_signature(self, frame: np.ndarray, points: list[tuple[int, int]], closed: bool):
        if frame is None or not points:
            return None

        x, y, w, h = cv2.boundingRect(np.array(points, dtype=np.int32))
        if w == 0 or h == 0:
            return None
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(frame.shape[1], x + w)
        y2 = min(frame.shape[0], y + h)
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return None

        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        if closed:
            mask = np.zeros((y2 - y1, x2 - x1), dtype=np.uint8)
            shifted = [(px - x1, py - y1) for px, py in points]
            cv2.fillPoly(mask, [np.array(shifted, dtype=np.int32)], 255)
            mean = cv2.mean(hsv, mask=mask)
            area = float(cv2.countNonZero(mask))
        else:
            mean = cv2.mean(hsv)
            area = float(w * h)
        aspect = float(w) / max(1.0, float(h))
        return (mean[0], mean[1], mean[2]), (w, h), area, aspect

    def _hsv_mask(self, hsv: np.ndarray, mean_hsv, tolerances):
        h, s, v = mean_hsv
        h_tol, s_tol, v_tol = tolerances
        lower_h = int(h - h_tol)
        upper_h = int(h + h_tol)
        lower_s = max(0, int(s - s_tol))
        upper_s = min(255, int(s + s_tol))
        lower_v = max(0, int(v - v_tol))
        upper_v = min(255, int(v + v_tol))

        if lower_h < 0 or upper_h > 179:
            lower1 = (lower_h % 180, lower_s, lower_v)
            upper1 = (179, upper_s, upper_v)
            lower2 = (0, lower_s, lower_v)
            upper2 = (upper_h % 180, upper_s, upper_v)
            mask1 = cv2.inRange(hsv, lower1, upper1)
            mask2 = cv2.inRange(hsv, lower2, upper2)
            return cv2.bitwise_or(mask1, mask2)
        return cv2.inRange(hsv, (lower_h, lower_s, lower_v), (upper_h, upper_s, upper_v))

    def _try_reacquire_by_color(self, frame: np.ndarray, stroke: dict, state):
        signature = stroke.get("hsv_mean")
        bbox = stroke.get("bbox")
        orig_area = stroke.get("area")
        orig_aspect = stroke.get("aspect_ratio")
        if signature is None or bbox is None or orig_area is None or orig_aspect is None or frame is None:
            return None

        (w, h) = bbox
        frames_lost = getattr(state, "frames_since_seen", 0) if state is not None else 0
        center_x, center_y = state.last_good_position if state.last_good_position else (
            self._stroke_centroid(stroke.get("points", []))
        )
        if frames_lost >= 45:
            x1, y1 = 0, 0
            x2, y2 = frame.shape[1], frame.shape[0]
        else:
            search_scale = 1.4 + min(1.2, frames_lost / 30.0)
            search_w = int(max(80, w * search_scale))
            search_h = int(max(80, h * search_scale))
            x1 = int(max(0, center_x - search_w / 2))
            y1 = int(max(0, center_y - search_h / 2))
            x2 = int(min(frame.shape[1], center_x + search_w / 2))
            y2 = int(min(frame.shape[0], center_y + search_h / 2))
        if x2 <= x1 or y2 <= y1:
            return None

        roi = frame[y1:y2, x1:x2]
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        tolerances = (10, 30, 30) if frames_lost < 30 else (15, 45, 45)
        mask = self._hsv_mask(hsv, signature, tolerances)
        mask = cv2.medianBlur(mask, 5)
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        best = None
        best_score = 0.0
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 120:
                continue
            cx, cy, cw, ch = cv2.boundingRect(cnt)
            aspect = float(cw) / max(1.0, float(ch))
            area_ratio = area / max(1.0, orig_area)
            aspect_ratio = aspect / max(0.1, orig_aspect)
            if not (0.35 <= area_ratio <= 3.0):
                continue
            if not (0.4 <= aspect_ratio <= 2.4):
                continue
            mx, my = (cx + cw / 2.0), (cy + ch / 2.0)
            dist = ((mx - (center_x - x1)) ** 2 + (my - (center_y - y1)) ** 2) ** 0.5
            score = area / (1.0 + dist)
            if score > best_score:
                best_score = score
                best = (mx, my)

        if best is None:
            return None
        rx = int(best[0] + x1)
        ry = int(best[1] + y1)
        return (rx, ry)

    def _rects_intersect(self, a, b) -> bool:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        return not (ax + aw < bx or bx + bw < ax or ay + ah < by or by + bh < ay)

    def _fit_rect_from_points(self, points: list[tuple[int, int]]) -> dict:
        pts = np.array(points, dtype=np.float32)
        rect = cv2.minAreaRect(pts)
        box = cv2.boxPoints(rect)
        box_pts = [(int(p[0]), int(p[1])) for p in box]
        return {"points": box_pts, "closed": True}

    def _snap_stroke_to_edges(self, points: list[tuple[int, int]], frame: np.ndarray) -> dict:
        if frame is None or len(points) < 2:
            return {"points": points, "closed": False}

        stroke_box = cv2.boundingRect(np.array(points, dtype=np.int32))
        x, y, w, h = stroke_box
        pad = 12
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(frame.shape[1], x + w + pad)
        y2 = min(frame.shape[0], y + h + pad)

        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return {"points": points, "closed": False}

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)

        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            simplified = self._simplify_stroke(points, epsilon=3.5)
            if self._stroke_closed(points):
                return self._shape_from_points(simplified)
            return {"points": simplified, "closed": False}

        stroke_mask = np.zeros(roi.shape[:2], dtype=np.uint8)
        stroke_pts = np.array([(px - x1, py - y1) for px, py in points], dtype=np.int32)
        cv2.polylines(stroke_mask, [stroke_pts], False, 255, 12)

        best = None
        best_score = 0.0
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 200:
                continue
            cx, cy, cw, ch = cv2.boundingRect(cnt)
            global_rect = (cx + x1, cy + y1, cw, ch)
            if not self._rects_intersect(global_rect, stroke_box):
                continue

            contour_mask = np.zeros_like(stroke_mask)
            cv2.drawContours(contour_mask, [cnt], -1, 255, -1)
            overlap = cv2.bitwise_and(stroke_mask, contour_mask)
            overlap_area = float(cv2.countNonZero(overlap))
            if overlap_area == 0:
                continue

            overlap_ratio = overlap_area / max(1.0, float(cv2.countNonZero(stroke_mask)))
            score = overlap_ratio * area
            if score > best_score:
                best_score = score
                best = cnt

        if best is None or best_score < 50.0:
            simplified = self._simplify_stroke(points, epsilon=3.5)
            if self._stroke_closed(points):
                return self._shape_from_points(simplified)
            return {"points": simplified, "closed": False}

        peri = cv2.arcLength(best, True)
        approx = cv2.approxPolyDP(best, 0.02 * peri, True)
        if len(approx) >= 4:
            approx_pts = [(int(p[0][0] + x1), int(p[0][1] + y1)) for p in approx]
            return {"points": approx_pts, "closed": True}

        rect = cv2.minAreaRect(best)
        box = cv2.boxPoints(rect)
        box_pts = [(int(p[0] + x1), int(p[1] + y1)) for p in box]
        return {"points": box_pts, "closed": True}

    def _maybe_finalize_stroke(self, frame: np.ndarray):
        if self._pending_stroke is None:
            return

        pending = self._pending_stroke
        self._pending_stroke = None
        points = pending["points"]
        color = pending.get("color", self._stroke_palette[0])
        if len(points) < 2:
            return

        if pending.get("snap", False):
            stroke = self._snap_stroke_to_edges(points, frame)
        else:
            simplified = self._simplify_stroke(points, epsilon=2.5)
            stroke = {"points": simplified, "closed": False}

        if stroke["points"]:
            cx, cy = self._stroke_centroid(stroke["points"])
            
            # Create tracker for the drawing
            default_label = "Drawing"
            tracker_id = self.tracker_manager.create_tracker(
                frame, int(cx), int(cy), label=default_label
            )
            local_points = [(x - cx, y - cy) for x, y in stroke["points"]]
            self.renderer.create_annotation(
                tracker_id=tracker_id,
                label=default_label,
                x=int(cx), y=int(cy),
                style=self.current_style,
                color_scheme=ColorScheme(primary=color)
            )
            hsv_sig = self._compute_hsv_signature(frame, stroke["points"], stroke["closed"])
            if hsv_sig is not None:
                stroke["hsv_mean"], stroke["bbox"], stroke["area"], stroke["aspect_ratio"] = hsv_sig
            stroke["color"] = color
            stroke["tracker_id"] = tracker_id
            stroke["local_points"] = local_points
            stroke["visible"] = True
            stroke["label"] = default_label
            self._strokes.append(stroke)
            
            # Trigger label input flow (same as tracker placement)
            stroke_idx = len(self._strokes) - 1
            self._pending_stroke_idx = stroke_idx
            self._pending_tracker_id = tracker_id
            self._pending_original_label = default_label
            self._awaiting_label = True
            self._label_buffer = ""
            
            self.logger.info(f"Drawing created at ({cx:.0f}, {cy:.0f}) — awaiting label")

    def _update_tracked_strokes(self, tracking_states: dict):
        for stroke in self._strokes:
            tracker_id = stroke.get("tracker_id")
            state = tracking_states.get(tracker_id) if tracker_id else None

            if state and state.status in (TrackingStatus.TRACKING, TrackingStatus.OCCLUDED):
                stroke["visible"] = True
                stroke["opacity"] = 1.0 if state.status == TrackingStatus.TRACKING else 0.5
                lx = state.x
                ly = state.y
                stroke["points"] = [
                    (int(lx + dx), int(ly + dy))
                    for dx, dy in stroke.get("local_points", [])
                ]
            else:
                if state and state.status in (TrackingStatus.LOST, TrackingStatus.SEARCHING):
                    reacq = self._try_reacquire_by_color(self.video.latest_frame, stroke, state)
                    if reacq:
                        rx, ry = reacq
                        tracker = self.tracker_manager.get_tracker(tracker_id)
                        if tracker is not None:
                            tracker.initialize(self.video.latest_frame, rx, ry, tracker.label)
                        stroke["local_points"] = [
                            (x - rx, y - ry) for x, y in stroke.get("points", [])
                        ]
                        stroke["visible"] = True
                        stroke["opacity"] = 1.0
                        continue
                stroke["visible"] = False

    def _draw_strokes(self, frame: np.ndarray):
        if not self._strokes and not self._current_stroke:
            return frame

        for stroke in self._strokes:
            if not stroke.get("visible", True):
                continue
            points = stroke["points"]
            closed = stroke["closed"]
            color = stroke.get("color", self._stroke_palette[0])
            opacity = stroke.get("opacity", 1.0)
            draw_color = tuple(int(c * opacity) for c in color)
            if len(points) > 1:
                pts = np.array(points, dtype=np.int32)
                cv2.polylines(frame, [pts], closed, draw_color, self._stroke_thickness, cv2.LINE_AA)
            elif len(points) == 1:
                cv2.circle(frame, points[0], 2, draw_color, -1, cv2.LINE_AA)
            
            # Draw label if set (from AI identification)
            label = stroke.get("label", "")
            if label and points:
                cx, cy = self._stroke_centroid(points)
                label_x, label_y = int(cx + 10), int(cy - 10)
                
                # Text background
                font = cv2.FONT_HERSHEY_SIMPLEX
                font_scale = 0.5
                (text_w, text_h), _ = cv2.getTextSize(label, font, font_scale, 1)
                padding = 3
                cv2.rectangle(frame, (label_x - padding, label_y - text_h - padding),
                             (label_x + text_w + padding, label_y + padding), (0, 0, 0), -1)
                cv2.putText(frame, label, (label_x, label_y), font, font_scale, (255, 255, 255), 1, cv2.LINE_AA)

        if self._drawing_active and len(self._current_stroke) > 1:
            pts = np.array(self._current_stroke, dtype=np.int32)
            cv2.polylines(frame, [pts], False, self._current_stroke_color, self._stroke_thickness, cv2.LINE_AA)

        return frame

    def _draw_draw_mode_badge(self, frame: np.ndarray):
        if not self._draw_mode:
            return frame

        text = "DRAW MODE"
        sub_text = "Hold SHIFT to snap"
        (text_w, text_h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, 0.6, 1)
        (sub_w, sub_h), _ = cv2.getTextSize(sub_text, cv2.FONT_HERSHEY_DUPLEX, 0.45, 1)
        x, y = 12, 70
        padding = 6
        overlay = frame.copy()
        cv2.rectangle(
            overlay,
            (x - padding, y - text_h - padding),
            (x + max(text_w, sub_w) + padding, y + padding + sub_h + 6),
            (0, 100, 140),
            -1
        )
        cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
        cv2.putText(
            frame,
            text,
            (x, y),
            cv2.FONT_HERSHEY_DUPLEX,
            0.6,
            (230, 240, 255),
            1,
            cv2.LINE_AA
        )
        cv2.putText(
            frame,
            sub_text,
            (x, y + sub_h + 6),
            cv2.FONT_HERSHEY_DUPLEX,
            0.45,
            (200, 220, 235),
            1,
            cv2.LINE_AA
        )
        return frame

    def _draw_label_prompt(self, frame: np.ndarray):
        if not self._awaiting_label:
            return frame

        prompt = ("Label: " + (self._label_buffer or "_"))[:60]

        h, w = frame.shape[:2]
        base_y = h - 60

        # Optional: dark box behind text for readability
        overlay = frame.copy()
        cv2.rectangle(overlay, (10, base_y - 30), (min(w - 10, 650), base_y + 40), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

        cv2.putText(
            frame,
            "Type label | * = AI identify | Enter = OK | ESC = cancel",
            (20, base_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 255, 255),
            1,
            cv2.LINE_AA
        )

        cv2.putText(
            frame,
            prompt,
            (20, base_y + 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2,
            cv2.LINE_AA
        )

        return frame

    def run(self):
        """Run the demo."""
        self.logger.info("Starting HoloRay Demo...")

        # Initialize video capture
        if isinstance(self.source, str):
            is_url = "://" in self.source
            if not is_url:
                source_path = Path(self.source).expanduser()
                if source_path.exists() and not source_path.is_file():
                    self.logger.error(f"Video source is not a file: {source_path}")
                    return
                if source_path.is_file():
                    self.source = str(source_path)
                    self.video = VideoFileReader(
                        filepath=self.source,
                        loop=self.loop,
                        resolution=self.resolution
                    )
                else:
                    if source_path.suffix.lower() in VIDEO_EXTENSIONS:
                        self.logger.error(f"Video file not found: {source_path}")
                        return
                    if self.loop:
                        self.logger.warning("Loop option ignored for non-file source")
                    self.video = ThreadedVideoCapture(
                        source=self.source,
                        resolution=self.resolution
                    )
            else:
                if self.loop:
                    self.logger.warning("Loop option ignored for URL/stream source")
                self.video = ThreadedVideoCapture(
                    source=self.source,
                    resolution=self.resolution
                )
        else:
            if self.loop:
                self.logger.warning("Loop option ignored for camera source")
            self.video = ThreadedVideoCapture(
                source=self.source,
                resolution=self.resolution
            )

        if not self.video.start():
            self.logger.error("Failed to start video capture")
            return

        # Wait for first frame
        while self.video.latest_frame is None:
            if not self.video.is_running:
                self.logger.error("No frames received from video source")
                self.video.stop()
                return
            time.sleep(0.01)

        # Initialize tracker manager and renderer
        self.tracker_manager = TrackerManager(
            use_gpu=self.use_gpu,
            enable_reid=self.enable_reid
        )
        self.renderer = AnnotationRenderer(default_style=self.current_style)

        # Setup window and mouse callback
        cv2.namedWindow(self.WINDOW_NAME)
        cv2.setMouseCallback(self.WINDOW_NAME, self._mouse_callback)

        self._running = True
        fps_counter = 0
        fps_time = time.perf_counter()
        display_fps = 0.0
        paused_at_eof = False
        frozen_output: Optional[np.ndarray] = None
        paused_playback = False
        pause_frame: Optional[np.ndarray] = None

        self.logger.info("Demo running. Click to add trackers.")

        try:
            while self._running:
                if paused_at_eof and frozen_output is not None:
                    cv2.imshow(self.WINDOW_NAME, frozen_output)
                    key = cv2.waitKey(30) & 0xFF
                    if key in (ord('q'), 27):
                        self._running = False
                    continue

                if paused_playback:
                    if pause_frame is None:
                        paused_playback = False
                        if isinstance(self.video, VideoFileReader):
                            self.video.resume()
                        continue

                    # Allow interaction while paused using the last frame.
                    frame = pause_frame
                    self._last_frame = frame
                    self._maybe_place_tracker(frame)
                    self._maybe_finalize_stroke(frame)
                    self._handle_right_click()

                    tracking_states = self.tracker_manager.update_all(frame)
                    for tracker_id, state in tracking_states.items():
                        self.renderer.update_annotation(tracker_id, state)
                    self._update_tracked_strokes(tracking_states)

                    output = frame.copy()
                    output = self.renderer.render_all(output, tracking_states)
                    output = self._draw_strokes(output)
                    output = self.renderer.render_hud(
                        output,
                        fps=display_fps,
                        active_trackers=self.tracker_manager.active_count
                    )
                    output = self._draw_draw_mode_badge(output)
                    output = self._draw_label_prompt(output)
                    cv2.putText(
                        output,
                        "PAUSED - Press P to resume",
                        (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        (0, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )
                    cv2.imshow(self.WINDOW_NAME, output)

                    key = cv2.waitKey(30) & 0xFF
                    if key in (ord('q'), 27):
                        self._running = False
                        continue
                    if (
                        not self._awaiting_label
                        and key in (ord('p'), ord('P'))
                        and isinstance(self.video, VideoFileReader)
                    ):
                        paused_playback = False
                        self.video.resume()
                        pause_frame = None
                        fps_counter = 0
                        fps_time = time.perf_counter()
                        continue
                    self._handle_key(key, frame)
                    continue

                # Get latest frame
                frame = self.video.latest_frame
                if frame is None:
                    if not self.video.is_running and self._last_frame is not None:
                        paused_at_eof = True
                        frozen_output = self._last_frame.copy()
                        cv2.putText(
                            frozen_output,
                            "EOF - Press Q/ESC to quit",
                            (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.8,
                            (0, 255, 255),
                            2,
                            cv2.LINE_AA,
                        )
                    continue
                end_of_stream = not self.video.is_running
                if isinstance(self.source, int):
                    frame = cv2.flip(frame, 1)

                # Store for AI labeling (used by background thread)
                self._last_frame = frame

                # Handle pending tracker placement
                self._maybe_place_tracker(frame)

                # Finalize stroke if user finished drawing
                self._maybe_finalize_stroke(frame)

                # Handle right-click removal (disabled while typing)
                self._handle_right_click()

                # Update all trackers
                tracking_states = self.tracker_manager.update_all(frame)

                # Update annotations with tracking states
                for tracker_id, state in tracking_states.items():
                    self.renderer.update_annotation(tracker_id, state)

                # Update tracked strokes
                self._update_tracked_strokes(tracking_states)

                # Start rendering
                output = frame.copy()

                # Render annotations
                output = self.renderer.render_all(output, tracking_states)

                # Render drawings on top of video + annotations
                output = self._draw_strokes(output)

                # Render HUD (FPS, tracker count)
                output = self.renderer.render_hud(
                    output,
                    fps=display_fps,
                    active_trackers=self.tracker_manager.active_count
                )

                # Draw draw-mode badge
                output = self._draw_draw_mode_badge(output)

                # Draw label prompt if user is typing
                output = self._draw_label_prompt(output)

                # FPS calculation
                fps_counter += 1
                current_time = time.perf_counter()
                if current_time - fps_time >= 1.0:
                    display_fps = fps_counter / (current_time - fps_time)
                    fps_counter = 0
                    fps_time = current_time

                # Display frame
                cv2.imshow(self.WINDOW_NAME, output)

                # Centralized keyboard handling
                key = cv2.waitKey(1) & 0xFF
                if (
                    not self._awaiting_label
                    and key in (ord('p'), ord('P'))
                    and isinstance(self.video, VideoFileReader)
                    and not paused_at_eof
                ):
                    paused_playback = True
                    self.video.pause()
                    pause_frame = frame.copy()
                    continue
                self._handle_key(key, frame)
                if end_of_stream:
                    paused_at_eof = True
                    frozen_output = output.copy()
                    cv2.putText(
                        frozen_output,
                        "EOF - Press Q/ESC to quit",
                        (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        (0, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )

        except KeyboardInterrupt:
            self.logger.info("Interrupted by user")
        finally:
            self.video.stop()
            cv2.destroyAllWindows()
            self.logger.info("Demo stopped.")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="HoloRay Tracking & Annotation Engine Demo",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Controls:
  LEFT CLICK   Add tracker (label) or draw (when draw mode is on)
               - During label input:
                 - Type label manually, OR
                 - Press '*' for AI identification (OpenAI)
                 - Press ENTER to confirm
                 - Press ESC to cancel
  RIGHT CLICK  Remove nearest tracker
  D            Toggle draw mode
  P            Pause/resume playback (video files only)
  SHIFT        Snap drawing to detected edges (hold)
  C            Clear drawings
  U            Undo last stroke
  R            Reset all trackers
  S            Cycle annotation styles
  Q/ESC        Quit

AI Setup:
  Set OPENAI_API_KEY environment variable:
    export OPENAI_API_KEY=your_key_here
  Get key at: https://platform.openai.com/api-keys

Examples:
  python main_demo.py                         # Use default webcam (0)
  python main_demo.py --source camera         # Use default webcam (0)
  python main_demo.py --source 1              # Use webcam index 1
  python main_demo.py --source video.mp4      # Use video file
  python main_demo.py --source /path/to/vid.mp4  # Absolute path
  python main_demo.py --no-gpu                # Disable GPU
        """
    )

    parser.add_argument(
        "--source", "-s",
        default=0,
        help="Video source: camera index (0, 1, ...) or file path"
    )
    parser.add_argument(
        "--no-gpu",
        action="store_true",
        help="Disable GPU acceleration"
    )
    parser.add_argument(
        "--no-reid",
        action="store_true",
        help="Disable re-identification"
    )
    parser.add_argument(
        "--resolution", "-r",
        type=str,
        default=None,
        help="Resolution as WxH (e.g., 1280x720)"
    )
    parser.add_argument(
        "--style",
        choices=["minimal", "standard", "detailed", "gaming"],
        default="standard",
        help="Annotation style"
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Loop video files when they reach the end"
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Logging level"
    )

    args = parser.parse_args()

    # Setup logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    # Parse source (supports: camera, 0, 1, path/to/video.mp4)
    source_arg = args.source
    if isinstance(source_arg, str) and source_arg.lower() == "camera":
        source = 0  # Default camera
    else:
        try:
            source = int(source_arg)
        except ValueError:
            source = source_arg  # Treat as file path

    # Parse resolution
    resolution = None
    if args.resolution:
        try:
            w, h = args.resolution.lower().split('x')
            resolution = (int(w), int(h))
        except ValueError:
            print(f"Invalid resolution format: {args.resolution}")
            sys.exit(1)

    # Parse style
    style_map = {
        "minimal": AnnotationStyle.MINIMAL,
        "standard": AnnotationStyle.STANDARD,
        "detailed": AnnotationStyle.DETAILED,
        "gaming": AnnotationStyle.GAMING,
    }
    style = style_map[args.style]

    # Print banner
    print("\n" + "=" * 60)
    print("  HoloRay Tracking & Annotation Engine")
    print("  Proof of Concept Demo")
    print("=" * 60)
    print(f"  Source: {source}")
    print(f"  GPU: {'Enabled' if not args.no_gpu else 'Disabled'}")
    print(f"  Re-ID: {'Enabled' if not args.no_reid else 'Disabled'}")
    print(f"  Style: {args.style}")
    print("=" * 60)
    print("\n  Click on objects to track them!")
    print("  When label prompt appears:")
    print("    - Type a label manually, OR")
    print("    - Press '*' to auto-identify with OpenAI AI")
    print("    - Press ENTER to confirm")
    print("  Press 'D' to toggle draw mode (hold SHIFT to snap).")
    print("  Wave your hand in front to test occlusion detection.")
    print("  Move objects out/in of frame to test re-identification.\n")

    # Run demo
    demo = HoloRayDemo(
        source=source,
        use_gpu=not args.no_gpu,
        enable_reid=not args.no_reid,
        resolution=resolution,
        style=style,
        loop=args.loop
    )
    demo.run()


if __name__ == "__main__":
    main()
