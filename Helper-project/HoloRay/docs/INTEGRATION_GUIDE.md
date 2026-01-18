# HoloRay Integration Guide

## For: VR Chess App Team
## Module: HoloRay Tracking & Annotation Engine v1.0.0

---

## Overview

HoloRay is a standalone Python computer vision library that provides:
- **Object Tracking**: Track any clicked object through video frames
- **Sticky Annotations**: Labels that follow objects despite movement
- **Occlusion Handling**: Annotations fade when objects are blocked (e.g., by a hand)
- **Re-Identification**: Automatically reacquire objects when they re-enter the frame

This engine is designed to be plugged into your VR Chess App for tracking chess pieces.

---

## Quick Start

### Installation

```bash
# Clone or copy the holoray module to your project
cp -r src/holoray /path/to/your/vr-chess-app/

# Install dependencies
pip install torch torchvision opencv-python numpy scipy scikit-image

# Optional: Install CoTracker3 for GPU acceleration
pip install git+https://github.com/facebookresearch/co-tracker.git
```

### Basic Usage

```python
from holoray import (
    ThreadedVideoCapture,
    TrackerManager,
    AnnotationRenderer,
    TrackingStatus
)

# 1. Setup video input
video = ThreadedVideoCapture(source=0)  # 0 = webcam
video.start()

# 2. Setup tracking and rendering
tracker_manager = TrackerManager(use_gpu=True, enable_reid=True)
renderer = AnnotationRenderer()

# 3. When user clicks on a chess piece
def on_piece_clicked(x: int, y: int, piece_name: str):
    frame = video.latest_frame

    # Create tracker
    tracker_id = tracker_manager.create_tracker(
        frame=frame,
        x=x,
        y=y,
        label=piece_name
    )

    # Create annotation
    renderer.create_annotation(
        tracker_id=tracker_id,
        label=piece_name,
        x=x,
        y=y
    )

    return tracker_id

# 4. Main update loop (call every frame)
def update():
    frame = video.latest_frame
    if frame is None:
        return None

    # Update all trackers
    states = tracker_manager.update_all(frame)

    # Render annotations
    output = renderer.render_all(frame, states)

    return output, states

# 5. Cleanup
video.stop()
```

---

## API Reference

### `TrackerManager`

Manages multiple object trackers.

```python
manager = TrackerManager(
    use_gpu=True,      # Use GPU if available
    enable_reid=True   # Enable re-identification
)

# Create tracker for a chess piece
tracker_id = manager.create_tracker(frame, x, y, label="Queen")

# Update all trackers (call each frame)
states = manager.update_all(frame)
# Returns: Dict[tracker_id, TrackingState]

# Get specific tracker
tracker = manager.get_tracker(tracker_id)

# Remove tracker
manager.remove_tracker(tracker_id)

# Get active tracker count
count = manager.active_count
```

### `ObjectTracker`

Single object tracker with occlusion detection and re-ID.

```python
from holoray import ObjectTracker, TrackingStatus

tracker = ObjectTracker(use_gpu=True, enable_reid=True)
tracker.initialize(frame, x=320, y=240, label="Knight")

# Update each frame
state = tracker.update(frame)

# Check status
if state.status == TrackingStatus.TRACKING:
    # Object is being tracked normally
    print(f"Position: ({state.x}, {state.y})")

elif state.status == TrackingStatus.OCCLUDED:
    # Object is temporarily blocked
    print("Piece occluded - show ghost annotation")

elif state.status == TrackingStatus.LOST:
    # Object left frame or tracking failed
    print("Piece lost - hide annotation")

elif state.status == TrackingStatus.SEARCHING:
    # Looking for re-entry
    print("Searching for piece...")
```

### `TrackingState`

Returned by tracker updates.

```python
@dataclass
class TrackingState:
    status: TrackingStatus    # TRACKING, OCCLUDED, LOST, SEARCHING
    x: float                  # Current X position
    y: float                  # Current Y position
    confidence: float         # Tracking confidence (0.0 - 1.0)
    is_occluded: bool         # True if object is blocked
    velocity: Tuple[float, float]  # Movement velocity (vx, vy)
    frames_since_seen: int    # Frames since good tracking
    last_good_position: Tuple[float, float]  # Last known position
```

### `AnnotationRenderer`

Renders visual annotations with smooth animations.

```python
from holoray import AnnotationRenderer, AnnotationStyle

renderer = AnnotationRenderer(
    default_style=AnnotationStyle.STANDARD
)

# Create annotation
renderer.create_annotation(
    tracker_id="knight_1",
    label="Knight",
    x=320, y=240,
    style=AnnotationStyle.GAMING  # or MINIMAL, STANDARD, DETAILED
)

# Render all annotations onto frame
output_frame = renderer.render_all(frame, tracking_states)

# Add HUD with FPS and tracker count
output_frame = renderer.render_hud(output_frame, fps=60.0, active_trackers=16)
```

### Annotation Styles

| Style | Description |
|-------|-------------|
| `MINIMAL` | Simple dot + label |
| `STANDARD` | Crosshair + label box + connecting line |
| `DETAILED` | Full visualization with confidence bar |
| `GAMING` | Animated, colorful style |

---

## Integration Example: VR Chess

```python
"""
Example: Integrating HoloRay with VR Chess App
"""
from holoray import TrackerManager, AnnotationRenderer, TrackingStatus, AnnotationStyle

class ChessTracker:
    """Wrapper for chess piece tracking."""

    PIECE_LABELS = {
        'K': 'King', 'Q': 'Queen', 'R': 'Rook',
        'B': 'Bishop', 'N': 'Knight', 'P': 'Pawn'
    }

    def __init__(self):
        self.manager = TrackerManager(use_gpu=True, enable_reid=True)
        self.renderer = AnnotationRenderer(default_style=AnnotationStyle.GAMING)
        self.piece_trackers = {}  # piece_id -> tracker_id

    def track_piece(self, frame, x: int, y: int, piece_type: str, piece_id: str):
        """Start tracking a chess piece."""
        label = self.PIECE_LABELS.get(piece_type, piece_type)

        tracker_id = self.manager.create_tracker(frame, x, y, label)
        self.renderer.create_annotation(tracker_id, label, x, y)
        self.piece_trackers[piece_id] = tracker_id

        return tracker_id

    def update(self, frame):
        """Update all piece trackers."""
        states = self.manager.update_all(frame)
        output = self.renderer.render_all(frame, states)
        return output, states

    def get_piece_position(self, piece_id: str):
        """Get current position of a piece."""
        tracker_id = self.piece_trackers.get(piece_id)
        if tracker_id:
            tracker = self.manager.get_tracker(tracker_id)
            if tracker and tracker.status == TrackingStatus.TRACKING:
                return tracker.position
        return None

    def is_piece_visible(self, piece_id: str) -> bool:
        """Check if piece is currently visible."""
        tracker_id = self.piece_trackers.get(piece_id)
        if tracker_id:
            tracker = self.manager.get_tracker(tracker_id)
            if tracker:
                return tracker.status in [TrackingStatus.TRACKING, TrackingStatus.OCCLUDED]
        return False


# Usage in your VR Chess main loop
chess_tracker = ChessTracker()

# When board is detected, track each piece
for piece in detected_pieces:
    chess_tracker.track_piece(
        frame,
        x=piece.x,
        y=piece.y,
        piece_type=piece.type,
        piece_id=piece.id
    )

# Each frame
while running:
    frame = camera.get_frame()
    annotated_frame, states = chess_tracker.update(frame)

    # Check for piece interactions
    for piece_id, tracker_id in chess_tracker.piece_trackers.items():
        state = states.get(tracker_id)
        if state and state.status == TrackingStatus.LOST:
            # Piece was removed from board?
            handle_piece_capture(piece_id)
```

---

## Configuration Options

### Performance Tuning

```python
# For lower-end hardware (no GPU)
tracker_manager = TrackerManager(
    use_gpu=False,      # Use CPU optical flow
    enable_reid=False   # Disable re-ID for speed
)

# For maximum accuracy
tracker_manager = TrackerManager(
    use_gpu=True,       # Use CoTracker3
    enable_reid=True    # Enable re-ID
)
```

### Threshold Customization

Edit `holoray_core.py` constants:

```python
class ObjectTracker:
    CONFIDENCE_HIGH = 0.7       # Above this = solid tracking
    CONFIDENCE_LOW = 0.3        # Below this = lost
    OCCLUSION_CONFIDENCE_DROP = 0.4  # Sudden drop = occlusion
    LOST_FRAMES_THRESHOLD = 30  # Frames before marking lost
    REID_MATCH_THRESHOLD = 0.6  # Re-ID similarity threshold
    EDGE_MARGIN = 50            # Pixels from edge for re-entry search
```

---

## Troubleshooting

### "CoTracker not available"
The system automatically falls back to Lucas-Kanade optical flow. For GPU acceleration:
```bash
pip install git+https://github.com/facebookresearch/co-tracker.git
```

### Low FPS
1. Reduce number of tracked objects
2. Disable re-ID: `TrackerManager(enable_reid=False)`
3. Use CPU mode if GPU memory is limited

### Annotations flickering
Increase position smoothing in `annotation_layer.py`:
```python
ann.update_position(x, y, smoothing=0.5)  # Higher = smoother
```

### Objects not re-identified
- Ensure `enable_reid=True`
- Check that reference features were extracted (good lighting at initialization)
- Lower `REID_MATCH_THRESHOLD` for more lenient matching

---

## File Structure

```
src/holoray/
├── __init__.py          # Package exports
├── video_pipeline.py    # Threaded video capture
├── holoray_core.py      # ObjectTracker, TrackerManager
└── annotation_layer.py  # Visual rendering

main_demo.py             # Standalone demo (not chess app)
requirements.txt         # Dependencies
```

---

## Support

For issues specific to HoloRay tracking:
- Check the demo works: `python main_demo.py`
- Review logs: Add `logging.basicConfig(level=logging.DEBUG)`
- Test with simple objects before chess pieces

---

**HoloRay Engine v1.0.0** - Built for McHacks 13 HoloXR Challenge
