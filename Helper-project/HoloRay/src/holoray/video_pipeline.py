"""
HoloRay Video Pipeline - Ultra-Low Latency Threaded Video Reader

Optimized for real-time AR tracking with:
- Zero-latency frame access (always returns freshest frame)
- Automatic frame dropping to prevent buffer lag
- Resolution scaling utilities for tracking optimization
- Performance metrics overlay
"""

import threading
import time
from typing import Optional, Tuple, Callable
from dataclasses import dataclass
from enum import Enum
import logging

import cv2
import numpy as np


class VideoSource(Enum):
    """Video source types."""
    WEBCAM = "webcam"
    FILE = "file"
    RTSP = "rtsp"


@dataclass
class FrameMetadata:
    """Metadata for a captured frame."""
    timestamp: float
    frame_number: int
    width: int
    height: int
    fps: float
    dropped_frames: int
    latency_ms: float = 0.0


class ThreadedVideoCapture:
    """
    Ultra-low latency threaded video capture.
    
    Key Optimizations:
    - Daemon thread continuously captures frames
    - ALWAYS returns the freshest frame (no buffering lag)
    - Automatically drops old frames
    - Minimal locking overhead
    - Tracks capture latency for debugging
    
    Usage:
        cap = ThreadedVideoCapture(source=0)
        cap.start()
        
        while True:
            frame = cap.latest_frame
            if frame is not None:
                # Process frame
                pass
    """
    
    def __init__(
        self,
        source: int | str = 0,
        target_fps: Optional[float] = None,
        resolution: Optional[Tuple[int, int]] = None,
        buffer_size: int = 1
    ):
        """
        Initialize threaded video capture.
        
        Args:
            source: Camera index (int) or video file path / RTSP URL (str)
            target_fps: Target frame rate (None = use source native FPS)
            resolution: Target resolution as (width, height), None = native
            buffer_size: Internal buffer size (1 = always fresh, no delay)
        """
        self.source = source
        self.target_fps = target_fps
        self.resolution = resolution
        self.buffer_size = buffer_size
        
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame: Optional[np.ndarray] = None
        self._frame_lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._paused = False
        
        # Metrics
        self._frame_count = 0
        self._dropped_frames = 0
        self._start_time = 0.0
        self._last_frame_time = 0.0
        self._capture_timestamp = 0.0  # When frame was captured
        self._actual_fps = 0.0
        
        # Latency tracking
        self._latency_ms = 0.0
        
        # Source info
        self._width = 0
        self._height = 0
        self._native_fps = 0.0
        
        self.logger = logging.getLogger(__name__)
    
    def _init_capture(self) -> bool:
        """Initialize the video capture device with optimized settings."""
        # Use CAP_DSHOW on Windows for lower latency, CAP_V4L2 on Linux
        if isinstance(self.source, int):
            # Try platform-specific backends for lower latency
            import platform
            if platform.system() == "Windows":
                self._cap = cv2.VideoCapture(self.source, cv2.CAP_DSHOW)
            elif platform.system() == "Darwin":  # macOS
                self._cap = cv2.VideoCapture(self.source, cv2.CAP_AVFOUNDATION)
            else:
                self._cap = cv2.VideoCapture(self.source, cv2.CAP_V4L2)
        else:
            self._cap = cv2.VideoCapture(self.source)
        
        if not self._cap.isOpened():
            # Fallback to default backend
            self._cap = cv2.VideoCapture(self.source)
            if not self._cap.isOpened():
                self.logger.error(f"Failed to open video source: {self.source}")
                return False
        
        # Set resolution if specified
        if self.resolution:
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.resolution[0])
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.resolution[1])
        
        # CRITICAL: Set buffer size to 1 for minimum latency
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        # Try to set MJPEG format for faster decoding
        self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        
        # Get actual properties
        self._width = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self._height = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self._native_fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
        
        self.logger.info(
            f"Video source initialized: {self._width}x{self._height} @ {self._native_fps:.1f}fps"
        )
        return True
    
    def _capture_loop(self):
        """
        Background thread capture loop.
        
        CRITICAL: This loop MUST run as fast as possible to always have
        the freshest frame available. Old frames are dropped immediately.
        """
        while self._running:
            if self._paused:
                time.sleep(0.01)
                continue
            # Grab frame as fast as possible
            ret = self._cap.grab()
            
            if ret:
                # Only decode when we need to update
                ret, frame = self._cap.retrieve()
                
                if ret:
                    capture_time = time.perf_counter()
                    
                    with self._frame_lock:
                        # Drop old frame and store new one
                        if self._frame is not None:
                            self._dropped_frames += 1
                        self._frame = frame
                        self._capture_timestamp = capture_time
                        self._frame_count += 1
                        self._last_frame_time = capture_time
                    
                    # Update FPS calculation (rolling average)
                    elapsed = capture_time - self._start_time
                    if elapsed > 0:
                        self._actual_fps = self._frame_count / elapsed
            else:
                # End of video file or capture error
                if isinstance(self.source, str):
                    self.logger.info("End of video file reached")
                    self._running = False
                else:
                    # Brief sleep on error to prevent CPU spin
                    time.sleep(0.001)
    
    def start(self) -> bool:
        """Start the capture thread."""
        if self._running:
            return True
        
        if not self._init_capture():
            return False
        
        self._running = True
        self._start_time = time.perf_counter()
        self._frame_count = 0
        self._dropped_frames = 0
        
        # Daemon thread - will be killed when main program exits
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        
        self.logger.info("Video capture thread started")
        return True
    
    def stop(self):
        """Stop the capture thread and release resources."""
        self._running = False
        self._paused = False
        
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        
        if self._cap:
            self._cap.release()
            self._cap = None
        
        self.logger.info("Video capture stopped")
    
    @property
    def latest_frame(self) -> Optional[np.ndarray]:
        """
        Get the latest captured frame.
        
        ALWAYS returns the freshest frame with zero buffering delay.
        Also calculates latency (time since frame was captured).
        
        Returns:
            Latest frame as numpy array (BGR), or None if no frame available
        """
        with self._frame_lock:
            if self._frame is None:
                return None
            
            # Calculate latency
            self._latency_ms = (time.perf_counter() - self._capture_timestamp) * 1000
            
            # Return copy to prevent race conditions
            return self._frame.copy()
    
    @property
    def latest_frame_no_copy(self) -> Optional[np.ndarray]:
        """Get latest frame without copying (faster but not thread-safe)."""
        with self._frame_lock:
            return self._frame
    
    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        """OpenCV-compatible read method."""
        frame = self.latest_frame
        return (frame is not None, frame)
    
    @property
    def metadata(self) -> FrameMetadata:
        """Get current frame metadata including latency."""
        return FrameMetadata(
            timestamp=self._last_frame_time,
            frame_number=self._frame_count,
            width=self._width,
            height=self._height,
            fps=self._actual_fps,
            dropped_frames=self._dropped_frames,
            latency_ms=self._latency_ms
        )
    
    @property
    def latency_ms(self) -> float:
        """Get current frame latency in milliseconds."""
        return self._latency_ms
    
    @property
    def is_running(self) -> bool:
        return self._running
    
    @property
    def frame_size(self) -> Tuple[int, int]:
        return (self._width, self._height)
    
    @property
    def fps(self) -> float:
        return self._actual_fps

    def pause(self):
        """Pause frame capture."""
        self._paused = True

    def resume(self):
        """Resume frame capture."""
        self._paused = False

    def toggle_pause(self) -> bool:
        """Toggle paused state and return the new value."""
        self._paused = not self._paused
        return self._paused

    @property
    def is_paused(self) -> bool:
        return self._paused
    
    def __enter__(self):
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()
        return False


class VideoFileReader(ThreadedVideoCapture):
    """Specialized reader for video files with seeking support."""
    
    def __init__(self, filepath: str, loop: bool = False, **kwargs):
        super().__init__(source=filepath, **kwargs)
        self.filepath = filepath
        self.loop = loop
        self._total_frames = 0
    
    def _init_capture(self) -> bool:
        if not super()._init_capture():
            return False
        self._total_frames = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT))
        return True
    
    def _capture_loop(self):
        """Override to add looping support."""
        while self._running:
            if self._paused:
                time.sleep(0.01)
                continue
            ret, frame = self._cap.read()
            
            if ret:
                with self._frame_lock:
                    self._frame = frame
                    self._capture_timestamp = time.perf_counter()
                    self._frame_count += 1
                    self._last_frame_time = self._capture_timestamp
            else:
                if self.loop:
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                else:
                    self._running = False
                    break
            
            # Control playback speed
            if self._native_fps > 0:
                time.sleep(1.0 / self._native_fps)
    
    def seek(self, frame_number: int):
        if self._cap:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    
    def seek_time(self, seconds: float):
        if self._cap and self._native_fps > 0:
            self.seek(int(seconds * self._native_fps))
    
    @property
    def total_frames(self) -> int:
        return self._total_frames
    
    @property
    def duration(self) -> float:
        return self._total_frames / self._native_fps if self._native_fps > 0 else 0.0


class FrameProcessor:
    """Utility class for frame processing and resolution scaling."""
    
    @staticmethod
    def resize(frame: np.ndarray, width: int = None, height: int = None) -> np.ndarray:
        """Resize frame maintaining aspect ratio."""
        h, w = frame.shape[:2]
        
        if width and not height:
            ratio = width / w
            new_size = (width, int(h * ratio))
        elif height and not width:
            ratio = height / h
            new_size = (int(w * ratio), height)
        elif width and height:
            new_size = (width, height)
        else:
            return frame
        
        return cv2.resize(frame, new_size, interpolation=cv2.INTER_LINEAR)
    
    @staticmethod
    def downscale_for_tracking(
        frame: np.ndarray, 
        target_width: int = 640
    ) -> Tuple[np.ndarray, float]:
        """
        Downscale frame for efficient tracking.
        
        Args:
            frame: Original high-resolution frame
            target_width: Target width for tracking (default 640)
            
        Returns:
            (downscaled_frame, scale_factor)
            
        Usage:
            small_frame, scale = downscale_for_tracking(frame, 640)
            # Track on small_frame, get (x, y)
            # Convert back: original_x = x * scale, original_y = y * scale
        """
        h, w = frame.shape[:2]
        
        if w <= target_width:
            return frame, 1.0
        
        scale = target_width / w
        new_h = int(h * scale)
        
        small_frame = cv2.resize(
            frame, (target_width, new_h), 
            interpolation=cv2.INTER_LINEAR
        )
        
        return small_frame, 1.0 / scale  # Return inverse scale for coordinate conversion
    
    @staticmethod
    def scale_coordinates(
        x: float, y: float, 
        scale: float
    ) -> Tuple[float, float]:
        """Scale coordinates from tracking resolution to display resolution."""
        return x * scale, y * scale
    
    @staticmethod
    def to_rgb(frame: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    @staticmethod
    def to_grayscale(frame: np.ndarray) -> np.ndarray:
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    @staticmethod
    def extract_patch(frame: np.ndarray, x: int, y: int, size: int = 64) -> np.ndarray:
        """Extract a square patch centered at (x, y)."""
        h, w = frame.shape[:2]
        half = size // 2
        
        x1 = max(0, x - half)
        y1 = max(0, y - half)
        x2 = min(w, x + half)
        y2 = min(h, y + half)
        
        patch = frame[y1:y2, x1:x2]
        
        if patch.shape[0] != size or patch.shape[1] != size:
            patch = cv2.resize(patch, (size, size), interpolation=cv2.INTER_LINEAR)
        
        return patch


class PerformanceOverlay:
    """
    Visual debugger overlay for FPS and latency monitoring.
    
    Displays a bright green performance counter in the top-left corner.
    """
    
    def __init__(self):
        self._fps_history = []
        self._latency_history = []
        self._history_size = 30  # Average over 30 frames
        self._last_time = time.perf_counter()
        self._frame_times = []
    
    def update(self, latency_ms: float = 0.0):
        """Update performance metrics."""
        current_time = time.perf_counter()
        frame_time = current_time - self._last_time
        self._last_time = current_time
        
        # Track frame times for FPS calculation
        self._frame_times.append(frame_time)
        if len(self._frame_times) > self._history_size:
            self._frame_times.pop(0)
        
        # Track latency
        self._latency_history.append(latency_ms)
        if len(self._latency_history) > self._history_size:
            self._latency_history.pop(0)
    
    def get_fps(self) -> float:
        """Get smoothed FPS."""
        if not self._frame_times:
            return 0.0
        avg_frame_time = sum(self._frame_times) / len(self._frame_times)
        return 1.0 / avg_frame_time if avg_frame_time > 0 else 0.0
    
    def get_latency(self) -> float:
        """Get smoothed latency in ms."""
        if not self._latency_history:
            return 0.0
        return sum(self._latency_history) / len(self._latency_history)
    
    def draw(self, frame: np.ndarray, extra_info: str = "") -> np.ndarray:
        """
        Draw performance overlay on frame.
        
        Args:
            frame: Frame to draw on
            extra_info: Additional info to display
            
        Returns:
            Frame with overlay
        """
        fps = self.get_fps()
        latency = self.get_latency()
        
        # Determine color based on performance
        if fps >= 30:
            color = (0, 255, 0)  # Green - good
        elif fps >= 20:
            color = (0, 255, 255)  # Yellow - acceptable
        else:
            color = (0, 0, 255)  # Red - poor
        
        # Draw semi-transparent background
        overlay = frame.copy()
        cv2.rectangle(overlay, (5, 5), (220, 75), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
        
        # Draw FPS
        fps_text = f"FPS: {fps:.1f}"
        cv2.putText(frame, fps_text, (10, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2, cv2.LINE_AA)
        
        # Draw Latency
        latency_text = f"Latency: {latency:.1f}ms"
        cv2.putText(frame, latency_text, (10, 55),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1, cv2.LINE_AA)
        
        # Draw extra info if provided
        if extra_info:
            cv2.putText(frame, extra_info, (10, 95),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1, cv2.LINE_AA)
        
        return frame


if __name__ == "__main__":
    # Demo: Test threaded video capture with performance overlay
    logging.basicConfig(level=logging.INFO)
    
    print("Testing ThreadedVideoCapture with Performance Overlay...")
    print("Press 'q' to quit")
    
    perf = PerformanceOverlay()
    
    with ThreadedVideoCapture(source=0) as cap:
        # Wait for first frame
        while cap.latest_frame is None:
            time.sleep(0.01)
        
        while True:
            frame = cap.latest_frame
            if frame is None:
                continue
            
            # Update performance metrics
            perf.update(cap.latency_ms)
            
            # Draw overlay
            frame = perf.draw(frame, f"Dropped: {cap.metadata.dropped_frames}")
            
            cv2.imshow("HoloRay Video Pipeline Test", frame)
            
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    
    cv2.destroyAllWindows()
    print("Test complete.")
