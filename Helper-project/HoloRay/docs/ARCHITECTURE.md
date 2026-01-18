# Architecture

Technical overview of the HoloRay Engine tracking pipeline.

---

## Pipeline Flow

```
Video Input (Webcam/File)
    ↓
ThreadedVideoCapture (background thread, always fresh frames)
    ↓
HoloRayDemo.run()
    ↓
┌─────────────────────────────────────┐
│ For each frame:                     │
│  1. TrackerManager.update_all()     │
│     - ObjectTracker.update()        │
│       • CoTracker3 (GPU) or         │
│       • Optical Flow (CPU)          │
│     - Detect occlusion              │
│     - Re-identification (if lost)   │
│  2. AnnotationRenderer.render_all() │
│     - Update opacity from status    │
│     - Draw annotations              │
│  3. Display frame                   │
└─────────────────────────────────────┘
```

---

## Core Components

### 1. ThreadedVideoCapture (`video_pipeline.py`)

**Purpose:** Zero-latency frame access for real-time tracking.

**Key Features:**
- Background thread continuously captures frames
- `.latest_frame` always returns the freshest frame (old frames dropped)
- Thread-safe with minimal locking overhead
- Supports webcam, video files, and RTSP streams

**Why Threaded?**
Without threading, `cv2.VideoCapture.read()` blocks, causing frame buffering and latency. The threaded approach ensures the main loop always gets the most recent frame.

---

### 2. ObjectTracker (`holoray_core.py`)

**Purpose:** Tracks a single object through video frames with occlusion detection and re-identification.

#### Tracking Methods

**GPU (CoTracker3):**
- Uses Meta Research CoTracker3 for point-based tracking
- Requires frames divisible by 16 (handled via `SmartPadding`)
- High accuracy, ~15-30ms per frame on GPU

**CPU Fallback (Optical Flow):**
- Lucas-Kanade optical flow on point grid
- 5x5 grid of tracking points around initial click
- Robust to lighting changes, lower accuracy than CoTracker

#### Tracking States

```python
TRACKING   # Object tracked with high confidence (opacity: 1.0)
OCCLUDED   # Object temporarily blocked (opacity: 0.3)
LOST       # Object left frame or tracking failed (opacity: 0.0)
SEARCHING  # Actively looking for re-identification
```

#### Occlusion Detection

**Logic:**
1. Monitor tracking confidence between frames
2. If confidence drops suddenly (> 0.4) but object is still in frame bounds
3. → Mark as `OCCLUDED` (likely blocked by hand/other object)
4. Keep annotation visible at reduced opacity (30%)
5. Continue predicting position using velocity

#### Re-Identification

**When:** Object status is `LOST`

**How:**
1. Extract reference features (ORB descriptors + color histogram) from last known good position
2. Search frame edges (top, bottom, left, right) for similar features
3. Use feature matching score (ORB + histogram + template matching)
4. If match found above threshold (0.6) → Re-initialize tracker at new position

**Edge Search Strategy:**
- Only searches edges to catch objects re-entering frame
- Samples points every 32 pixels in edge regions
- Computationally efficient (doesn't scan entire frame)

---

### 3. TrackerManager (`holoray_core.py`)

**Purpose:** Manages multiple `ObjectTracker` instances simultaneously.

**Key Methods:**
- `create_tracker(frame, x, y, label)` - Create new tracker
- `update_all(frame)` - Update all trackers with new frame
- `remove_tracker(tracker_id)` - Remove specific tracker

**Thread Safety:**
Currently not thread-safe (assumes single-threaded main loop). Could be extended for multi-threaded tracking.

---

### 4. AnnotationRenderer (`annotation_layer.py`)

**Purpose:** Renders visual annotations with smooth opacity transitions.

#### Annotation Styles

**MINIMAL:**
- Dot marker + text label
- Lightweight, minimal visual clutter

**STANDARD (default):**
- Crosshair marker + circle + label box
- Connector line from marker to label
- Balanced visibility and information

**DETAILED:**
- Full crosshair + circle + status text
- Confidence bar indicator
- Maximum information display

**GAMING:**
- Animated pulsing circles
- Diamond markers
- Colorful, high-visibility style

#### Opacity Transitions

Annotations smoothly fade based on tracking status:
- **TRACKING:** `opacity = 1.0` (fully visible)
- **OCCLUDED:** `opacity = 0.3` (ghost mode)
- **LOST/SEARCHING:** `opacity = 0.0` (hidden)

Uses exponential smoothing for gradual transitions (transition speed: 0.15).

---

## Smart Padding (CoTracker Compatibility)

**Problem:** CoTracker3 requires input dimensions divisible by 16 (stride=16).

**Solution:** `SmartPadding` class:
1. Pads frame symmetrically to nearest multiple of 16
2. Converts coordinates between padded and original space
3. Uses `BORDER_REFLECT` padding to avoid edge artifacts

**Why not resize?**
Resizing distorts image and degrades tracking accuracy. Padding preserves original resolution.

---

## Performance Characteristics

### Latency (per frame, 640x480 input)
- **CoTracker3 (GPU):** ~15-30ms
- **Optical Flow (CPU):** ~5-10ms
- **Rendering:** ~1-2ms

### Throughput
- **Real-time capable:** Yes, 30+ FPS with CoTracker3 on GPU
- **CPU fallback:** ~60 FPS with optical flow

### Memory
- **CoTracker3:** ~2GB VRAM
- **Optical Flow:** ~100MB RAM

---

## Extension Points

### Adding New Tracking Methods

Implement tracking in `ObjectTracker.update()`:
```python
if self._custom_tracker:
    new_x, new_y, confidence = self._track_custom(frame)
```

### Adding New Annotation Styles

1. Add enum value to `AnnotationStyle`
2. Implement rendering logic in `AnnotationRenderer.render_annotation()`

### Custom Re-Identification

Replace `FeatureExtractor` with custom feature matching algorithm (e.g., deep learning embeddings).

---

## Design Decisions

### Why CoTracker3 for GPU?

- **Point-based tracking** handles texture motion well
- **Multiple points** provide robustness (outliers don't break tracking)
- **GPU acceleration** enables real-time performance

### Why Optical Flow for CPU Fallback?

- **No model loading** - works immediately
- **Low memory** - suitable for embedded devices
- **Reasonable accuracy** - good enough for demo purposes

### Why Edge-Only Re-Identification Search?

- **Computational efficiency** - avoids scanning entire frame
- **Pragmatic** - objects typically re-enter from edges
- **Configurable** - `EDGE_MARGIN` parameter (default: 50px)

---

**Next:** See [MODULES.md](./MODULES.md) for detailed API reference.
