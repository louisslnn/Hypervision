"""
HoloRay - Tracking & Annotation Engine for AR Applications

A modular SDK for real-time object tracking with sticky annotations.
Designed for integration with AR/VR applications like the VR Chess App.

Features:
- Zero-latency threaded video capture
- Point tracking with CoTracker3 (GPU) or optical flow (CPU)
- Smart occlusion detection
- Object re-identification on frame re-entry
- Smooth, animated annotation rendering

Quick Start:
    from holoray import TrackerManager, AnnotationRenderer, ThreadedVideoCapture

    # Setup video
    video = ThreadedVideoCapture(source=0)
    video.start()

    # Setup tracking
    tracker_manager = TrackerManager()
    renderer = AnnotationRenderer()

    # Track an object
    frame = video.latest_frame
    tracker_id = tracker_manager.create_tracker(frame, x=320, y=240, label="Object")
    renderer.create_annotation(tracker_id, label="Object", x=320, y=240)

    # Update loop
    while True:
        frame = video.latest_frame
        states = tracker_manager.update_all(frame)
        frame = renderer.render_all(frame, states)
        display(frame)
"""

__version__ = "1.0.0"
__author__ = "HoloRay Team - McHacks 13"

# Core tracking - Ultimate Hybrid Engine
from .holoray_core import (
    # Main tracker classes
    UltimateHybridTracker,
    TrackerManager,
    TrackingStatus,
    TrackingState,
    LabelStatus,  # AI labeling status
    # Core components
    VisualDNA,
    MagneticOpticalFlow,
    RANSACMatcher,
    # Backward compatibility
    ObjectTracker,
    HybridTracker,
    VisualFingerprint,
    VisualMemory,
    FeatureMatcher,
    FastOpticalFlow,
    PerformanceOverlay as CorePerformanceOverlay,
)

# AI Labeling - Gemini-powered object identification
from .ai_labeler import (
    AILabeler,
    LabelStatus as AILabelStatus,
    get_labeler,
    identify_object,
)

# Video pipeline
from .video_pipeline import (
    ThreadedVideoCapture,
    VideoFileReader,
    FrameProcessor,
    FrameMetadata,
    VideoSource,
    PerformanceOverlay,
)

# Annotation rendering
from .annotation_layer import (
    Annotation,
    AnnotationRenderer,
    AnnotationStyle,
    ColorScheme,
    draw_tracking_annotation,
    # Shape Engine (legacy)
    ShapeType as LegacyShapeType,
    RelativeShape as LegacyRelativeShape,
    ShapeEngine,
    create_pointer_arrow as legacy_create_pointer_arrow,
    create_highlight_circle as legacy_create_highlight_circle,
    create_bounding_box as legacy_create_bounding_box,
)

# Shapes module - Multi-shape drawing with relative anchoring
from .shapes import (
    # Base classes
    BaseShape,
    ShapeType,
    DrawingMode,
    DrawingCollection,
    # Shape types
    RelativeArrow,
    RelativeCircle,
    RelativeRectangle,
    RelativeLine,
    RelativePolyline,
    RelativePolygon,
    RelativeText,
    # Factory functions
    create_pointer_arrow,
    create_highlight_circle,
    create_bounding_box,
    create_label,
    # Interactive drawing
    InteractiveDrawer,
)

__all__ = [
    # Version
    "__version__",

    # Core Tracking - Ultimate Hybrid Engine
    "UltimateHybridTracker",
    "TrackerManager",
    "TrackingStatus",
    "TrackingState",
    "LabelStatus",
    "VisualDNA",
    "MagneticOpticalFlow",
    "RANSACMatcher",
    
    # AI Labeling
    "AILabeler",
    "get_labeler",
    "identify_object",
    
    # Backward compatibility
    "ObjectTracker",
    "HybridTracker",
    "VisualFingerprint",
    "VisualMemory",
    "FeatureMatcher",
    "FastOpticalFlow",

    # Video
    "ThreadedVideoCapture",
    "VideoFileReader",
    "FrameProcessor",
    "FrameMetadata",
    "VideoSource",
    "PerformanceOverlay",

    # Annotation
    "Annotation",
    "AnnotationRenderer",
    "AnnotationStyle",
    "ColorScheme",
    "draw_tracking_annotation",
    "ShapeEngine",
    
    # Shapes Module - Multi-shape drawing
    "BaseShape",
    "ShapeType",
    "DrawingMode",
    "DrawingCollection",
    "RelativeArrow",
    "RelativeCircle",
    "RelativeRectangle",
    "RelativeLine",
    "RelativePolyline",
    "RelativePolygon",
    "RelativeText",
    "create_pointer_arrow",
    "create_highlight_circle",
    "create_bounding_box",
    "create_label",
    "InteractiveDrawer",
]
