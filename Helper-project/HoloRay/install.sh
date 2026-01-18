#!/bin/bash
# Installation script for Medical Annotation Pipeline
# McHacks 13 HoloXR Challenge

set -e

echo "=========================================="
echo "  Medical Annotation Pipeline - Setup"
echo "  McHacks 13 HoloXR Challenge"
echo "=========================================="

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "Python version: $PYTHON_VERSION"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install PyTorch with CUDA support
echo "Installing PyTorch..."
if command -v nvcc &> /dev/null; then
    echo "CUDA detected, installing PyTorch with CUDA support..."
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
else
    echo "CUDA not detected, installing CPU-only PyTorch..."
    pip install torch torchvision torchaudio
fi

# Install core dependencies
echo "Installing core dependencies..."
pip install opencv-python numpy Pillow scipy tqdm pydantic einops timm

# Install Google Generative AI
echo "Installing Google Generative AI..."
pip install google-generativeai

# Install WebRTC dependencies (optional)
echo "Installing WebRTC dependencies..."
pip install aiohttp aiortc av || echo "Warning: WebRTC deps failed, server.py may not work"

# Install CoTracker3
echo "Installing CoTracker3..."
pip install git+https://github.com/facebookresearch/co-tracker.git || {
    echo "Warning: CoTracker3 installation failed"
    echo "Fallback tracker will be used for ultrasound"
}

# Install SAM 2
echo "Installing SAM 2..."
pip install git+https://github.com/facebookresearch/segment-anything-2.git || {
    echo "Warning: SAM 2 installation failed"
    echo "Fallback tracker will be used for laparoscopy"
}

# Install hydra for SAM2 config
pip install hydra-core iopath

# Create output directory
mkdir -p output

echo ""
echo "=========================================="
echo "  Installation Complete!"
echo "=========================================="
echo ""
echo "To activate the environment:"
echo "  source venv/bin/activate"
echo ""
echo "To set your Gemini API key:"
echo "  export GOOGLE_API_KEY='your-api-key'"
echo ""
echo "To run the pipeline:"
echo "  python main.py --data-dir ./data"
echo ""
echo "To run with mock API (no API key needed):"
echo "  python main.py --mock-api --data-dir ./data"
echo ""
echo "To run WebRTC server:"
echo "  python server.py --video ./data/Echo/echo1.mp4"
echo ""
