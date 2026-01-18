"""
HoloRay Shapes Module - Relative Anchored Drawing System

All shapes are stored as RELATIVE OFFSETS from the tracked object's center.
When the object moves, the shapes move with it automatically.

Architecture:
┌──────────────────────────────────────────────────────────────────┐
│                        SHAPE SYSTEM                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   Object Center (cx, cy)                                          │
│          │                                                        │
│          ▼                                                        │
│   ┌─────────────────┐                                            │
│   │  RelativeShape  │ ◄── Stores offsets (dx, dy) from center    │
│   │  (BaseShape)    │                                            │
│   └────────┬────────┘                                            │
│            │                                                      │
│   ┌────────┼────────┬────────────┬───────────────┐               │
│   │        │        │            │               │               │
│   ▼        ▼        ▼            ▼               ▼               │
│ Arrow   Circle   Rectangle   Polyline       Polygon              │
│                              (Freehand)                          │
│                                                                   │
│ Rendering: shape.render(frame, cx, cy)                           │
│            → Converts offsets to absolute coords                 │
│            → Draws using OpenCV primitives                       │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

Usage:
    # Create arrow from object
    arrow = RelativeArrow(
        start_offset=(-50, -30),  # 50 left, 30 up from center
        end_offset=(0, 0),        # Points to center
        color=(0, 255, 0),
        thickness=2
    )
    
    # Add to tracker
    tracker.add_drawing(arrow)
    
    # Renders automatically when tracker updates
"""

from abc import ABC, abstractmethod
from typing import Tuple, List, Optional
from dataclasses import dataclass, field
from enum import Enum
import math

import numpy as np
import cv2


class ShapeType(Enum):
    """Types of drawable shapes."""
    ARROW = "arrow"
    CIRCLE = "circle"
    RECTANGLE = "rectangle"
    POLYLINE = "polyline"  # Freehand drawing
    POLYGON = "polygon"
    LINE = "line"
    TEXT = "text"


@dataclass
class BaseShape(ABC):
    """
    Abstract base class for all relative shapes.
    
    All coordinates are stored as OFFSETS (dx, dy) from the object center.
    When rendering, the object's current center (cx, cy) is added to get
    absolute screen coordinates.
    
    Attributes:
        color: BGR color tuple
        thickness: Line thickness (-1 for filled)
        opacity: Transparency (0.0 to 1.0)
        visible: Whether to render the shape
        label: Optional text label for this shape (can be set by AI)
        label_offset: Offset for label rendering from shape center
    """
    color: Tuple[int, int, int] = (0, 255, 128)  # Green
    thickness: int = 2
    opacity: float = 1.0
    visible: bool = True
    label: str = ""  # Optional label (can be set by AI identification)
    label_offset: Tuple[float, float] = (10.0, -10.0)  # Offset for label text
    
    @abstractmethod
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        """
        Render the shape onto the frame.
        
        Args:
            frame: BGR image to draw on
            cx, cy: Object center in screen coordinates
            
        Returns:
            Frame with shape drawn (may be modified in place)
        """
        pass
    
    @abstractmethod
    def get_bounds(self) -> Tuple[float, float, float, float]:
        """
        Get bounding box of shape in relative coordinates.
        
        Returns:
            (min_dx, min_dy, max_dx, max_dy)
        """
        pass
    
    def _apply_opacity(self, frame: np.ndarray, overlay: np.ndarray) -> np.ndarray:
        """Blend overlay with opacity onto frame."""
        if self.opacity >= 1.0:
            return overlay
        return cv2.addWeighted(overlay, self.opacity, frame, 1.0 - self.opacity, 0)
    
    def _to_absolute(self, offset: Tuple[float, float], center: Tuple[float, float]) -> Tuple[int, int]:
        """Convert relative offset to absolute screen coordinates."""
        return (int(center[0] + offset[0]), int(center[1] + offset[1]))
    
    def _render_label(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        """Render the label text near the shape center if set."""
        if not self.label:
            return frame
        
        # Get label position
        label_x = int(cx + self.label_offset[0])
        label_y = int(cy + self.label_offset[1])
        
        # Get text size for background
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.5
        thickness = 1
        (text_w, text_h), baseline = cv2.getTextSize(self.label, font, font_scale, thickness)
        
        # Draw background
        padding = 3
        bg_pt1 = (label_x - padding, label_y - text_h - padding)
        bg_pt2 = (label_x + text_w + padding, label_y + padding)
        
        if self.opacity < 1.0:
            overlay = frame.copy()
            cv2.rectangle(overlay, bg_pt1, bg_pt2, (0, 0, 0), -1)
            frame = cv2.addWeighted(overlay, self.opacity * 0.7, frame, 1 - self.opacity * 0.7, 0)
        else:
            cv2.rectangle(frame, bg_pt1, bg_pt2, (0, 0, 0), -1)
        
        # Draw text
        text_color = (255, 255, 255) if self.opacity >= 0.5 else (180, 180, 180)
        cv2.putText(frame, self.label, (label_x, label_y), font, font_scale, text_color, thickness, cv2.LINE_AA)
        
        return frame
    
    def get_center_offset(self) -> Tuple[float, float]:
        """Get the center offset of this shape (for AI cropping)."""
        bounds = self.get_bounds()
        center_dx = (bounds[0] + bounds[2]) / 2
        center_dy = (bounds[1] + bounds[3]) / 2
        return (center_dx, center_dy)


@dataclass
class RelativeArrow(BaseShape):
    """
    Arrow shape with relative start and end points.
    
    Perfect for pointing AT the object or FROM the object.
    
    Example:
        # Arrow pointing TO object from top-left
        arrow = RelativeArrow(
            start_offset=(-80, -60),
            end_offset=(0, 0),
            color=(0, 255, 0)
        )
    """
    start_offset: Tuple[float, float] = (-50.0, -50.0)
    end_offset: Tuple[float, float] = (0.0, 0.0)
    tip_length: float = 0.3
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible:
            return frame
        
        start = self._to_absolute(self.start_offset, (cx, cy))
        end = self._to_absolute(self.end_offset, (cx, cy))
        
        cv2.arrowedLine(
            frame, start, end, self.color, self.thickness,
            cv2.LINE_AA, tipLength=self.tip_length
        )
        return frame
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        return (
            min(self.start_offset[0], self.end_offset[0]),
            min(self.start_offset[1], self.end_offset[1]),
            max(self.start_offset[0], self.end_offset[0]),
            max(self.start_offset[1], self.end_offset[1])
        )


@dataclass
class RelativeCircle(BaseShape):
    """
    Circle shape with relative center offset.
    
    Example:
        # Circle around object
        circle = RelativeCircle(
            center_offset=(0, 0),
            radius=50,
            color=(255, 0, 0),
            filled=False
        )
    """
    center_offset: Tuple[float, float] = (0.0, 0.0)
    radius: float = 30.0
    filled: bool = False
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible:
            return frame
        
        center = self._to_absolute(self.center_offset, (cx, cy))
        thickness = -1 if self.filled else self.thickness
        
        if self.opacity < 1.0:
            overlay = frame.copy()
            cv2.circle(overlay, center, int(self.radius), self.color, thickness, cv2.LINE_AA)
            frame = self._apply_opacity(frame, overlay)
        else:
            cv2.circle(frame, center, int(self.radius), self.color, thickness, cv2.LINE_AA)
        
        return frame
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        dx, dy = self.center_offset
        r = self.radius
        return (dx - r, dy - r, dx + r, dy + r)


@dataclass
class RelativeRectangle(BaseShape):
    """
    Rectangle shape with relative corner offsets.
    
    Can be defined by:
    - top_left_offset + bottom_right_offset (two corners)
    - OR top_left_offset + size (width, height)
    
    Example:
        # Bounding box around object
        rect = RelativeRectangle(
            top_left_offset=(-40, -40),
            bottom_right_offset=(40, 40),
            color=(0, 255, 255)
        )
    """
    top_left_offset: Tuple[float, float] = (-30.0, -30.0)
    bottom_right_offset: Tuple[float, float] = (30.0, 30.0)
    filled: bool = False
    corner_radius: int = 0  # Rounded corners (0 = sharp)
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible:
            return frame
        
        pt1 = self._to_absolute(self.top_left_offset, (cx, cy))
        pt2 = self._to_absolute(self.bottom_right_offset, (cx, cy))
        thickness = -1 if self.filled else self.thickness
        
        if self.opacity < 1.0:
            overlay = frame.copy()
            cv2.rectangle(overlay, pt1, pt2, self.color, thickness, cv2.LINE_AA)
            frame = self._apply_opacity(frame, overlay)
        else:
            cv2.rectangle(frame, pt1, pt2, self.color, thickness, cv2.LINE_AA)
        
        return frame
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        return (
            min(self.top_left_offset[0], self.bottom_right_offset[0]),
            min(self.top_left_offset[1], self.bottom_right_offset[1]),
            max(self.top_left_offset[0], self.bottom_right_offset[0]),
            max(self.top_left_offset[1], self.bottom_right_offset[1])
        )


@dataclass
class RelativeLine(BaseShape):
    """
    Simple line shape (arrow without tip).
    """
    start_offset: Tuple[float, float] = (0.0, 0.0)
    end_offset: Tuple[float, float] = (50.0, 50.0)
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible:
            return frame
        
        start = self._to_absolute(self.start_offset, (cx, cy))
        end = self._to_absolute(self.end_offset, (cx, cy))
        
        cv2.line(frame, start, end, self.color, self.thickness, cv2.LINE_AA)
        return frame
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        return (
            min(self.start_offset[0], self.end_offset[0]),
            min(self.start_offset[1], self.end_offset[1]),
            max(self.start_offset[0], self.end_offset[0]),
            max(self.start_offset[1], self.end_offset[1])
        )


@dataclass
class RelativePolyline(BaseShape):
    """
    Freehand/Abstract drawing as connected line segments.
    
    Perfect for user-drawn annotations that follow the object.
    
    The points list contains OFFSETS from the object center:
    points = [(dx1, dy1), (dx2, dy2), ...]
    
    Example:
        # Freehand scribble
        polyline = RelativePolyline(
            points=[(-20, -10), (-10, 5), (0, -3), (15, 8)],
            color=(255, 0, 255),
            closed=False
        )
    """
    points: List[Tuple[float, float]] = field(default_factory=list)
    closed: bool = False
    smooth: bool = False  # Apply curve smoothing
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible or len(self.points) < 2:
            return frame
        
        # Convert relative points to absolute
        abs_points = np.array([
            self._to_absolute(pt, (cx, cy)) for pt in self.points
        ], dtype=np.int32)
        
        if self.smooth and len(abs_points) > 3:
            # Apply curve smoothing using approximation
            epsilon = 0.01 * cv2.arcLength(abs_points, self.closed)
            abs_points = cv2.approxPolyDP(abs_points, epsilon, self.closed)
        
        abs_points = abs_points.reshape((-1, 1, 2))
        
        if self.opacity < 1.0:
            overlay = frame.copy()
            cv2.polylines(overlay, [abs_points], self.closed, self.color, 
                         self.thickness, cv2.LINE_AA)
            frame = self._apply_opacity(frame, overlay)
        else:
            cv2.polylines(frame, [abs_points], self.closed, self.color,
                         self.thickness, cv2.LINE_AA)
        
        # Render label if set
        frame = self._render_label(frame, cx, cy)
        
        return frame
    
    def add_point(self, dx: float, dy: float):
        """Add a point to the polyline."""
        self.points.append((dx, dy))
    
    def simplify(self, epsilon: float = 2.0):
        """
        Reduce point count while preserving shape.
        
        Useful after freehand drawing to reduce memory/rendering cost.
        """
        if len(self.points) < 3:
            return
        
        pts = np.array(self.points, dtype=np.float32).reshape(-1, 1, 2)
        simplified = cv2.approxPolyDP(pts, epsilon, self.closed)
        self.points = [(float(p[0][0]), float(p[0][1])) for p in simplified]
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        if not self.points:
            return (0, 0, 0, 0)
        xs = [p[0] for p in self.points]
        ys = [p[1] for p in self.points]
        return (min(xs), min(ys), max(xs), max(ys))


@dataclass
class RelativePolygon(BaseShape):
    """
    Closed polygon shape.
    
    Similar to Polyline but always closed and can be filled.
    """
    vertices: List[Tuple[float, float]] = field(default_factory=list)
    filled: bool = False
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible or len(self.vertices) < 3:
            return frame
        
        abs_points = np.array([
            self._to_absolute(v, (cx, cy)) for v in self.vertices
        ], dtype=np.int32)
        
        if self.opacity < 1.0:
            overlay = frame.copy()
            if self.filled:
                cv2.fillPoly(overlay, [abs_points], self.color, cv2.LINE_AA)
            else:
                cv2.polylines(overlay, [abs_points], True, self.color,
                             self.thickness, cv2.LINE_AA)
            frame = self._apply_opacity(frame, overlay)
        else:
            if self.filled:
                cv2.fillPoly(frame, [abs_points], self.color, cv2.LINE_AA)
            else:
                cv2.polylines(frame, [abs_points], True, self.color,
                             self.thickness, cv2.LINE_AA)
        
        return frame
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        if not self.vertices:
            return (0, 0, 0, 0)
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        return (min(xs), min(ys), max(xs), max(ys))


@dataclass
class RelativeText(BaseShape):
    """
    Text label at relative offset.
    """
    text: str = "Label"
    offset: Tuple[float, float] = (0.0, -50.0)  # Above center by default
    font: int = cv2.FONT_HERSHEY_SIMPLEX
    font_scale: float = 0.7
    background: bool = True
    bg_color: Tuple[int, int, int] = (0, 0, 0)
    padding: int = 5
    
    def render(self, frame: np.ndarray, cx: float, cy: float) -> np.ndarray:
        if not self.visible or not self.text:
            return frame
        
        pos = self._to_absolute(self.offset, (cx, cy))
        
        # Get text size
        (text_w, text_h), baseline = cv2.getTextSize(
            self.text, self.font, self.font_scale, self.thickness
        )
        
        # Background box
        if self.background:
            bg_pt1 = (pos[0] - self.padding, pos[1] - text_h - self.padding)
            bg_pt2 = (pos[0] + text_w + self.padding, pos[1] + self.padding)
            
            if self.opacity < 1.0:
                overlay = frame.copy()
                cv2.rectangle(overlay, bg_pt1, bg_pt2, self.bg_color, -1)
                frame = cv2.addWeighted(overlay, self.opacity * 0.7, frame, 1 - self.opacity * 0.7, 0)
            else:
                cv2.rectangle(frame, bg_pt1, bg_pt2, self.bg_color, -1)
        
        # Text
        cv2.putText(frame, self.text, pos, self.font, self.font_scale,
                   self.color, self.thickness, cv2.LINE_AA)
        
        return frame
    
    def get_bounds(self) -> Tuple[float, float, float, float]:
        # Approximate bounds
        w = len(self.text) * 10 * self.font_scale
        h = 20 * self.font_scale
        dx, dy = self.offset
        return (dx, dy - h, dx + w, dy)


class DrawingCollection:
    """
    Collection of shapes attached to a tracked object.
    
    Manages rendering order, visibility, and batch operations.
    """
    
    def __init__(self):
        self._shapes: List[BaseShape] = []
    
    def add(self, shape: BaseShape):
        """Add a shape to the collection."""
        self._shapes.append(shape)
    
    def remove(self, shape: BaseShape):
        """Remove a shape from the collection."""
        if shape in self._shapes:
            self._shapes.remove(shape)
    
    def clear(self):
        """Remove all shapes."""
        self._shapes.clear()
    
    def render_all(self, frame: np.ndarray, cx: float, cy: float, 
                   opacity_override: Optional[float] = None) -> np.ndarray:
        """
        Render all shapes onto the frame.
        
        Args:
            frame: Target frame
            cx, cy: Object center
            opacity_override: If set, applies to all shapes
        """
        for shape in self._shapes:
            if shape.visible:
                if opacity_override is not None:
                    original_opacity = shape.opacity
                    shape.opacity = opacity_override
                    frame = shape.render(frame, cx, cy)
                    shape.opacity = original_opacity
                else:
                    frame = shape.render(frame, cx, cy)
        return frame
    
    def set_all_visible(self, visible: bool):
        """Set visibility of all shapes."""
        for shape in self._shapes:
            shape.visible = visible
    
    def set_all_opacity(self, opacity: float):
        """Set opacity of all shapes."""
        for shape in self._shapes:
            shape.opacity = opacity
    
    @property
    def shapes(self) -> List[BaseShape]:
        return self._shapes
    
    @property
    def count(self) -> int:
        return len(self._shapes)
    
    def __len__(self) -> int:
        return len(self._shapes)
    
    def __iter__(self):
        return iter(self._shapes)


# ============================================================================
# FACTORY FUNCTIONS - Quick shape creation
# ============================================================================

def create_pointer_arrow(
    from_offset: Tuple[float, float] = (-80, -60),
    color: Tuple[int, int, int] = (0, 255, 128),
    thickness: int = 2
) -> RelativeArrow:
    """Create an arrow pointing TO the object center."""
    return RelativeArrow(
        start_offset=from_offset,
        end_offset=(0, 0),
        color=color,
        thickness=thickness
    )


def create_highlight_circle(
    radius: float = 40,
    color: Tuple[int, int, int] = (0, 255, 255),
    thickness: int = 2
) -> RelativeCircle:
    """Create a circle highlight around the object."""
    return RelativeCircle(
        center_offset=(0, 0),
        radius=radius,
        color=color,
        thickness=thickness,
        filled=False
    )


def create_bounding_box(
    half_width: float = 50,
    half_height: float = 50,
    color: Tuple[int, int, int] = (255, 0, 128),
    thickness: int = 2
) -> RelativeRectangle:
    """Create a centered bounding box."""
    return RelativeRectangle(
        top_left_offset=(-half_width, -half_height),
        bottom_right_offset=(half_width, half_height),
        color=color,
        thickness=thickness,
        filled=False
    )


def create_label(
    text: str,
    offset: Tuple[float, float] = (20, -20),
    color: Tuple[int, int, int] = (255, 255, 255)
) -> RelativeText:
    """Create a text label near the object."""
    return RelativeText(
        text=text,
        offset=offset,
        color=color,
        background=True
    )


# ============================================================================
# DRAWING MODE - State machine for interactive drawing
# ============================================================================

class DrawingMode(Enum):
    """Available drawing modes."""
    NONE = "none"
    ARROW = "arrow"
    CIRCLE = "circle"
    RECTANGLE = "rectangle"
    FREEHAND = "freehand"
    LINE = "line"


class InteractiveDrawer:
    """
    State machine for interactive shape drawing.
    
    Handles mouse events and creates shapes relative to a tracked object.
    
    Usage:
        drawer = InteractiveDrawer()
        drawer.set_mode(DrawingMode.ARROW)
        
        # In mouse callback:
        if event == cv2.EVENT_LBUTTONDOWN:
            drawer.start_drawing(mouse_x, mouse_y, object_cx, object_cy)
        elif event == cv2.EVENT_MOUSEMOVE and drawer.is_drawing:
            drawer.update_drawing(mouse_x, mouse_y, object_cx, object_cy)
        elif event == cv2.EVENT_LBUTTONUP:
            shape = drawer.finish_drawing()
            if shape:
                tracker.add_drawing(shape)
    """
    
    def __init__(self):
        self.mode = DrawingMode.NONE
        self.is_drawing = False
        self.color = (0, 255, 128)  # Default green
        self.thickness = 2
        
        # Drawing state
        self._anchor_cx = 0.0  # Object center when drawing started
        self._anchor_cy = 0.0
        self._start_offset = (0.0, 0.0)
        self._current_offset = (0.0, 0.0)
        self._freehand_points: List[Tuple[float, float]] = []
        
        # Current temporary shape (for preview)
        self._temp_shape: Optional[BaseShape] = None
    
    def set_mode(self, mode: DrawingMode):
        """Set the drawing mode."""
        self.mode = mode
        self.cancel_drawing()
    
    def set_color(self, color: Tuple[int, int, int]):
        """Set drawing color."""
        self.color = color
    
    def start_drawing(self, mouse_x: float, mouse_y: float, 
                      object_cx: float, object_cy: float):
        """
        Start a new drawing operation.
        
        Args:
            mouse_x, mouse_y: Current mouse position
            object_cx, object_cy: Tracked object center
        """
        if self.mode == DrawingMode.NONE:
            return
        
        self.is_drawing = True
        self._anchor_cx = object_cx
        self._anchor_cy = object_cy
        
        # Calculate relative offset from object center
        self._start_offset = (mouse_x - object_cx, mouse_y - object_cy)
        self._current_offset = self._start_offset
        
        if self.mode == DrawingMode.FREEHAND:
            self._freehand_points = [self._start_offset]
        
        self._update_temp_shape()
    
    def update_drawing(self, mouse_x: float, mouse_y: float,
                       object_cx: float, object_cy: float):
        """
        Update drawing with new mouse position.
        
        Note: We use the ORIGINAL anchor position, not current object position.
        This ensures smooth drawing even if the object moves during drawing.
        """
        if not self.is_drawing:
            return
        
        # Calculate offset relative to ANCHOR (where we started)
        self._current_offset = (mouse_x - self._anchor_cx, mouse_y - self._anchor_cy)
        
        if self.mode == DrawingMode.FREEHAND:
            self._freehand_points.append(self._current_offset)
        
        self._update_temp_shape()
    
    def finish_drawing(self) -> Optional[BaseShape]:
        """
        Finish drawing and return the completed shape.
        
        Returns:
            Completed shape, or None if cancelled/invalid
        """
        if not self.is_drawing:
            return None
        
        self.is_drawing = False
        shape = self._temp_shape
        self._temp_shape = None
        
        # Validate shape
        if shape is None:
            return None
        
        if isinstance(shape, RelativePolyline):
            shape.simplify(epsilon=3.0)  # Reduce point count
            if len(shape.points) < 2:
                return None
        
        return shape
    
    def cancel_drawing(self):
        """Cancel current drawing operation."""
        self.is_drawing = False
        self._temp_shape = None
        self._freehand_points = []
    
    def get_preview(self) -> Optional[BaseShape]:
        """Get temporary shape for preview rendering."""
        return self._temp_shape if self.is_drawing else None
    
    def render_preview(self, frame: np.ndarray, object_cx: float, object_cy: float) -> np.ndarray:
        """Render preview of current drawing."""
        if self._temp_shape and self.is_drawing:
            # Render with reduced opacity
            self._temp_shape.opacity = 0.7
            frame = self._temp_shape.render(frame, object_cx, object_cy)
            self._temp_shape.opacity = 1.0
        return frame
    
    def _update_temp_shape(self):
        """Update the temporary shape based on current state."""
        if self.mode == DrawingMode.ARROW:
            self._temp_shape = RelativeArrow(
                start_offset=self._start_offset,
                end_offset=self._current_offset,
                color=self.color,
                thickness=self.thickness
            )
        
        elif self.mode == DrawingMode.LINE:
            self._temp_shape = RelativeLine(
                start_offset=self._start_offset,
                end_offset=self._current_offset,
                color=self.color,
                thickness=self.thickness
            )
        
        elif self.mode == DrawingMode.CIRCLE:
            # Circle from start to current (radius = distance)
            dx = self._current_offset[0] - self._start_offset[0]
            dy = self._current_offset[1] - self._start_offset[1]
            radius = math.sqrt(dx*dx + dy*dy)
            
            self._temp_shape = RelativeCircle(
                center_offset=self._start_offset,
                radius=max(5, radius),
                color=self.color,
                thickness=self.thickness,
                filled=False
            )
        
        elif self.mode == DrawingMode.RECTANGLE:
            self._temp_shape = RelativeRectangle(
                top_left_offset=self._start_offset,
                bottom_right_offset=self._current_offset,
                color=self.color,
                thickness=self.thickness,
                filled=False
            )
        
        elif self.mode == DrawingMode.FREEHAND:
            self._temp_shape = RelativePolyline(
                points=list(self._freehand_points),
                color=self.color,
                thickness=self.thickness,
                closed=False
            )


# ============================================================================
# TEST
# ============================================================================

if __name__ == "__main__":
    print("Testing HoloRay Shapes Module...")
    
    # Create test frame
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:] = (40, 40, 40)
    
    # Object center
    cx, cy = 320, 240
    cv2.circle(frame, (cx, cy), 5, (255, 255, 255), -1)
    
    # Create shapes
    arrow = create_pointer_arrow(from_offset=(-80, -60))
    circle = create_highlight_circle(radius=50, color=(255, 255, 0))
    rect = create_bounding_box(half_width=60, half_height=40)
    label = create_label("Chess Piece", offset=(70, -30))
    
    freehand = RelativePolyline(
        points=[(-30, 60), (-10, 80), (20, 70), (50, 90), (40, 110)],
        color=(255, 0, 255),
        thickness=3
    )
    
    # Render all
    frame = arrow.render(frame, cx, cy)
    frame = circle.render(frame, cx, cy)
    frame = rect.render(frame, cx, cy)
    frame = label.render(frame, cx, cy)
    frame = freehand.render(frame, cx, cy)
    
    # Add mode indicator
    cv2.putText(frame, "Shapes Test", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                0.8, (255, 255, 255), 2, cv2.LINE_AA)
    
    # Show
    cv2.imshow("HoloRay Shapes", frame)
    print("Press any key to test animation...")
    cv2.waitKey(0)
    
    # Animate - object moves, shapes follow
    for i in range(60):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[:] = (40, 40, 40)
        
        # Moving center
        cx = 200 + int(200 * math.sin(i * 0.1))
        cy = 200 + int(100 * math.cos(i * 0.1))
        
        cv2.circle(frame, (cx, cy), 5, (255, 255, 255), -1)
        
        frame = arrow.render(frame, cx, cy)
        frame = circle.render(frame, cx, cy)
        frame = rect.render(frame, cx, cy)
        frame = label.render(frame, cx, cy)
        frame = freehand.render(frame, cx, cy)
        
        cv2.putText(frame, f"Frame {i}: Center ({cx}, {cy})", (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        
        cv2.imshow("HoloRay Shapes", frame)
        if cv2.waitKey(50) == ord('q'):
            break
    
    cv2.destroyAllWindows()
    print("Test complete!")
