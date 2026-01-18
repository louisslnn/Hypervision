# Module Reference

API documentation for HoloRay Engine modules.

---

## `holoray_core.py` - Tracking Engine

### `ObjectTracker`

Tracks a single object through video frames.

#### Methods

**`initialize(frame, x, y, label="")`**
- Initialize tracking on object at pixel coordinates `(x, y)`
- Creates point grid, extracts features, initializes CoTracker if available
- Returns: `bool` (success)

**`update(frame)`**
- Update tracker with new frame
- Returns: `TrackingState` (position, confidence, status)

#### Properties

- `status: TrackingStatus` - Current tracking status
- `position: Tuple[float, float]` - Current `(x, y)` position
- `confidence: float` - Tracking confidence (0.0 to 1.0)

#### Example

```python
tracker = ObjectTracker(use_gpu=True, enable_reid=True)
tracker.initialize(frame, x=320, y=240, label="Pawn")

while True:
    state = tracker.update(frame)
    if state.status == TrackingStatus.TRACKING:
        draw_at(state.x, state.y)
```

---

### `TrackerManager`

Manages multiple trackers simultaneously.

#### Methods

**`create_tracker(frame, x, y, label="")`**
- Create and initialize new tracker
- Returns: `str` (tracker_id)

**`update_all(frame)`**
- Update all trackers with new frame
- Returns: `Dict[str, TrackingState]` (tracker_id → state)

**`remove_tracker(tracker_id)`**
- Remove specific tracker

**`get_tracker(tracker_id)`**
- Get `ObjectTracker` instance by ID
- Returns: `Optional[ObjectTracker]`

#### Properties

- `tracker_ids: List[str]` - All active tracker IDs
- `active_count: int` - Count of non-lost trackers

#### Example

```python
manager = TrackerManager(use_gpu=True, enable_reid=True)

# Add trackers
id1 = manager.create_tracker(frame, 100, 200, label="Pawn")
id2 = manager.create_tracker(frame, 500, 300, label="Rook")

# Update all
states = manager.update_all(frame)
for tracker_id, state in states.items():
    print(f"{tracker_id}: {state.status} at ({state.x}, {state.y})")
```

---

### `TrackingStatus` (Enum)

- `TRACKING` - Actively tracking, high confidence
- `OCCLUDED` - Temporarily blocked (e.g., hand in front)
- `LOST` - Object left frame or tracking failed
- `SEARCHING` - Looking for re-identification
- `INACTIVE` - Not initialized

---

### `TrackingState` (Dataclass)

```python
@dataclass
class TrackingState:
    status: TrackingStatus
    x: float              # X coordinate
    y: float              # Y coordinate
    confidence: float     # 0.0 to 1.0
    is_occluded: bool
    velocity: Tuple[float, float]
    frames_since_seen: int
    last_good_position: Tuple[float, float]
```

---

## `video_pipeline.py` - Video Capture

### `ThreadedVideoCapture`

High-performance threaded video capture.

#### Initialization

```python
cap = ThreadedVideoCapture(
    source=0,              # Camera index or file path
    target_fps=None,       # Optional FPS limit
    resolution=None,       # Optional (width, height)
    buffer_size=1          # Internal buffer (1 = no buffering)
)
```

#### Methods

**`start()`**
- Start background capture thread
- Returns: `bool` (success)

**`stop()`**
- Stop capture and release resources

#### Properties

- `latest_frame: Optional[np.ndarray]` - **Always returns freshest frame**
- `metadata: FrameMetadata` - Frame info (FPS, count, etc.)
- `is_running: bool` - Whether capture is active
- `frame_size: Tuple[int, int]` - Frame dimensions
- `fps: float` - Actual frames per second

#### Context Manager

```python
with ThreadedVideoCapture(source=0) as cap:
    while True:
        frame = cap.latest_frame
        if frame is not None:
            process(frame)
```

---

### `VideoFileReader`

Specialized reader for video files with seeking.

**Additional Methods:**
- `seek(frame_number)` - Seek to specific frame
- `seek_time(seconds)` - Seek to time in seconds

**Properties:**
- `total_frames: int` - Total frame count
- `duration: float` - Video duration in seconds

---

### `FrameProcessor`

Utility functions for frame operations.

**Static Methods:**
- `resize(frame, width=None, height=None)` - Resize with aspect ratio
- `to_rgb(frame)` - Convert BGR → RGB
- `to_grayscale(frame)` - Convert to grayscale
- `extract_patch(frame, x, y, size=64)` - Extract square patch

---

## `annotation_layer.py` - Rendering

### `AnnotationRenderer`

Renders annotations onto video frames.

#### Initialization

```python
renderer = AnnotationRenderer(
    default_style=AnnotationStyle.STANDARD,
    font=cv2.FONT_HERSHEY_SIMPLEX,
    font_scale=0.6,
    thickness=2
)
```

#### Methods

**`create_annotation(tracker_id, label, x, y, style=None)`**
- Create new annotation
- Returns: `Annotation` instance

**`update_annotation(tracker_id, state)`**
- Update annotation from `TrackingState`

**`remove_annotation(tracker_id)`**
- Remove annotation

**`render_all(frame, tracking_states)`**
- Render all annotations onto frame
- Returns: Annotated frame (`np.ndarray`)

**`render_hud(frame, fps=0.0, active_trackers=0)`**
- Render heads-up display with metrics
- Returns: Frame with HUD overlay

#### Example

```python
renderer = AnnotationRenderer()

# Create annotations
renderer.create_annotation("tracker_1", "Pawn", x=100, y=200)
renderer.create_annotation("tracker_2", "Rook", x=500, y=300)

# Update and render
states = {"tracker_1": state1, "tracker_2": state2}
annotated_frame = renderer.render_all(frame, states)
```

---

### `AnnotationStyle` (Enum)

- `MINIMAL` - Dot + label (minimal visual clutter)
- `STANDARD` - Crosshair + circle + label box (default)
- `DETAILED` - Full visualization + confidence bar
- `GAMING` - Animated pulsing style

---

### `Annotation` (Dataclass)

Represents a visual annotation attached to a tracked object.

**Fields:**
- `label_text: str` - Text to display
- `tracker_id: str` - Associated tracker ID
- `coordinates: Tuple[float, float]` - Current position
- `opacity: float` - Current opacity (0.0 to 1.0)
- `style: AnnotationStyle` - Visual style

**Methods:**
- `update_position(x, y, smoothing=0.3)` - Update position with smoothing
- `update_opacity(status, transition_speed=0.15)` - Update opacity from status

---

## `main_demo.py` - Demo Application

### `HoloRayDemo`

Interactive demo application demonstrating tracking capabilities.

#### Initialization

```python
demo = HoloRayDemo(
    source=0,                    # Camera or video file
    use_gpu=True,                # Enable GPU acceleration
    enable_reid=True,            # Enable re-identification
    resolution=None,             # Optional (width, height)
    style=AnnotationStyle.STANDARD
)
```

#### Methods

**`run()`**
- Start interactive demo loop
- Handles mouse clicks, keyboard input, rendering

---

## Quick Integration Example

```python
from holoray import TrackerManager, AnnotationRenderer, ThreadedVideoCapture

# Setup
video = ThreadedVideoCapture(source=0)
video.start()

tracker_manager = TrackerManager(use_gpu=True)
renderer = AnnotationRenderer()

# User clicks at (x, y)
frame = video.latest_frame
tracker_id = tracker_manager.create_tracker(frame, x, y, label="Object")
renderer.create_annotation(tracker_id, "Object", x, y)

# Main loop
while True:
    frame = video.latest_frame
    if frame is None:
        continue
    
    # Update tracking
    states = tracker_manager.update_all(frame)
    
    # Render
    annotated = renderer.render_all(frame.copy(), states)
    annotated = renderer.render_hud(annotated, fps=30.0, active_trackers=1)
    
    cv2.imshow("Output", annotated)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

video.stop()
```

---

## Constants & Thresholds

### `ObjectTracker` Thresholds

```python
CONFIDENCE_HIGH = 0.7              # High confidence threshold
CONFIDENCE_LOW = 0.3               # Low confidence threshold
OCCLUSION_CONFIDENCE_DROP = 0.4    # Sudden drop = occlusion
LOST_FRAMES_THRESHOLD = 30         # Frames before marking LOST
REID_MATCH_THRESHOLD = 0.6         # Minimum similarity for re-ID
EDGE_MARGIN = 50                   # Pixels from edge for re-entry search
```

---

## Error Handling

All modules use Python logging. Set log level:

```python
import logging
logging.basicConfig(level=logging.INFO)  # or DEBUG, WARNING, ERROR
```

Common issues:
- **CoTracker not available:** Falls back to optical flow automatically
- **GPU unavailable:** Set `use_gpu=False` or system will detect
- **Video source fails:** Check `video.start()` return value
