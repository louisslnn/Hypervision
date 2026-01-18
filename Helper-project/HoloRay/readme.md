# HoloRay Engine

**Real-Time Object Tracking & Annotation SDK for AR/VR Applications**

McHacks 13 HoloXR Challenge

---

## 🚀 Application Tracks

HoloRay now includes two polished application tracks:

### 🎬 Video Overlay Track
Process pre-recorded video files with AR tracking overlays.

```bash
# Process a video file
python apps/video_overlay_track.py --input video.mp4

# With gaming style
python apps/video_overlay_track.py --input video.mp4 --style gaming
```

### 📹 Webcam Real-time Track
Live webcam AR tracking with interactive annotations.

```bash
# Launch webcam tracking
python apps/webcam_realtime_track.py

# With custom settings
python apps/webcam_realtime_track.py --camera 1 --style detailed --palette neon
```

### 🎯 Unified Launcher
```bash
# Show all options
python apps/launcher.py

# Launch video track
python apps/launcher.py video --input video.mp4

# Launch webcam track
python apps/launcher.py webcam
```

See [apps/README.md](./apps/README.md) for detailed documentation.

---

## Quick Start

### Installation

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the original interactive demo
python main_demo.py
```

### Basic Usage (Original Demo)

```bash
# Use webcam (default)
python main_demo.py

# Use specific webcam index
python main_demo.py --source 1

# Use video file
python main_demo.py --source video.mp4

# Disable GPU (CPU fallback)
python main_demo.py --no-gpu

# Change annotation style
python main_demo.py --style gaming
```

---

## Overview

HoloRay Engine is a computer vision SDK that tracks objects in real-time video and renders sticky annotations that persist through:

- **Camera movement** - Annotations follow objects as camera moves
- **Object occlusion** - Labels fade when objects are blocked (e.g., hand in front)
- **Frame re-entry** - Objects are re-identified when they return to frame

### Key Features

✅ **Zero-latency video capture** - Threaded pipeline for real-time performance  
✅ **Hybrid tracking engine** - MagneticOpticalFlow + VisualDNA + RANSAC  
✅ **Smart occlusion detection** - Automatically detects when objects are blocked  
✅ **Re-identification** - Finds objects when they re-enter the frame  
✅ **AI-powered labeling** - OpenAI GPT-4o object identification  
✅ **Multiple annotation styles** - Minimal, Standard, Detailed, Gaming  
✅ **CPU fallback** - Optical flow tracking when GPU unavailable  

---

## Interactive Controls

### Tracking
| Key/Action | Description |
|------------|-------------|
| Left Click | Add tracker (then type label) |
| Right Click | Remove nearest tracker |
| I | AI-identify object (requires OPENAI_API_KEY) |
| R | Reset all trackers |

### Drawing
| Key | Description |
|-----|-------------|
| D | Toggle draw mode |
| Shift+Drag | Snap to edges |
| C | Clear drawings |
| U | Undo last stroke |

### Display
| Key | Description |
|-----|-------------|
| S | Cycle annotation styles |
| H | Toggle help |
| Q/ESC | Quit |

---

## Project Structure

```
HoloRay/
├── apps/                         # 🆕 Application tracks
│   ├── launcher.py               # Unified launcher
│   ├── video_overlay_track.py    # Video processing track
│   ├── webcam_realtime_track.py  # Live webcam track
│   └── README.md                 # Apps documentation
├── main_demo.py                  # Original interactive demo
├── requirements.txt              # Python dependencies
├── src/
│   └── holoray/
│       ├── holoray_core.py       # Ultimate Hybrid Tracker
│       ├── video_pipeline.py     # Threaded video capture
│       ├── annotation_layer.py   # Annotation rendering
│       ├── shapes.py             # Drawing shapes
│       └── ai_labeler.py         # OpenAI integration
└── docs/                         # Documentation
```

---

## Technology Stack

- **Computer Vision:** OpenCV, PyTorch
- **Tracking:** MagneticOpticalFlow (Forward-Backward), SIFT, RANSAC
- **AI:** OpenAI GPT-4o for object identification
- **Feature Matching:** VisualDNA (SIFT + HSV histogram)
- **Python:** 3.8+

---

## Documentation

- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** - Technical design and pipeline flow
- **[docs/MODULES.md](./docs/MODULES.md)** - API reference and module documentation
- **[apps/README.md](./apps/README.md)** - Application tracks documentation

---

## AI Object Identification

Set your OpenAI API key to enable AI-powered object identification:

```bash
export OPENAI_API_KEY=your_key_here
```

Then press `I` during label input or to identify the nearest tracker.

---

## Use Case

Originally designed for **Checkmate AR** (VR Chess application), the engine can track chess pieces and maintain annotations as players move pieces, move the camera, or temporarily block pieces with their hands.

---

## License

McHacks 13 Submission - HoloXR Challenge