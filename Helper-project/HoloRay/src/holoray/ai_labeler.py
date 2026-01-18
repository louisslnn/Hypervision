"""
HoloRay AI Labeler - Smart Object Identification using OpenAI GPT-4o

This module provides async object identification using OpenAI's vision models.
Designed to run in background threads without blocking the video pipeline.

Usage:
    from holoray.ai_labeler import AILabeler
    
    labeler = AILabeler()
    label = labeler.identify_object(frame, center_x, center_y)
    # Returns: "White Rook", "Red Apple", etc.
"""

import os
import logging
import base64
from typing import Optional, Tuple
from enum import Enum
from pathlib import Path

import cv2
import numpy as np

# Try to load environment variables from multiple locations
def _load_env():
    """Load environment variables from .env files."""
    try:
        from dotenv import load_dotenv
        
        # Try multiple possible .env locations
        possible_paths = [
            Path(__file__).resolve().parents[2] / ".env",  # src/holoray/../../.env
            Path(__file__).resolve().parents[3] / ".env",  # one level higher
            Path.cwd() / ".env",                            # current working directory
            Path.home() / ".env",                           # home directory
        ]
        
        for env_path in possible_paths:
            if env_path.exists():
                load_dotenv(env_path, override=True)
                return str(env_path)
        
        # Also try load_dotenv with default behavior
        load_dotenv()
        return "default"
        
    except ImportError:
        pass  # dotenv not installed, rely on system env vars
    return None

_env_loaded = _load_env()


class LabelStatus(Enum):
    """Status of the AI labeling process."""
    IDLE = "idle"           # No identification in progress
    THINKING = "thinking"   # API call in progress
    LABELED = "labeled"     # Label has been set
    ERROR = "error"         # API call failed


class AILabeler:
    """
    AI-powered object identification using OpenAI GPT-4o.
    
    Thread-safe and designed for async operation.
    
    Attributes:
        model_name: OpenAI model to use (default: gpt-4o)
        default_crop_size: Default crop size around object center
    """
    
    # Configuration
    MODEL_NAME = "gpt-4o"  # Main model (best quality)
    MODEL_FALLBACK = "gpt-4o-mini"  # Faster/cheaper fallback
    
    DEFAULT_CROP_SIZE = 200
    MAX_CROP_SIZE = 400
    JPEG_QUALITY = 85
    MAX_TOKENS = 15
    
    # System prompt for concise labeling
    SYSTEM_PROMPT = """You are a computer vision assistant. 
Identify the main object in the CENTER of this image.
Return ONLY the specific name (maximum 3 words).
Do not write sentences or explanations.
Examples of good responses: "White Rook", "Red Apple", "Human Hand", "Coffee Mug"."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        """
        Initialize the AI Labeler.
        
        Args:
            api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var.
            model_name: Specific model to use. If None, uses gpt-4o.
        """
        self.logger = logging.getLogger("AILabeler")
        self._client = None
        self._model_name = model_name or os.environ.get("OPENAI_MODEL", self.MODEL_NAME)
        self._initialized = False
        
        # Get API key
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        
        if not self._api_key:
            self.logger.warning(
                "No OPENAI_API_KEY found. Set it in .env or environment. "
                "AI labeling will be disabled."
            )
    
    def _ensure_initialized(self) -> bool:
        """Lazy initialization of OpenAI client."""
        if self._initialized:
            return self._client is not None
        
        self._initialized = True
        
        if not self._api_key:
            return False
        
        try:
            from openai import OpenAI
            
            self._client = OpenAI(api_key=self._api_key)
            self.logger.info(f"OpenAI client initialized (model: {self._model_name})")
            return True
            
        except ImportError:
            self.logger.error(
                "openai not installed. "
                "Run: pip install openai"
            )
            return False
        except Exception as e:
            self.logger.error(f"Failed to initialize OpenAI: {e}")
            return False
    
    def _crop_around_center(
        self,
        frame: np.ndarray,
        center_x: int,
        center_y: int,
        crop_size: int
    ) -> Optional[np.ndarray]:
        """
        Crop a square region around the center point.
        
        Handles edge cases where crop would go out of bounds.
        
        Args:
            frame: Full BGR frame
            center_x, center_y: Center coordinates
            crop_size: Size of square crop
            
        Returns:
            Cropped BGR image, or None if invalid
        """
        h, w = frame.shape[:2]
        half = crop_size // 2
        
        # Calculate bounds with clamping
        x1 = max(0, center_x - half)
        y1 = max(0, center_y - half)
        x2 = min(w, center_x + half)
        y2 = min(h, center_y + half)
        
        # Ensure we have a valid region
        if x2 <= x1 or y2 <= y1:
            return None
        
        crop = frame[y1:y2, x1:x2]
        
        # If crop is too small, pad it
        if crop.shape[0] < 50 or crop.shape[1] < 50:
            return None
        
        return crop
    
    def _encode_image_base64(self, image: np.ndarray) -> str:
        """
        Encode image to base64 string for OpenAI API.
        
        Args:
            image: BGR image
            
        Returns:
            Base64 encoded string
        """
        # Resize if too large (save bandwidth and tokens)
        h, w = image.shape[:2]
        max_dim = 512
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
        
        # Encode to JPEG
        success, buffer = cv2.imencode(
            '.jpg', image, 
            [cv2.IMWRITE_JPEG_QUALITY, self.JPEG_QUALITY]
        )
        
        if not success:
            raise ValueError("Failed to encode image")
        
        # Convert to base64
        return base64.b64encode(buffer.tobytes()).decode("utf-8")
    
    def identify_object(
        self,
        frame: np.ndarray,
        center_x: int,
        center_y: int,
        crop_size: int = None
    ) -> str:
        """
        Identify the object at the given coordinates.
        
        This method is BLOCKING - call it from a background thread!
        
        Args:
            frame: Full BGR frame from video
            center_x, center_y: Center of object to identify
            crop_size: Size of crop around center (default: 200px)
            
        Returns:
            Object label string (e.g., "White Rook", "Red Apple")
            Returns "Unknown" on error.
        """
        if crop_size is None:
            crop_size = self.DEFAULT_CROP_SIZE
        
        # Ensure initialized
        if not self._ensure_initialized():
            return "AI Disabled"
        
        try:
            # Crop around center
            crop = self._crop_around_center(frame, center_x, center_y, crop_size)
            
            if crop is None:
                self.logger.warning("Invalid crop region")
                return "Invalid Region"
            
            # Encode image to base64
            image_base64 = self._encode_image_base64(crop)
            
            # Create the image URL for OpenAI
            image_url = f"data:image/jpeg;base64,{image_base64}"
            
            # Call OpenAI API with vision
            response = self._client.chat.completions.create(
                model=self._model_name,
                messages=[
                    {
                        "role": "system",
                        "content": self.SYSTEM_PROMPT
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "What is this object?"
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": image_url,
                                    "detail": "low"  # Use low detail for speed
                                }
                            }
                        ]
                    }
                ],
                max_tokens=self.MAX_TOKENS,
                temperature=0.1
            )
            
            # Extract text from response
            if response and response.choices and len(response.choices) > 0:
                label = response.choices[0].message.content.strip()
                # Clean up - remove quotes, periods, etc.
                label = label.strip('"\'.,!?')
                # Limit length
                if len(label) > 30:
                    label = label[:30] + "..."
                
                self.logger.info(f"Identified: {label}")
                return label
            else:
                self.logger.warning("Empty response from OpenAI")
                return "Unknown"
                
        except Exception as e:
            error_str = str(e)
            
            # Check for rate limit errors
            if "429" in error_str or "rate" in error_str.lower():
                self.logger.warning(f"Rate limited - wait and retry. Error: {error_str[:100]}")
                return "Rate Limited"
            
            # Check for authentication errors
            if "401" in error_str or "invalid" in error_str.lower() and "key" in error_str.lower():
                self.logger.error(f"Invalid API key: {error_str[:100]}")
                return "Invalid API Key"
            
            # Check for model errors
            if "model" in error_str.lower() and ("not" in error_str.lower() or "invalid" in error_str.lower()):
                self.logger.warning(f"Model {self._model_name} not available, trying fallback...")
                # Try fallback model
                if self._model_name != self.MODEL_FALLBACK:
                    self._model_name = self.MODEL_FALLBACK
                    return self.identify_object(frame, center_x, center_y, crop_size)
                self.logger.error(f"Model error: {error_str[:100]}")
                return "Model Error"
            
            self.logger.error(f"OpenAI API error: {e}")
            return "Error"
    
    def is_available(self) -> bool:
        """Check if AI labeling is available."""
        return self._ensure_initialized()
    
    @property
    def status_message(self) -> str:
        """Get human-readable status."""
        if not self._api_key:
            return "No API key configured"
        if not self._initialized:
            return "Not initialized"
        if self._client is None:
            return "Initialization failed"
        return f"Ready ({self._model_name})"


# Singleton instance for convenience
_default_labeler: Optional[AILabeler] = None


def get_labeler() -> AILabeler:
    """Get the default AILabeler instance."""
    global _default_labeler
    if _default_labeler is None:
        _default_labeler = AILabeler()
    return _default_labeler


def identify_object(
    frame: np.ndarray,
    center_x: int,
    center_y: int,
    crop_size: int = 200
) -> str:
    """
    Convenience function to identify an object.
    
    Uses the default AILabeler instance.
    """
    return get_labeler().identify_object(frame, center_x, center_y, crop_size)


# ============================================================================
# TEST
# ============================================================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    
    print("=" * 60)
    print("  AI Labeler Test (OpenAI GPT-4o)")
    print("=" * 60)
    
    labeler = AILabeler()
    
    print(f"\nStatus: {labeler.status_message}")
    print(f"Available: {labeler.is_available()}")
    
    if labeler.is_available():
        # Create test image (colored rectangle)
        test_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        test_frame[:] = (50, 50, 50)
        
        # Draw something recognizable
        cv2.rectangle(test_frame, (270, 190), (370, 290), (0, 0, 255), -1)
        cv2.putText(test_frame, "TEST", (280, 250), cv2.FONT_HERSHEY_SIMPLEX, 
                    1, (255, 255, 255), 2)
        
        print("\nSending test image to OpenAI GPT-4o...")
        result = labeler.identify_object(test_frame, 320, 240, crop_size=200)
        print(f"Result: {result}")
    else:
        print("\nTo test, set OPENAI_API_KEY environment variable.")
