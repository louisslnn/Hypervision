# HoloRay Development Roadmap v2

## 🧠 1. AI Auto-Labeling (Gemini Integration)
**Goal:** Eliminate manual typing by using Gemini Vision to identify tracked objects instantly.
* **Strategy:** Async API calls to avoid freezing the video feed.
* [ ] **API Client Setup:** Re-integrate `google-generativeai` with `gemini-2.0-flash-exp` (low latency).
* [ ] **Interaction Logic:**
    * [ ] Add a hotkey listener (e.g., `SPACE` or `I` for Identify).
    * [ ] When pressed, crop the current tracked Region of Interest (ROI).
    * [ ] Send crop to Gemini with prompt: *"Identify the specific object in this image (e.g., 'White Knight', 'Gallbladder', 'Wrench'). Return ONLY the label."*
* [ ] **Non-Blocking Threading:** Ensure the API request runs in a background thread so the video tracker keeps running smoothly while waiting for the label.
* [ ] **Label Update:** Automatically replace the placeholder "Tracker ID" with the returned text once the API responds.

## 🎨 2. Anchored Drawing Mode
**Goal:** Allow free-form creativity (arrows, circles, scribbles) that "sticks" to the moving object.
* **Strategy:** Relative Coordinate System (drawings are offsets from the tracker center, not absolute pixels).
* [ ] **Mode Switcher:** Implement a state machine to toggle between `TRACKING_MODE` (clicking sets points) and `DRAWING_MODE` (clicking draws shapes).
* [ ] **Shape Engine (`shapes.py`):**
    * [ ] Create `RelativeArrow`, `RelativeCircle`, and `RelativeFreehand` classes.
    * [ ] Store points as `(dx, dy)` vectors relative to the tracked object's center.
* [ ] **Mouse Interaction:**
    * [ ] **Left Click + Drag:** Draw the selected shape.
    * [ ] **Release:** "Bake" the shape into the tracker's `drawings` list.
* [ ] **Rendering:** In the main loop, calculate `ActualPos = TrackerPos + RelativeOffset` for every point in the drawing before rendering.

## 🔌 3. Universal Input Architecture
**Goal:** Seamlessly switch between Live Camera (Webcam/iPhone) and Pre-recorded Video files for demos.
* **Strategy:** Input Abstraction Layer (Factory Pattern).
* [ ] **CLI Arguments:** Update `main.py` to accept flags:
    * `--source 0` (Default: Webcam)
    * `--source path/to/video.mp4` (File Mode)
* [ ] **Video Interface Class:**
    * Create a generic `FrameSource` class with a standardized `.read()` method.
    * **Webcam Implementation:** Uses `cv2.VideoCapture` with `threading` (always keeps buffer empty for low latency).
    * **File Implementation:** Uses `cv2.VideoCapture` with standard blocking read (respects video FPS).
* [ ] **Playback Controls (Video Mode only):**
    * Add keys to Pause (`P`), Rewind (`R`), or Restart the video file to make testing easier.

---

## ✅ Backlog (Optimization)
* [ ] **Hybrid Tracker:** Finish the Optical Flow + SIFT re-identification loop (from previous step).
* [ ] **Visual Feedback:** Add loading spinner icon next to label while Gemini is thinking.