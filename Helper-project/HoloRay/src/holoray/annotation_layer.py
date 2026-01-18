"""
HoloRay Annotation Layer - Visual Overlay System with Shape Engine

Renders clean, anti-aliased annotations that respond to tracking state:
- Full opacity when actively tracking
- Ghost mode (faded) when occluded  
- Hidden when lost

Shape Engine:
- Supports Arrows, Circles, Rectangles relative to tracked object
- Shapes translate/rotate/scale with the object
- Relative coordinates (Δx, Δy) from object center
"""

import time
import math
from typing import Optional, Tuple, List, Dict, Union
from dataclasses import dataclass, field
from enum import Enum

import numpy as np
import cv2

from .holoray_core import TrackingStatus, TrackingState


class AnnotationStyle(Enum):
    """Predefined annotation styles."""
    MINIMAL = "minimal"        # Just a dot and label
    STANDARD = "standard"      # Crosshair + label + confidence
    DETAILED = "detailed"      # Full box, arrow, metrics
    GAMING = "gaming"          # Colorful, animated


class ShapeType(Enum):
    """Types of shapes that can be attached to annotations."""
    ARROW = "arrow"
    CIRCLE = "circle"
    RECTANGLE = "rectangle"
    LINE = "line"
    POLYGON = "polygon"


@dataclass
class ColorScheme:
    """Color scheme for annotations."""
    primary: Tuple[int, int, int] = (0, 255, 128)     # Green
    secondary: Tuple[int, int, int] = (255, 255, 0)   # Cyan
    warning: Tuple[int, int, int] = (0, 165, 255)     # Orange
    error: Tuple[int, int, int] = (0, 0, 255)         # Red
    text: Tuple[int, int, int] = (255, 255, 255)      # White
    background: Tuple[int, int, int] = (0, 0, 0)      # Black


@dataclass
class RelativeShape:
    """
    A geometric shape defined relative to the object center.
    
    All coordinates are offsets (Δx, Δy) from the object center (0, 0).
    When rendering, the object's global position (X, Y) is added.
    
    Supports:
    - Translation with object movement
    - Rotation (if tracking provides rotation)
    - Scale (if tracking provides scale)
    
    Examples:
        # Arrow pointing to object from top-left
        arrow = RelativeShape(
            shape_type=ShapeType.ARROW,
            start=(-50, -50),  # 50 pixels up and left
            end=(0, 0),        # Points to center
        )
        
        # Circle around object
        circle = RelativeShape(
            shape_type=ShapeType.CIRCLE,
            center=(0, 0),     # Centered on object
            radius=30,
        )
        
        # Bounding rectangle
        rect = RelativeShape(
            shape_type=ShapeType.RECTANGLE,
            top_left=(-40, -40),
            size=(80, 80),
        )
    """
    shape_type: ShapeType
    
    # Common properties
    color: Tuple[int, int, int] = (0, 255, 128)
    thickness: int = 2
    filled: bool = False
    
    # Arrow properties
    start: Tuple[float, float] = (0.0, 0.0)
    end: Tuple[float, float] = (0.0, 0.0)
    tip_length: float = 0.3
    
    # Circle properties
    center: Tuple[float, float] = (0.0, 0.0)
    radius: float = 20.0
    
    # Rectangle properties
    top_left: Tuple[float, float] = (0.0, 0.0)
    size: Tuple[float, float] = (50.0, 50.0)
    
    # Line properties (same as arrow without tip)
    
    # Polygon properties
    vertices: List[Tuple[float, float]] = field(default_factory=list)
    
    # Animation
    pulse: bool = False
    pulse_amplitude: float = 3.0


class ShapeEngine:
    """
    Shape Engine - Renders geometric shapes relative to tracked objects.
    
    Converts relative coordinates to absolute positions and handles:
    - Translation (object moved)
    - Rotation (object rotated)
    - Scale (object scaled)
    - Opacity (fading based on tracking state)
    """
    
    @staticmethod
    def transform_point(
        rel_point: Tuple[float, float],
        center: Tuple[float, float],
        scale: float = 1.0,
        rotation: float = 0.0
    ) -> Tuple[int, int]:
        """
        Transform a relative point to absolute screen coordinates.
        
        Args:
            rel_point: Relative offset (Δx, Δy) from center
            center: Object center in screen coordinates (X, Y)
            scale: Scale factor
            rotation: Rotation angle in radians
            
        Returns:
            Absolute screen position (x, y)
        """
        dx, dy = rel_point
        
        # Apply scale
        dx *= scale
        dy *= scale
        
        # Apply rotation
        if rotation != 0:
            cos_r = math.cos(rotation)
            sin_r = math.sin(rotation)
            new_dx = dx * cos_r - dy * sin_r
            new_dy = dx * sin_r + dy * cos_r
            dx, dy = new_dx, new_dy
        
        # Add center offset
        abs_x = center[0] + dx
        abs_y = center[1] + dy
        
        return (int(abs_x), int(abs_y))
    
    @staticmethod
    def blend_color(
        color: Tuple[int, int, int],
        opacity: float
    ) -> Tuple[int, int, int]:
        """Blend color with opacity."""
        return tuple(int(c * opacity) for c in color)
    
    def render_shape(
        self,
        frame: np.ndarray,
        shape: RelativeShape,
        center: Tuple[float, float],
        opacity: float = 1.0,
        scale: float = 1.0,
        rotation: float = 0.0,
        pulse_phase: float = 0.0
    ):
        """
        Render a shape onto the frame.
        
        Args:
            frame: Target frame
            shape: Shape definition
            center: Object center position
            opacity: Current opacity (0.0 to 1.0)
            scale: Object scale
            rotation: Object rotation (radians)
            pulse_phase: Animation phase for pulsing
        """
        if opacity < 0.05:
            return
        
        color = self.blend_color(shape.color, opacity)
        thickness = shape.thickness
        
        # Apply pulse animation
        pulse_offset = 0
        if shape.pulse:
            pulse_offset = int(shape.pulse_amplitude * math.sin(pulse_phase))
        
        if shape.shape_type == ShapeType.ARROW:
            start = self.transform_point(shape.start, center, scale, rotation)
            end = self.transform_point(shape.end, center, scale, rotation)
            cv2.arrowedLine(
                frame, start, end, color, thickness,
                cv2.LINE_AA, tipLength=shape.tip_length
            )
        
        elif shape.shape_type == ShapeType.CIRCLE:
            center_pt = self.transform_point(shape.center, center, scale, rotation)
            radius = int(shape.radius * scale) + pulse_offset
            if shape.filled:
                cv2.circle(frame, center_pt, radius, color, -1, cv2.LINE_AA)
            else:
                cv2.circle(frame, center_pt, radius, color, thickness, cv2.LINE_AA)
        
        elif shape.shape_type == ShapeType.RECTANGLE:
            # Transform corners
            tl = shape.top_left
            w, h = shape.size
            tr = (tl[0] + w, tl[1])
            br = (tl[0] + w, tl[1] + h)
            bl = (tl[0], tl[1] + h)
            
            pts = np.array([
                self.transform_point(tl, center, scale, rotation),
                self.transform_point(tr, center, scale, rotation),
                self.transform_point(br, center, scale, rotation),
                self.transform_point(bl, center, scale, rotation),
            ], dtype=np.int32)
            
            if shape.filled:
                cv2.fillPoly(frame, [pts], color, cv2.LINE_AA)
            else:
                cv2.polylines(frame, [pts], True, color, thickness, cv2.LINE_AA)
        
        elif shape.shape_type == ShapeType.LINE:
            start = self.transform_point(shape.start, center, scale, rotation)
            end = self.transform_point(shape.end, center, scale, rotation)
            cv2.line(frame, start, end, color, thickness, cv2.LINE_AA)
        
        elif shape.shape_type == ShapeType.POLYGON:
            if len(shape.vertices) >= 3:
                pts = np.array([
                    self.transform_point(v, center, scale, rotation)
                    for v in shape.vertices
                ], dtype=np.int32)
                
                if shape.filled:
                    cv2.fillPoly(frame, [pts], color, cv2.LINE_AA)
                else:
                    cv2.polylines(frame, [pts], True, color, thickness, cv2.LINE_AA)


@dataclass
class Annotation:
    """
    Visual annotation attached to a tracked object.
    
    Attributes:
        label_text: Text to display
        tracker_id: Associated tracker ID
        coordinates: Current (x, y) position
        opacity: Current opacity (0.0 to 1.0)
        target_opacity: Target opacity for smooth transitions
        style: Visual style
        color_scheme: Colors to use
        shapes: List of geometric shapes attached to this annotation
    """
    label_text: str
    tracker_id: str
    coordinates: Tuple[float, float] = (0.0, 0.0)
    opacity: float = 1.0
    target_opacity: float = 1.0
    style: AnnotationStyle = AnnotationStyle.STANDARD
    color_scheme: ColorScheme = field(default_factory=ColorScheme)
    
    # Attached shapes
    shapes: List[RelativeShape] = field(default_factory=list)
    
    # Transform state (from tracking)
    scale: float = 1.0
    rotation: float = 0.0
    
    # Animation state
    _pulse_phase: float = 0.0
    _smooth_x: float = 0.0
    _smooth_y: float = 0.0
    _initialized: bool = False
    
    def add_shape(self, shape: RelativeShape):
        """Add a geometric shape to this annotation."""
        self.shapes.append(shape)
    
    def add_arrow(
        self,
        start: Tuple[float, float],
        end: Tuple[float, float] = (0, 0),
        color: Tuple[int, int, int] = (0, 255, 128),
        thickness: int = 2
    ):
        """Add an arrow pointing to the object."""
        self.shapes.append(RelativeShape(
            shape_type=ShapeType.ARROW,
            start=start,
            end=end,
            color=color,
            thickness=thickness
        ))
    
    def add_circle(
        self,
        radius: float = 30,
        center: Tuple[float, float] = (0, 0),
        color: Tuple[int, int, int] = (0, 255, 128),
        filled: bool = False,
        pulse: bool = False
    ):
        """Add a circle around the object."""
        self.shapes.append(RelativeShape(
            shape_type=ShapeType.CIRCLE,
            center=center,
            radius=radius,
            color=color,
            filled=filled,
            pulse=pulse
        ))
    
    def add_rectangle(
        self,
        width: float = 80,
        height: float = 80,
        color: Tuple[int, int, int] = (0, 255, 128),
        filled: bool = False
    ):
        """Add a centered rectangle around the object."""
        self.shapes.append(RelativeShape(
            shape_type=ShapeType.RECTANGLE,
            top_left=(-width/2, -height/2),
            size=(width, height),
            color=color,
            filled=filled
        ))
    
    def clear_shapes(self):
        """Remove all attached shapes."""
        self.shapes.clear()
    
    def update_position(self, x: float, y: float, smoothing: float = 0.3):
        """Update position with optional smoothing."""
        if not self._initialized:
            self._smooth_x = x
            self._smooth_y = y
            self._initialized = True
        else:
            self._smooth_x += (x - self._smooth_x) * smoothing
            self._smooth_y += (y - self._smooth_y) * smoothing
        self.coordinates = (self._smooth_x, self._smooth_y)
    
    def update_opacity(self, status: TrackingStatus, transition_speed: float = 0.15):
        """
        Update opacity based on tracking status.
        
        Status -> Opacity:
        - TRACKING: 1.0 (fully visible)
        - OCCLUDED: 0.3 (ghost mode)
        - LOST/SEARCHING: 0.0 (hidden)
        """
        if status == TrackingStatus.TRACKING:
            self.target_opacity = 1.0
        elif status == TrackingStatus.OCCLUDED:
            self.target_opacity = 0.3
        else:  # LOST, SEARCHING, INACTIVE
            self.target_opacity = 0.0
        
        # Smooth transition
        self.opacity += (self.target_opacity - self.opacity) * transition_speed
        self.opacity = max(0.0, min(1.0, self.opacity))
    
    def update_transform(self, scale: float = 1.0, rotation: float = 0.0):
        """Update transform state from tracking."""
        self.scale = scale
        self.rotation = rotation
    
    def tick_animation(self, dt: float = 0.033):
        """Update animation state."""
        self._pulse_phase += dt * 3.0  # Pulse frequency
        if self._pulse_phase > 2 * math.pi:
            self._pulse_phase -= 2 * math.pi


class AnnotationRenderer:
    """
    Renders annotations onto video frames.
    
    Features:
    - Anti-aliased drawing
    - Smooth opacity transitions
    - Multiple visual styles
    - Shape Engine integration
    - Performance metrics overlay
    """
    
    def __init__(
        self,
        default_style: AnnotationStyle = AnnotationStyle.STANDARD,
        font: int = cv2.FONT_HERSHEY_SIMPLEX,
        font_scale: float = 0.6,
        thickness: int = 2
    ):
        self.default_style = default_style
        self.font = font
        self.font_scale = font_scale
        self.thickness = thickness
        
        self._annotations: Dict[str, Annotation] = {}
        self._last_time = time.perf_counter()
        
        # Shape engine
        self.shape_engine = ShapeEngine()
    
    def create_annotation(
        self,
        tracker_id: str,
        label: str,
        x: float,
        y: float,
        style: Optional[AnnotationStyle] = None,
        color_scheme: Optional[ColorScheme] = None
    ) -> Annotation:
        """Create and register a new annotation."""
        ann = Annotation(
            label_text=label,
            tracker_id=tracker_id,
            coordinates=(x, y),
            style=style or self.default_style,
            color_scheme=color_scheme or ColorScheme()
        )
        ann._smooth_x = x
        ann._smooth_y = y
        ann._initialized = True
        self._annotations[tracker_id] = ann
        return ann
    
    def get_annotation(self, tracker_id: str) -> Optional[Annotation]:
        """Get annotation by tracker ID."""
        return self._annotations.get(tracker_id)
    
    def update_annotation(
        self,
        tracker_id: str,
        state: TrackingState
    ):
        """Update annotation from tracking state."""
        if tracker_id not in self._annotations:
            return
        
        ann = self._annotations[tracker_id]
        ann.update_position(state.x, state.y)
        ann.update_opacity(state.status)
        ann.update_transform(state.scale, state.rotation)
    
    def remove_annotation(self, tracker_id: str):
        """Remove an annotation."""
        if tracker_id in self._annotations:
            del self._annotations[tracker_id]
    
    def _blend_color(
        self,
        color: Tuple[int, int, int],
        opacity: float
    ) -> Tuple[int, int, int]:
        """Adjust color intensity based on opacity."""
        return tuple(int(c * opacity) for c in color)
    
    def _draw_crosshair(
        self,
        frame: np.ndarray,
        x: int,
        y: int,
        size: int,
        color: Tuple[int, int, int],
        thickness: int = 2
    ):
        """Draw a crosshair marker."""
        # Horizontal line
        cv2.line(frame, (x - size, y), (x + size, y), color, thickness, cv2.LINE_AA)
        # Vertical line
        cv2.line(frame, (x, y - size), (x, y + size), color, thickness, cv2.LINE_AA)
    
    def _draw_circle_marker(
        self,
        frame: np.ndarray,
        x: int,
        y: int,
        radius: int,
        color: Tuple[int, int, int],
        pulse_phase: float = 0.0,
        filled: bool = False
    ):
        """Draw a circle marker with optional pulse animation."""
        # Pulsing radius
        pulse_offset = int(3 * math.sin(pulse_phase))
        actual_radius = radius + pulse_offset
        
        if filled:
            cv2.circle(frame, (x, y), actual_radius, color, -1, cv2.LINE_AA)
        else:
            cv2.circle(frame, (x, y), actual_radius, color, 2, cv2.LINE_AA)
    
    def _draw_label_box(
        self,
        frame: np.ndarray,
        x: int,
        y: int,
        text: str,
        color: Tuple[int, int, int],
        bg_color: Tuple[int, int, int],
        opacity: float,
        offset: Tuple[int, int] = (15, -15)
    ):
        """Draw a label with background box."""
        label_x = x + offset[0]
        label_y = y + offset[1]
        
        # Get text size
        (text_w, text_h), baseline = cv2.getTextSize(
            text, self.font, self.font_scale, self.thickness
        )
        
        # Clamp to frame bounds
        h, w = frame.shape[:2]
        label_x = max(5, min(label_x, w - text_w - 15))
        label_y = max(text_h + 10, min(label_y, h - 10))
        
        # Draw background with opacity
        padding = 5
        overlay = frame.copy()
        cv2.rectangle(
            overlay,
            (label_x - padding, label_y - text_h - padding),
            (label_x + text_w + padding, label_y + padding),
            bg_color,
            -1
        )
        cv2.rectangle(
            overlay,
            (label_x - padding, label_y - text_h - padding),
            (label_x + text_w + padding, label_y + padding),
            color,
            2,
            cv2.LINE_AA
        )
        
        # Blend overlay with original
        cv2.addWeighted(overlay, opacity, frame, 1 - opacity, 0, frame)
        
        # Draw text (always at target opacity for readability)
        text_color = self._blend_color((255, 255, 255), max(0.5, opacity))
        cv2.putText(
            frame,
            text,
            (label_x, label_y),
            self.font,
            self.font_scale,
            text_color,
            self.thickness,
            cv2.LINE_AA
        )
        
        return (label_x, label_y)
    
    def _draw_confidence_bar(
        self,
        frame: np.ndarray,
        x: int,
        y: int,
        confidence: float,
        width: int = 50,
        height: int = 6
    ):
        """Draw a confidence indicator bar."""
        bar_x = x - width // 2
        bar_y = y + 25
        
        # Background
        cv2.rectangle(
            frame,
            (bar_x, bar_y),
            (bar_x + width, bar_y + height),
            (50, 50, 50),
            -1
        )
        
        # Confidence fill
        fill_width = int(width * confidence)
        if confidence > 0.7:
            fill_color = (0, 255, 0)
        elif confidence > 0.4:
            fill_color = (0, 255, 255)
        else:
            fill_color = (0, 0, 255)
        
        cv2.rectangle(
            frame,
            (bar_x, bar_y),
            (bar_x + fill_width, bar_y + height),
            fill_color,
            -1
        )
        
        # Border
        cv2.rectangle(
            frame,
            (bar_x, bar_y),
            (bar_x + width, bar_y + height),
            (200, 200, 200),
            1
        )
    
    def render_annotation(
        self,
        frame: np.ndarray,
        annotation: Annotation,
        state: Optional[TrackingState] = None
    ):
        """Render a single annotation onto the frame."""
        if annotation.opacity < 0.05:
            return  # Too faded to render
        
        x, y = int(annotation.coordinates[0]), int(annotation.coordinates[1])
        colors = annotation.color_scheme
        opacity = annotation.opacity
        
        # Determine marker color based on status
        if state:
            if state.status == TrackingStatus.TRACKING:
                marker_color = colors.primary
            elif state.status == TrackingStatus.OCCLUDED:
                marker_color = colors.warning
            else:
                marker_color = colors.error
        else:
            marker_color = colors.primary
        
        # Apply opacity to colors
        marker_color = self._blend_color(marker_color, opacity)
        
        # Render attached shapes first (background)
        for shape in annotation.shapes:
            self.shape_engine.render_shape(
                frame,
                shape,
                annotation.coordinates,
                opacity=opacity,
                scale=annotation.scale,
                rotation=annotation.rotation,
                pulse_phase=annotation._pulse_phase
            )
        
        # Render based on style
        if annotation.style == AnnotationStyle.MINIMAL:
            # Just dot and label
            cv2.circle(frame, (x, y), 5, marker_color, -1, cv2.LINE_AA)
            cv2.putText(
                frame, annotation.label_text, (x + 10, y - 10),
                self.font, self.font_scale * 0.8,
                self._blend_color(colors.text, opacity),
                1, cv2.LINE_AA
            )
        
        elif annotation.style == AnnotationStyle.STANDARD:
            # Crosshair + label box
            self._draw_crosshair(frame, x, y, 12, marker_color)
            self._draw_circle_marker(
                frame, x, y, 8, marker_color,
                pulse_phase=annotation._pulse_phase
            )
            label_pos = self._draw_label_box(
                frame, x, y, annotation.label_text,
                marker_color, colors.background, opacity
            )
            cv2.line(frame, (x, y), label_pos, marker_color, 1, cv2.LINE_AA)
        
        elif annotation.style == AnnotationStyle.DETAILED:
            # Full visualization with confidence
            self._draw_crosshair(frame, x, y, 15, marker_color)
            self._draw_circle_marker(frame, x, y, 10, marker_color, annotation._pulse_phase)
            
            # Label with status
            status_text = f"{annotation.label_text}"
            if state:
                status_text += f" [{state.status.value}]"
            self._draw_label_box(
                frame, x, y, status_text,
                marker_color, colors.background, opacity
            )
            
            # Confidence bar
            if state:
                self._draw_confidence_bar(frame, x, y, state.confidence)
        
        elif annotation.style == AnnotationStyle.GAMING:
            # Animated gaming style
            pulse_size = int(15 + 5 * math.sin(annotation._pulse_phase))
            
            # Outer ring
            cv2.circle(frame, (x, y), pulse_size + 5, marker_color, 2, cv2.LINE_AA)
            # Inner filled
            cv2.circle(frame, (x, y), 5, marker_color, -1, cv2.LINE_AA)
            
            # Diamond markers
            pts = np.array([
                [x, y - pulse_size],
                [x + pulse_size, y],
                [x, y + pulse_size],
                [x - pulse_size, y]
            ], np.int32)
            cv2.polylines(frame, [pts], True, marker_color, 2, cv2.LINE_AA)
            
            # Label
            cv2.putText(
                frame, annotation.label_text.upper(), (x + 20, y),
                self.font, self.font_scale,
                self._blend_color(colors.secondary, opacity),
                self.thickness, cv2.LINE_AA
            )
    
    def render_all(
        self,
        frame: np.ndarray,
        tracking_states: Dict[str, TrackingState]
    ) -> np.ndarray:
        """
        Render all annotations onto frame.
        
        Args:
            frame: Video frame to draw on
            tracking_states: Dict of tracker_id -> TrackingState
            
        Returns:
            Frame with annotations rendered
        """
        # Update animation time
        current_time = time.perf_counter()
        dt = current_time - self._last_time
        self._last_time = current_time
        
        # Update and render each annotation
        for tracker_id, annotation in self._annotations.items():
            state = tracking_states.get(tracker_id)
            
            if state:
                # Update from tracking state
                annotation.update_position(state.x, state.y)
                annotation.update_opacity(state.status)
                annotation.update_transform(state.scale, state.rotation)
            
            # Tick animation
            annotation.tick_animation(dt)
            
            # Render
            self.render_annotation(frame, annotation, state)
        
        return frame
    
    def render_hud(
        self,
        frame: np.ndarray,
        fps: float = 0.0,
        active_trackers: int = 0,
        show_instructions: bool = True
    ) -> np.ndarray:
        """Render heads-up display with metrics and instructions."""
        h, w = frame.shape[:2]
        
        # Semi-transparent HUD background
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 40), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
        
        # FPS
        cv2.putText(
            frame, f"FPS: {fps:.1f}", (10, 28),
            self.font, 0.6, (0, 255, 0), 1, cv2.LINE_AA
        )
        
        # Active trackers
        cv2.putText(
            frame, f"Trackers: {active_trackers}", (120, 28),
            self.font, 0.6, (255, 255, 0), 1, cv2.LINE_AA
        )
        
        # Instructions
        if show_instructions:
            instructions = "Label: click+type | I identify | D draw | Shift snap | C clear | U undo | R reset | Q quit"
            text_size = cv2.getTextSize(instructions, self.font, 0.5, 1)[0]
            cv2.putText(
                frame, instructions, (w - text_size[0] - 10, 28),
                self.font, 0.5, (200, 200, 200), 1, cv2.LINE_AA
            )
        
        return frame


# Convenience function for quick single-annotation rendering
def draw_tracking_annotation(
    frame: np.ndarray,
    x: float,
    y: float,
    label: str,
    status: TrackingStatus,
    confidence: float = 1.0,
    style: AnnotationStyle = AnnotationStyle.STANDARD,
    shapes: Optional[List[RelativeShape]] = None
) -> np.ndarray:
    """
    Quick function to draw a single tracking annotation.
    
    Args:
        frame: Frame to draw on
        x, y: Position
        label: Label text
        status: Tracking status
        confidence: Tracking confidence
        style: Visual style
        shapes: Optional list of attached shapes
        
    Returns:
        Frame with annotation
    """
    renderer = AnnotationRenderer(default_style=style)
    ann = Annotation(
        label_text=label,
        tracker_id="temp",
        coordinates=(x, y),
        style=style
    )
    
    # Add shapes if provided
    if shapes:
        ann.shapes = shapes
    
    # Set opacity based on status
    if status == TrackingStatus.TRACKING:
        ann.opacity = 1.0
    elif status == TrackingStatus.OCCLUDED:
        ann.opacity = 0.3
    else:
        ann.opacity = 0.0
    
    state = TrackingState(
        status=status,
        x=x, y=y,
        confidence=confidence,
        is_occluded=(status == TrackingStatus.OCCLUDED)
    )
    
    renderer.render_annotation(frame, ann, state)
    return frame


# Helper functions for creating common shape patterns
def create_pointer_arrow(
    offset: Tuple[float, float] = (-50, -50),
    color: Tuple[int, int, int] = (0, 255, 128)
) -> RelativeShape:
    """Create an arrow pointing to the object from an offset position."""
    return RelativeShape(
        shape_type=ShapeType.ARROW,
        start=offset,
        end=(0, 0),
        color=color,
        thickness=2
    )


def create_highlight_circle(
    radius: float = 30,
    color: Tuple[int, int, int] = (0, 255, 128),
    pulse: bool = True
) -> RelativeShape:
    """Create a pulsing circle highlight around the object."""
    return RelativeShape(
        shape_type=ShapeType.CIRCLE,
        center=(0, 0),
        radius=radius,
        color=color,
        filled=False,
        pulse=pulse
    )


def create_bounding_box(
    width: float = 80,
    height: float = 80,
    color: Tuple[int, int, int] = (0, 255, 128)
) -> RelativeShape:
    """Create a centered bounding box around the object."""
    return RelativeShape(
        shape_type=ShapeType.RECTANGLE,
        top_left=(-width/2, -height/2),
        size=(width, height),
        color=color,
        filled=False
    )


if __name__ == "__main__":
    # Demo: Test annotation rendering with shapes
    print("Testing AnnotationRenderer with Shape Engine...")
    
    # Create test frame
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:] = (40, 40, 40)  # Dark gray background
    
    renderer = AnnotationRenderer()
    
    # Create test annotation with shapes
    ann = renderer.create_annotation(
        tracker_id="test",
        label="Chess Pawn",
        x=320,
        y=240,
        style=AnnotationStyle.STANDARD
    )
    
    # Add shapes
    ann.add_arrow(start=(-60, -60), end=(0, 0), color=(0, 255, 255))
    ann.add_circle(radius=40, color=(255, 100, 0), pulse=True)
    ann.add_rectangle(width=100, height=100, color=(100, 255, 100))
    
    # Simulate tracking state
    state = TrackingState(
        status=TrackingStatus.TRACKING,
        x=320, y=240,
        confidence=0.95,
        is_occluded=False,
        scale=1.0,
        rotation=0.0
    )
    
    # Render
    frame = renderer.render_all(frame, {"test": state})
    frame = renderer.render_hud(frame, fps=60.0, active_trackers=1)
    
    # Display
    cv2.imshow("Annotation Layer with Shapes", frame)
    print("Press any key to close...")
    cv2.waitKey(0)
    cv2.destroyAllWindows()
    print("Test complete.")
