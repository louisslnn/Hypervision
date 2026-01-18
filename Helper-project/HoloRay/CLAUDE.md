# 1. Executive Summary

The goal is to build **Checkmate AR**, a Mixed Reality (MR) application that allows users to play or analyze chess while using advanced computer vision to annotate the board in real time.

By merging the **HoloRay tracking technology** (originally for surgery) with a VR Chess environment, we demonstrate a dual-use case: robust, medical-grade motion tracking applied to a high-fidelity consumer AR experience.

**The Core MVP:**  
A user views a chess board (real or virtual) through a camera feed (iPhone). They can draw annotations (circles, arrows) on specific pieces. As the camera moves or pieces are moved, the annotations stick to their targets, fading when occluded and reappearing when re-entering the frame.

---

# 2. Team Structure & Responsibilities

## Group A: The *Vision Engine* (HoloRay Core)
**Focus:** Computer Vision, Tracking Pipeline, Python Backend  
**Tech Stack:** Python, OpenCV, PyTorch, CoTracker / SAM 2  

**Key Deliverables:**
- **Video Pipeline:** Low-latency stream from iPhone to Python  
- **Tracking System:** Logic that keeps (x, y) coordinates attached to a moving object  
- **Smart Rendering:** Handling opacity (occlusion) and memory (re-entry)

## Group B: The *Game Experience* (VR / Chess Logic)
**Focus:** Chess Mechanics, 3D Environment, UI/UX  
**Tech Stack:** Unity / Unreal or 3D Python (PyGame / OpenGL)

**Key Deliverables:**
- **Chess State:** Logic to understand the board (valid moves, checkmate detection)  
- **Visual Assets:** Rendering the 3D board and pieces (if virtual)  
- **User Interface:** Menu options such as *Draw Arrow*, *Clear Board*, etc.

---

# 3. Functional Requirements (The “What”)

## 3.1 Video Input & Passthrough
- **FR-01:** System must ingest live video from an iPhone camera with \<100 ms latency  
- **FR-02:** Resolution must remain high (minimum 720p) for reliable chess-piece detection

## 3.2 Annotation Tools
- **FR-03:** User can draw the following primitives:
  - **Anchor Point:** A dot that sticks to a specific pixel feature  
  - **Bubble:** A text/icon bubble floating above a piece (e.g. *“Threat”*)  
  - **Arrow:** A vector connecting two squares (e.g. indicating a move)

- **FR-04:** Annotations must deform or translate based on the underlying object’s movement (rotation/translation invariant)

## 3.3 “Smart” Occlusion (The HoloRay Feature)
- **FR-05 (Opacity Fade):**  
  If a physical object (e.g. a hand moving a piece) passes between the camera and the annotated object, the annotation must decrease in opacity instead of disappearing or snapping to the hand.

  **Implementation Strategy:**  
  Monitor tracking confidence. If confidence drops but the location is predicted, lower the alpha channel to **30%**.

- **FR-06 (Re-Entry Memory):**  
  If an annotated piece moves off-screen, the system stores its last known feature signature. When it re-enters the frame, the annotation automatically re-attaches.

---

# 4. Technical Architecture (The “How”)

This architecture assumes a Python-heavy MVP where the VR Chess component is either:
- Passthrough AR (real board), or  
- Python-rendered 3D view

## 4.1 The Pipeline
**Input:**  
iPhone Camera → USB / Wi-Fi → Python `cv2.VideoCapture`

**State Manager:**  
A `TrackerManager` class holds a list of active `Annotation` objects.

**Vision Loop (per frame):**
1. **Step A:** Capture new frame  
2. **Step B (Global Motion):** Optical flow to compensate for camera movement  
3. **Step C (Local Tracking):** Update object trackers (CoTracker / SAM 2)  
4. **Step D (Occlusion Check):**  
   Detect foreground interference (depth map or segmentation).  
   If detected → `annotation.opacity = 0.3`
5. **Step E (Render):** Draw overlay layer on the video frame

**Output:**  
Displayed on laptop screen or streamed back to headset

## 4.2 The “Secret Sauce” (Occlusion Logic)

To achieve opacity fading *without* a depth camera:

**Method:**  
Use **SAM 2 (Segment Anything Model)** or a background subtractor.

**Logic:**
- Maintain a segmentation mask of the tracked knight  
- If a new object (e.g. hand skin-tone blob) overlaps the predicted knight position:
  - Trigger `OcclusionEvent`
  - Reduce annotation opacity
  - Lock position updates (dead-reckoning) until occlusion clears

---

# 5. Next Steps

## Immediate Actions
**Group A (Vision):**
- Initialize the GitHub repo  
- Set up a script to open the iPhone camera feed in OpenCV  
  - Use EpocCam or a direct USB streaming tool

**Group B (Chess):**
- Send the GitHub link for the chess component  
- Decide whether to integrate with Unity or keep it pure Python

**Architecture Decision:**
- Confirm whether the chess board is **Real (Physical AR)** or **Virtual (3D Rendered)**  
- The current PRD assumes a **Physical Board (AR)** based on the camera-feed approach
