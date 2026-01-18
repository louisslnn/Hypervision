# Hypervision

**Computer Vision Made Accessible**

Hypervision is a comprehensive platform that brings advanced computer vision capabilities to diverse real-world applications. Built on a robust foundation of optical flow tracking, AI-powered object recognition, and real-time detection, Hypervision enables developers and users to leverage cutting-edge CV technology across multiple domains.

## 🌟 Vision

Computer vision shouldn't be limited to research labs or specialized teams. Hypervision makes state-of-the-art tracking, detection, and annotation accessible through intuitive applications that solve real problems in medicine, security, entertainment, health, utilities, and more.

## 🚀 Applications

### 🏥 **Medicine** - MedSync Vision
AI-powered surgical tool tracking with hybrid optical flow + YOLO detection. Perfect for medical training, procedure documentation, and real-time surgical assistance.

**Features:**
- Real-time object tracking with forward-backward optical flow validation
- AI-powered object identification using GPT-4.1-mini
- Anchor-based precision tracking for surgical instruments
- YOLO integration for robust detection
- Video overlay annotation system
- Drawing tools with intelligent object attachment

### 🔒 **Security** - SecureWatch
Real-time security monitoring with advanced object detection and tracking. Ideal for surveillance, access control, and public safety applications.

**Features:**
- Live webcam tracking with multi-object support
- AI-enhanced object identification
- Alert system for suspicious activity
- Zone-based monitoring
- Real-time detection pipeline

**Demo & Collaboration:**
- Switch between Camera, Demo clips, Upload, and WebRTC inside the SecureWatch UI
- Optional WebRTC signaling server: `pnpm --filter @hypervision/securewatch-signaling dev`
- Set `NEXT_PUBLIC_SECUREWATCH_SIGNAL_URL` to override the default signaling URL

### 🎮 **Entertainment** - AR Chess Experience
Immersive augmented reality chess with hand gesture recognition and voice coaching.

**Features:**
- AR board projection using homography
- MediaPipe hand tracking
- Voice-activated move coaching
- Real-time move analysis
- Multiplayer support via Firebase

### 🏃 **Health** - Motion Coach (Inclusive Sports)
Inclusive coaching for sports and physical activities with motion analysis.

**Features:**
- Hand gesture recognition
- Motion tracking and analysis
- Accessible coaching interface
- Real-time feedback

### 🗺️ **Utilities** - Visual Navigator
Outdoor accessibility navigation with computer vision assistance.

**Features:**
- Object detection for navigation aids
- Real-time scene understanding
- Accessibility-focused routing
- Visual guidance system

### 👨‍💻 **Developers** - HoloRay SDK
Advanced tracking SDK for building custom computer vision applications.

**Features:**
- UltimateHybridTracker with state machine
- Visual DNA for object re-identification
- RANSAC-based geometric matching
- Kalman smoothing for stable tracking
- Python SDK with comprehensive API

## 🏗️ Architecture

### Core Technologies

- **Optical Flow**: Forward-backward validated tracking for robust object following
- **AI Integration**: GPT-4.1-mini for semantic object understanding and validation
- **YOLO Detection**: Server-side object detection with WebSocket real-time pipeline
- **Anchor Tracking**: Multi-keypoint tracking with rigid body constraints
- **Kalman Filtering**: Smooth position updates and velocity prediction
- **Visual DNA**: SIFT-based feature matching for object re-identification

### Tech Stack

- **Frontend**: Next.js 14, React, TypeScript
- **Backend**: FastAPI (Python), Firebase Functions
- **Computer Vision**: OpenCV, MediaPipe, Ultralytics YOLO
- **AI**: OpenAI GPT-4.1-mini, GPT-4o-mini (fallback)
- **Real-time**: WebSocket for detection pipeline
- **State Management**: React Hooks, Canvas API

## 📦 Project Structure

```
Hypervision/
├── apps/
│   ├── ar-chess-web/          # Next.js web application
│   └── firebase-functions/     # Cloud functions
├── packages/
│   ├── modules/                # CV application modules
│   │   ├── medsyncVision/     # Medical tracking
│   │   ├── secureWatch/       # Security monitoring
│   │   ├── holorayFollow/      # Object following
│   │   └── shared/            # Shared CV utilities
│   ├── ar-core/               # AR/CV core library
│   ├── chess-domain/          # Chess logic
│   ├── engine/                # Chess engine adapters
│   └── ui-kit/                # UI components
└── docs/                      # Documentation
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.9+ (for detection server)
- OpenAI API key (for AI features)

### Installation

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Add your OPENAI_API_KEY to .env.local
   ```

3. **Start the detection server** (optional, for YOLO features)
   
   The detection server is available locally in the Helper-project directory. See the detection server README for setup instructions.

4. **Run Firebase emulators** (for multiplayer features)
   ```bash
   pnpm emulators
   ```

5. **Start the web application**
   ```bash
   pnpm dev
   ```

6. **Open your browser**
   - Main app: http://localhost:3001
   - Medicine: http://localhost:3001/medicine
   - Security: http://localhost:3001/security
   - Entertainment: http://localhost:3001/practice
   - Health: http://localhost:3001/sports
   - Utilities: http://localhost:3001/navigation

## 🎯 Key Features

### Hybrid Tracking System
Combines multiple tracking methods for maximum robustness:
- **Optical Flow**: High-frequency, low-latency pixel-based tracking
- **YOLO Detection**: Object-level detection for re-acquisition
- **AI Validation**: Semantic understanding to ensure correct object tracking
- **Anchor Points**: Multi-keypoint tracking with rigid body constraints

### AI-Powered Object Awareness
- Automatic object identification on marker placement
- Continuous validation to ensure tracking accuracy
- Intelligent re-acquisition when objects are lost
- Context-aware prompts for different domains (surgical, security, etc.)

### Real-Time Performance
- Optimized processing pipeline with configurable resolution
- WebSocket-based detection server for offloading heavy computation
- Smooth 30 FPS tracking with adaptive quality settings
- Efficient memory management and frame buffering

## 📚 Documentation

- [Architecture Overview](docs/architecture.md)
- [API Documentation](docs/api.md)
- [Data Model](docs/data-model.md)

## 🔧 Development

### Running Tests

```bash
pnpm test
```

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm type-check
```

## 🤝 Contributing

Hypervision is built to be extensible. To add a new application:

1. Create a new module in `packages/modules/src/`
2. Implement the tracking/visualization logic
3. Add a route in `apps/ar-chess-web/src/app/`
4. Export from `packages/modules/src/index.ts`

## 📄 License

This project is part of the Hypervision platform.

## 🙏 Acknowledgments

Built with:
- [OpenCV](https://opencv.org/) for computer vision
- [MediaPipe](https://mediapipe.dev/) for hand tracking
- [Ultralytics YOLO](https://ultralytics.com/) for object detection
- [OpenAI](https://openai.com/) for AI-powered understanding
- [Next.js](https://nextjs.org/) for the web framework

---

**Hypervision** - Making computer vision accessible, one application at a time.
