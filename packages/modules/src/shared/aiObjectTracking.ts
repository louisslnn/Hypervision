"use client";

/**
 * AI Object-Aware Tracking Module
 *
 * Provides AI-powered object identification, validation, and re-acquisition
 * for robust tracking of specific objects (e.g., surgical tools, security targets).
 *
 * Uses OpenAI GPT-4o vision capabilities to:
 * 1. Identify objects at marker placement (with visual features)
 * 2. Validate if tracker is still on the correct object
 * 3. Re-acquire lost objects by searching the frame
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ObjectIdentification {
  label: string;
  description: string;
  features: string;
  referenceImage: string;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  observation?: string;
}

export interface ReacquisitionResult {
  found: boolean;
  x: number;
  y: number;
  confidence: number;
}

export interface TrackerForAI {
  id: string;
  label: string;
  x: number;
  y: number;
  objectDescription?: string;
  visualFeatures?: string;
  lastGoodPosition?: { x: number; y: number };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export const AI_TRACKING_CONFIG = {
  // Auto-identification on marker placement
  AUTO_IDENTIFY_ON_PLACEMENT: true,

  // Validation triggers - more frequent AI checks for better accuracy
  VALIDATION_CONFIDENCE_THRESHOLD: 0.5, // Validate when confidence drops below this (raised from 0.4)
  VALIDATION_COOLDOWN_MS: 1200, // Faster validation checks (reduced from 2000ms)
  VALIDATION_ON_OCCLUSION: true, // Validate when tracker becomes occluded

  // Re-acquisition settings - more aggressive search
  REACQUISITION_START_FRAME: 6, // Start AI search earlier (reduced from 10)
  REACQUISITION_INTERVAL_FRAMES: 15, // More frequent AI search (reduced from 30)
  REACQUISITION_MIN_CONFIDENCE: 0.45, // Accept slightly lower confidence (reduced from 0.5)

  // Crop sizes for AI analysis
  IDENTIFICATION_CROP_SIZE: 300, // Larger crop for initial identification
  VALIDATION_CROP_SIZE: 200, // Smaller crop for validation checks

  // API settings
  MAX_CONCURRENT_AI_CALLS: 3 // Allow more concurrent calls (increased from 2)
};

// Counter to limit concurrent AI calls
let activeAICalls = 0;

// OpenAI model selection with safe fallback
const PRIMARY_VISION_MODEL = "gpt-4.1-mini";
const FALLBACK_VISION_MODEL = "gpt-4o-mini";

async function fetchOpenAIChatCompletion(
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (response.ok) {
    return response;
  }

  // Attempt fallback if model is unavailable or request is invalid
  if (body.model === PRIMARY_VISION_MODEL) {
    try {
      const errorPayload = await response.clone().json().catch(() => null);
      const errorCode = errorPayload?.error?.code;
      if (response.status === 404 || response.status === 400 || errorCode === "model_not_found") {
        const fallbackBody = { ...body, model: FALLBACK_VISION_MODEL };
        return await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(fallbackBody)
        });
      }
    } catch {
      // If parsing fails, fall through and return original response
    }
  }

  return response;
}

// ============================================================================
// SCENE CONTEXT DETECTION
// ============================================================================

type SceneContext = "surgical" | "medical" | "laboratory" | "security" | "general";

/**
 * Detects the scene context by analyzing colors and patterns
 */
export function detectSceneContext(canvas: HTMLCanvasElement): SceneContext {
  const ctx = canvas.getContext("2d");
  if (!ctx) return "general";

  const sampleSize = 100;
  const centerX = Math.floor(canvas.width / 2);
  const centerY = Math.floor(canvas.height / 2);
  const startX = Math.max(0, centerX - sampleSize);
  const startY = Math.max(0, centerY - sampleSize);

  try {
    const imageData = ctx.getImageData(startX, startY, sampleSize * 2, sampleSize * 2);
    const data = imageData.data;

    let totalR = 0,
      totalG = 0,
      totalB = 0;
    let blueCount = 0,
      greenCount = 0,
      metalCount = 0;
    const pixelCount = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;

      totalR += r;
      totalG += g;
      totalB += b;

      // Detect surgical blue/green
      if (b > 100 && b > r && g > 80) blueCount++;
      if (g > 100 && g > r && g > b) greenCount++;

      // Detect metallic surfaces (grayish with similar R,G,B)
      const avg = (r + g + b) / 3;
      if (Math.abs(r - avg) < 20 && Math.abs(g - avg) < 20 && Math.abs(b - avg) < 20 && avg > 100) {
        metalCount++;
      }
    }

    const blueRatio = blueCount / pixelCount;
    const greenRatio = greenCount / pixelCount;
    const metalRatio = metalCount / pixelCount;

    // Surgical: blue/green scrubs or drapes, metallic instruments
    if ((blueRatio > 0.15 || greenRatio > 0.15) && metalRatio > 0.1) {
      return "surgical";
    }

    // Medical: clean, bright, some blue/white
    if (
      blueRatio > 0.1 ||
      (totalR / pixelCount > 200 && totalG / pixelCount > 200 && totalB / pixelCount > 200)
    ) {
      return "medical";
    }

    // Security: darker, outdoor-like
    if (totalR / pixelCount < 100 && totalG / pixelCount < 100 && totalB / pixelCount < 100) {
      return "security";
    }

    return "general";
  } catch {
    return "general";
  }
}

// ============================================================================
// AI FUNCTIONS
// ============================================================================

/**
 * Enhanced AI identification that captures object details for tracking
 * Returns label + description + visual features + reference image
 */
export async function identifyObjectWithFeatures(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  apiKey: string
): Promise<ObjectIdentification> {
  const cropSize = AI_TRACKING_CONFIG.IDENTIFICATION_CROP_SIZE;
  const half = cropSize / 2;

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropSize;
  cropCanvas.height = cropSize;
  const cropCtx = cropCanvas.getContext("2d");

  if (!cropCtx) throw new Error("Canvas context unavailable");

  const sourceX = Math.max(0, Math.min(canvas.width - cropSize, x - half));
  const sourceY = Math.max(0, Math.min(canvas.height - cropSize, y - half));
  const sourceW = Math.min(cropSize, canvas.width - sourceX);
  const sourceH = Math.min(cropSize, canvas.height - sourceY);

  cropCtx.fillStyle = "#000";
  cropCtx.fillRect(0, 0, cropSize, cropSize);
  cropCtx.drawImage(canvas, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);

  // Add crosshair at target point
  cropCtx.strokeStyle = "rgba(255, 0, 0, 0.7)";
  cropCtx.lineWidth = 2;
  const centerX = x - sourceX;
  const centerY = y - sourceY;

  cropCtx.beginPath();
  cropCtx.moveTo(centerX - 20, centerY);
  cropCtx.lineTo(centerX + 20, centerY);
  cropCtx.moveTo(centerX, centerY - 20);
  cropCtx.lineTo(centerX, centerY + 20);
  cropCtx.stroke();

  cropCtx.beginPath();
  cropCtx.arc(centerX, centerY, 30, 0, Math.PI * 2);
  cropCtx.stroke();

  const imageBase64 = cropCanvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? "";

  // Detect scene context for specialized prompts
  const context = detectSceneContext(canvas);

  const contextPrompt =
    context === "surgical"
      ? `You are analyzing a SURGICAL VIDEO. Focus on identifying surgical instruments and tools.
For surgical instruments, be very specific:
- Include tool type (forceps, scissors, retractor, scalpel, needle holder, etc.)
- Note material (metal, plastic)
- Describe distinctive shape characteristics (curved, straight, serrated)
- Note any colored markings or handles`
      : context === "security"
        ? `You are analyzing a SECURITY VIDEO. Focus on identifying people, vehicles, or objects of interest.
Be specific about:
- Type of object/person
- Distinguishing features (clothing colors, vehicle type/color)
- Size and shape characteristics`
        : `You are a precision object identification system for video tracking.`;

  const response = await fetchOpenAIChatCompletion(apiKey, {
    model: PRIMARY_VISION_MODEL,
    messages: [
      {
        role: "system",
        content: `${contextPrompt}

Your task is to identify the SPECIFIC OBJECT at the red crosshair and provide tracking-friendly information.

Respond ONLY in this exact JSON format (no markdown, no code blocks):
{"label":"Short name (2-4 words)","description":"Brief physical description","features":"Key visual features for re-identification"}

Focus on features that distinguish this object from similar items in the scene.`
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Identify the object at the RED CROSSHAIR. This object will be tracked as it moves. Provide identification suitable for re-finding this specific object if tracking is lost."
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" }
          }
        ]
      }
    ],
    max_tokens: 200,
    temperature: 0.1
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";

  try {
    // Try to parse as JSON
    const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleanContent);
    return {
      label: parsed.label ?? "Unknown Object",
      description: parsed.description ?? "",
      features: parsed.features ?? "",
      referenceImage: imageBase64
    };
  } catch {
    // Fallback: use raw content as label
    return {
      label: content.replace(/[{}"]/g, "").slice(0, 30).trim() || "Unknown Object",
      description: "",
      features: "",
      referenceImage: imageBase64
    };
  }
}

/**
 * Validates if the tracker is still on the identified object
 * Used when confidence drops to prevent tracking wrong things
 */
export async function validateTrackedObject(
  canvas: HTMLCanvasElement,
  tracker: TrackerForAI,
  apiKey: string
): Promise<ValidationResult> {
  if (!tracker.objectDescription && !tracker.visualFeatures) {
    // No object info to validate against
    return { isValid: true, confidence: 0.5 };
  }

  // Rate limiting
  if (activeAICalls >= AI_TRACKING_CONFIG.MAX_CONCURRENT_AI_CALLS) {
    return { isValid: true, confidence: 0.5 };
  }
  activeAICalls++;

  try {
    const cropSize = AI_TRACKING_CONFIG.VALIDATION_CROP_SIZE;
    const half = cropSize / 2;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropSize;
    cropCanvas.height = cropSize;
    const cropCtx = cropCanvas.getContext("2d");

    if (!cropCtx) return { isValid: true, confidence: 0.5 };

    const sourceX = Math.max(0, Math.min(canvas.width - cropSize, tracker.x - half));
    const sourceY = Math.max(0, Math.min(canvas.height - cropSize, tracker.y - half));

    cropCtx.drawImage(canvas, sourceX, sourceY, cropSize, cropSize, 0, 0, cropSize, cropSize);

    // Mark current tracked position with green circle
    cropCtx.strokeStyle = "rgba(0, 255, 0, 0.8)";
    cropCtx.lineWidth = 3;
    const centerX = tracker.x - sourceX;
    const centerY = tracker.y - sourceY;
    cropCtx.beginPath();
    cropCtx.arc(centerX, centerY, 25, 0, Math.PI * 2);
    cropCtx.stroke();

    const currentImageBase64 = cropCanvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "";

    const response = await fetchOpenAIChatCompletion(apiKey, {
      model: PRIMARY_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `You are validating if a tracked object is still at its marked position.

Object being tracked: "${tracker.label}"
${tracker.objectDescription ? `Description: ${tracker.objectDescription}` : ""}
${tracker.visualFeatures ? `Visual features: ${tracker.visualFeatures}` : ""}

Respond ONLY in JSON format (no markdown):
{"isValid":true/false,"confidence":0.0-1.0,"observation":"brief explanation"}

isValid should be FALSE if:
- The green marker is on empty background
- The marker is on a DIFFERENT object than described
- The described object has moved away from the marker

isValid should be TRUE if:
- The green marker is still on or very close to the described object`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Is the "${tracker.label}" still at the green circle marker, or has it moved away?`
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${currentImageBase64}`, detail: "high" }
            }
          ]
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });

    if (!response.ok) {
      return { isValid: true, confidence: 0.5 };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";

    try {
      const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleanContent);
      return {
        isValid: parsed.isValid ?? true,
        confidence: parsed.confidence ?? 0.5,
        observation: parsed.observation
      };
    } catch {
      return { isValid: true, confidence: 0.5 };
    }
  } finally {
    activeAICalls--;
  }
}

/**
 * AI-powered re-acquisition: Find the lost object in the current frame
 * Used when optical flow tracking fails
 */
export async function findObjectInFrame(
  canvas: HTMLCanvasElement,
  tracker: TrackerForAI,
  apiKey: string
): Promise<ReacquisitionResult | null> {
  if (!tracker.label || tracker.label.startsWith("Region") || tracker.label.startsWith("Target")) {
    return null; // Can't search without knowing what to find
  }

  // Rate limiting
  if (activeAICalls >= AI_TRACKING_CONFIG.MAX_CONCURRENT_AI_CALLS) {
    return null;
  }
  activeAICalls++;

  try {
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "";

    const lastPos = tracker.lastGoodPosition ?? { x: tracker.x, y: tracker.y };

    const response = await fetchOpenAIChatCompletion(apiKey, {
      model: PRIMARY_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a visual search system. Find a specific object in the frame.
Image dimensions: ${canvas.width}x${canvas.height} pixels.

Object to find: "${tracker.label}"
${tracker.objectDescription ? `Description: ${tracker.objectDescription}` : ""}
${tracker.visualFeatures ? `Visual features: ${tracker.visualFeatures}` : ""}
Last known position: approximately (${Math.round(lastPos.x)}, ${Math.round(lastPos.y)})

Respond ONLY in JSON format (no markdown):
{"found":true/false,"x":number,"y":number,"confidence":0.0-1.0}

IMPORTANT:
- x and y are PIXEL coordinates where the CENTER of the object is
- x ranges from 0 (left) to ${canvas.width} (right)
- y ranges from 0 (top) to ${canvas.height} (bottom)
- Only return found:true if you're confident you see the object
- Be precise with coordinates - estimate the exact center`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Locate the "${tracker.label}" in this frame. The object may have moved from its last position. Provide the CENTER coordinates where it is now.`
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" }
            }
          ]
        }
      ],
      max_tokens: 80,
      temperature: 0.1
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";

    try {
      const cleanContent = content.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleanContent);

      if (parsed.found && typeof parsed.x === "number" && typeof parsed.y === "number") {
        return {
          found: true,
          x: Math.max(0, Math.min(canvas.width, parsed.x)),
          y: Math.max(0, Math.min(canvas.height, parsed.y)),
          confidence: parsed.confidence ?? 0.7
        };
      }
      return null;
    } catch {
      return null;
    }
  } finally {
    activeAICalls--;
  }
}

/**
 * Simple label-only identification (backward compatible)
 */
export async function identifyWithAI(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  apiKey: string
): Promise<string> {
  try {
    const result = await identifyObjectWithFeatures(canvas, x, y, apiKey);
    return result.label;
  } catch (err) {
    console.error("AI identification failed:", err);
    return "Unknown";
  }
}