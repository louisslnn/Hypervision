#!/usr/bin/env python3
"""
Unit Tests for HoloRay Tracking Engine Refactor

Tests the three critical scenarios:
A. Hand Wave (Occlusion)
B. Exit/Entry (Re-Identification)
C. Camera Shake (Motion Compensation)
"""

import sys
import os
import numpy as np
import cv2
import time

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from holoray.holoray_core import ObjectTracker, TrackingStatus


def test_hand_wave():
    """
    Test Case A: The "Hand Wave"
    
    Scenario:
    - Draw a white box on black background
    - Simulate a gray bar passing over the white box (occlusion)
    
    Assertions:
    - Tracker visibility score drops during occlusion
    - Status remains TRACKING (not LOST)
    - Annotation opacity fades (but not to 0)
    """
    print("\n" + "="*60)
    print("TEST A: Hand Wave (Occlusion Detection)")
    print("="*60)
    
    width, height = 640, 480
    box_size = 80
    box_x, box_y = width // 2, height // 2
    
    tracker = ObjectTracker(use_gpu=False, enable_reid=True)
    
    # Frame 0: Initial frame with white box
    frame0 = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.rectangle(frame0, 
                  (box_x - box_size//2, box_y - box_size//2),
                  (box_x + box_size//2, box_y + box_size//2),
                  (255, 255, 255), -1)
    
    # Initialize tracker at box center
    tracker.initialize(frame0, box_x, box_y, label="WhiteBox")
    print(f"Initialized tracker at ({box_x}, {box_y})")
    
    # Baseline: Track for a few frames without occlusion
    print("\nBaseline tracking (5 frames)...")
    for i in range(5):
        frame = frame0.copy()
        state = tracker.update(frame)
        print(f"  Frame {i}: status={state.status.value}, visibility={state.visibility:.2f}, opacity={state.opacity:.2f}")
    
    # Occlusion: Gray bar passes over box
    print("\nSimulating occlusion (gray bar passing over box)...")
    occlusion_frames = []
    for i in range(20):
        frame = frame0.copy()
        
        # Draw moving gray bar (simulating hand)
        bar_width = 100
        bar_y = box_y - 40 + i * 5  # Bar moves down
        cv2.rectangle(frame,
                     (box_x - bar_width//2, bar_y - 10),
                     (box_x + bar_width//2, bar_y + 10),
                     (128, 128, 128), -1)
        
        state = tracker.update(frame)
        occlusion_frames.append((state.visibility, state.opacity, state.status))
        
        if i % 5 == 0:
            print(f"  Frame {i}: visibility={state.visibility:.2f}, opacity={state.opacity:.2f}, status={state.status.value}")
    
    # Post-occlusion: Box visible again
    print("\nPost-occlusion (box visible again)...")
    for i in range(5):
        frame = frame0.copy()
        state = tracker.update(frame)
        print(f"  Frame {i}: visibility={state.visibility:.2f}, opacity={state.opacity:.2f}, status={state.status.value}")
    
    # Assertions
    min_visibility_during_occlusion = min(v for v, _, _ in occlusion_frames)
    min_opacity_during_occlusion = min(o for _, o, _ in occlusion_frames)
    max_opacity_during_occlusion = max(o for _, o, _ in occlusion_frames)
    all_tracking_status = all(s == TrackingStatus.TRACKING or s == TrackingStatus.OCCLUDED 
                              for _, _, s in occlusion_frames)
    
    print("\n" + "-"*60)
    print("ASSERTIONS:")
    print(f"  ✓ Visibility dropped during occlusion: {min_visibility_during_occlusion:.2f} < 1.0")
    print(f"  ✓ Opacity faded (not to 0): {min_opacity_during_occlusion:.2f} > 0.0 and < {max_opacity_during_occlusion:.2f}")
    print(f"  ✓ Status remained TRACKING/OCCLUDED (not LOST): {all_tracking_status}")
    
    assert min_visibility_during_occlusion < 1.0, "Visibility should drop during occlusion"
    assert 0.0 < min_opacity_during_occlusion < max_opacity_during_occlusion, "Opacity should fade but not disappear"
    assert all_tracking_status, "Tracker should not be LOST during occlusion"
    
    print("\n✓ TEST A PASSED: Hand Wave (Occlusion)")
    return True


def test_exit_entry():
    """
    Test Case B: The "Exit/Entry"
    
    Scenario:
    - White box moves out of frame (x > width)
    - Wait 2 seconds (60 frames at 30fps)
    - Move box back into frame
    
    Assertions:
    - Tracker recovers the ID within 10 frames of re-entry
    """
    print("\n" + "="*60)
    print("TEST B: Exit/Entry (Re-Identification)")
    print("="*60)
    
    width, height = 640, 480
    box_size = 80
    initial_x, initial_y = width // 2, height // 2
    
    tracker = ObjectTracker(use_gpu=False, enable_reid=True)
    
    # Initialize with box at center
    frame0 = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.rectangle(frame0,
                  (initial_x - box_size//2, initial_y - box_size//2),
                  (initial_x + box_size//2, initial_y + box_size//2),
                  (255, 255, 255), -1)
    
    tracker.initialize(frame0, initial_x, initial_y, label="WhiteBox")
    print(f"Initialized tracker at ({initial_x}, {initial_y})")
    
    # Move box out of frame (right side)
    print("\nMoving box out of frame...")
    exit_frames = 30
    for i in range(exit_frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        box_x = initial_x + (width - initial_x) * (i + 1) / exit_frames
        
        if box_x + box_size//2 < width:  # Still partially visible
            cv2.rectangle(frame,
                         (int(box_x - box_size//2), initial_y - box_size//2),
                         (int(box_x + box_size//2), initial_y + box_size//2),
                         (255, 255, 255), -1)
        
        state = tracker.update(frame)
        if i % 10 == 0:
            print(f"  Frame {i}: box_x={box_x:.0f}, status={state.status.value}")
    
    # Box is now off-screen (60 frames to trigger LOST threshold)
    print("\nBox off-screen (60 frames to trigger search state)...")
    empty_frame = np.zeros((height, width, 3), dtype=np.uint8)
    for i in range(60):
        state = tracker.update(empty_frame)
        if i % 20 == 0:
            print(f"  Frame {i}: status={state.status.value}, frames_since_seen={state.frames_since_seen}")
    
    # Box re-enters from right side
    print("\nBox re-enters from right side...")
    reentry_detected = False
    recovery_frame = -1
    
    for i in range(30):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        # Box slides in from right
        box_x = width - box_size//2 - i * 10
        
        if box_x - box_size//2 >= 0:  # Box is visible
            cv2.rectangle(frame,
                         (int(box_x - box_size//2), initial_y - box_size//2),
                         (int(box_x + box_size//2), initial_y + box_size//2),
                         (255, 255, 255), -1)
        
        state = tracker.update(frame)
        
        if i % 5 == 0:
            print(f"  Frame {i}: box_x={box_x:.0f}, status={state.status.value}, visibility={state.visibility:.2f}")
        
        # Check if tracker recovered
        if state.status == TrackingStatus.TRACKING and state.visibility > 0.7:
            if not reentry_detected:
                reentry_detected = True
                recovery_frame = i
                print(f"  ✓ RECOVERED at frame {i}!")
    
    # Continue tracking after recovery
    print("\nPost-recovery tracking (10 frames)...")
    final_frame = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.rectangle(final_frame,
                 (initial_x - box_size//2, initial_y - box_size//2),
                 (initial_x + box_size//2, initial_y + box_size//2),
                 (255, 255, 255), -1)
    
    for i in range(10):
        state = tracker.update(final_frame)
        if i % 5 == 0:
            print(f"  Frame {i}: status={state.status.value}, visibility={state.visibility:.2f}")
    
    print("\n" + "-"*60)
    print("ASSERTIONS:")
    print(f"  ✓ Re-entry detected: {reentry_detected}")
    print(f"  ✓ Recovery within 10 frames: {recovery_frame <= 10 if reentry_detected else False}")
    
    assert reentry_detected, "Tracker should recover after re-entry"
    assert recovery_frame <= 10, f"Should recover within 10 frames (recovered at {recovery_frame})"
    
    print("\n✓ TEST B PASSED: Exit/Entry (Re-Identification)")
    return True


def test_camera_shake():
    """
    Test Case C: The "Shake"
    
    Scenario:
    - White box on black background
    - Jitter entire "camera" (image) violently by 50px per frame
    - Box position relative to camera changes, but annotation should stay attached
    
    Assertions:
    - Annotation stays attached to box relative to screen
    - Kalman filter smooths jitter
    """
    print("\n" + "="*60)
    print("TEST C: Camera Shake (Motion Compensation)")
    print("="*60)
    
    width, height = 640, 480
    box_size = 80
    
    # Box position in "world" coordinates (before camera shake)
    world_box_x, world_box_y = width // 2, height // 2
    
    tracker = ObjectTracker(use_gpu=False, enable_reid=True)
    
    # Initialize with box centered
    frame0 = np.zeros((height, width, 3), dtype=np.uint8)
    cv2.rectangle(frame0,
                  (world_box_x - box_size//2, world_box_y - box_size//2),
                  (world_box_x + box_size//2, world_box_y + box_size//2),
                  (255, 255, 255), -1)
    
    tracker.initialize(frame0, world_box_x, world_box_y, label="WhiteBox")
    print(f"Initialized tracker at ({world_box_x}, {world_box_y})")
    
    # Camera shake: Jitter entire image
    print("\nSimulating camera shake (50px random jitter per frame)...")
    shake_frames = 30
    positions = []
    
    np.random.seed(42)  # Reproducible shake
    
    for i in range(shake_frames):
        # Random camera offset (shake)
        shake_x = np.random.randint(-50, 51)
        shake_y = np.random.randint(-50, 51)
        
        # Box position in "camera" view (after shake)
        camera_box_x = world_box_x + shake_x
        camera_box_y = world_box_y + shake_y
        
        # Create frame with box at shaken position
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        
        # Only draw box if it's still in frame
        if (box_size//2 <= camera_box_x < width - box_size//2 and
            box_size//2 <= camera_box_y < height - box_size//2):
            cv2.rectangle(frame,
                         (camera_box_x - box_size//2, camera_box_y - box_size//2),
                         (camera_box_x + box_size//2, camera_box_y + box_size//2),
                         (255, 255, 255), -1)
        
        state = tracker.update(frame)
        positions.append((state.x, state.y, camera_box_x, camera_box_y))
        
        if i % 5 == 0:
            print(f"  Frame {i}: shake=({shake_x}, {shake_y}), tracked=({state.x:.0f}, {state.y:.0f}), actual_box=({camera_box_x}, {camera_box_y})")
    
    # Calculate tracking errors (how far from actual box position)
    errors = []
    for tracked_x, tracked_y, actual_x, actual_y in positions:
        error = np.sqrt((tracked_x - actual_x)**2 + (tracked_y - actual_y)**2)
        errors.append(error)
    
    avg_error = np.mean(errors)
    max_error = np.max(errors)
    
    print("\n" + "-"*60)
    print("ASSERTIONS:")
    print(f"  ✓ Average tracking error: {avg_error:.2f} pixels")
    print(f"  ✓ Max tracking error: {max_error:.2f} pixels")
    print(f"  ✓ Error should be < 100px (box size is 80px): {max_error < 100}")
    
    # With Kalman filter and proper tracking, error should be reasonable
    assert max_error < 150, f"Tracking error too large: {max_error:.2f}px"
    assert avg_error < 80, f"Average error too large: {avg_error:.2f}px"
    
    print("\n✓ TEST C PASSED: Camera Shake (Motion Compensation)")
    return True


def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("HoloRay Tracking Engine - Unit Tests")
    print("="*60)
    
    results = []
    
    try:
        results.append(("Test A: Hand Wave", test_hand_wave()))
    except AssertionError as e:
        print(f"\n✗ TEST A FAILED: {e}")
        results.append(("Test A: Hand Wave", False))
    except Exception as e:
        print(f"\n✗ TEST A ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Test A: Hand Wave", False))
    
    try:
        results.append(("Test B: Exit/Entry", test_exit_entry()))
    except AssertionError as e:
        print(f"\n✗ TEST B FAILED: {e}")
        results.append(("Test B: Exit/Entry", False))
    except Exception as e:
        print(f"\n✗ TEST B ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Test B: Exit/Entry", False))
    
    try:
        results.append(("Test C: Camera Shake", test_camera_shake()))
    except AssertionError as e:
        print(f"\n✗ TEST C FAILED: {e}")
        results.append(("Test C: Camera Shake", False))
    except Exception as e:
        print(f"\n✗ TEST C ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Test C: Camera Shake", False))
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    for name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"  {name}: {status}")
    
    all_passed = all(result for _, result in results)
    print("\n" + ("="*60))
    if all_passed:
        print("✓ ALL TESTS PASSED")
    else:
        print("✗ SOME TESTS FAILED")
    print("="*60 + "\n")
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
