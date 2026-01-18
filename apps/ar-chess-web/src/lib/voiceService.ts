/**
 * Voice Service - OpenAI Whisper (STT) + TTS
 * Handles voice input for moves and audio output for coach feedback
 */

// ============= Speech-to-Text (Whisper) =============

export async function transcribeAudio(audioBlob: Blob, apiKey: string): Promise<string> {
  // Determine file extension based on MIME type
  const mimeType = audioBlob.type;
  let extension = "webm";
  if (mimeType.includes("mp4")) {
    extension = "mp4";
  } else if (mimeType.includes("ogg")) {
    extension = "ogg";
  } else if (mimeType.includes("wav")) {
    extension = "wav";
  }

  const formData = new FormData();
  formData.append("file", audioBlob, `audio.${extension}`);
  formData.append("model", "whisper-1");
  formData.append("language", "en");
  formData.append(
    "prompt",
    "Chess moves like e4, Nf3, knight to f3, castle kingside, O-O, bishop takes on c4, Bxc4"
  );

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Whisper API error:", error);
      throw new Error("Failed to transcribe audio");
    }

    const data = await response.json();
    return data.text || "";
  } catch (error) {
    console.error("Transcription error:", error);
    throw error;
  }
}

// ============= Text-to-Speech =============

export async function synthesizeSpeech(
  text: string,
  apiKey: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "nova"
): Promise<ArrayBuffer> {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: voice,
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("TTS API error:", error);
      throw new Error("Failed to synthesize speech");
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error("TTS error:", error);
    throw error;
  }
}

// ============= Audio Playback =============

let currentAudio: HTMLAudioElement | null = null;

export function playAudioBuffer(buffer: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const blob = new Blob([buffer], { type: "audio/mp3" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(); // Use Audio constructor, not HTMLAudioElement
    audio.src = url;
    currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolve();
    };

    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      reject(e);
    };

    audio.play().catch(reject);
  });
}

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

// ============= Move Parsing =============

const PIECE_NAMES: Record<string, string> = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: ""
};

const FILE_NAMES: Record<string, string> = {
  a: "a",
  alpha: "a",
  alfa: "a",
  b: "b",
  bravo: "b",
  beta: "b",
  c: "c",
  charlie: "c",
  d: "d",
  delta: "d",
  e: "e",
  echo: "e",
  f: "f",
  foxtrot: "f",
  g: "g",
  golf: "g",
  h: "h",
  hotel: "h"
};

const RANK_NAMES: Record<string, string> = {
  "1": "1",
  one: "1",
  won: "1",
  "2": "2",
  two: "2",
  to: "2",
  too: "2",
  "3": "3",
  three: "3",
  free: "3",
  "4": "4",
  four: "4",
  for: "4",
  fore: "4",
  "5": "5",
  five: "5",
  "6": "6",
  six: "6",
  "7": "7",
  seven: "7",
  "8": "8",
  eight: "8",
  ate: "8"
};

// Standard algebraic notation piece symbols
const PIECE_SYMBOLS: Record<string, string> = {
  k: "K",
  n: "N",
  b: "B",
  r: "R",
  q: "Q"
};

/**
 * Parse spoken text into a chess move
 * Handles various formats:
 * - "e4", "e 4", "echo 4"
 * - "knight f3", "knight to f3", "Nf3", "Nc3"
 * - "bishop takes c4", "Bxc4"
 * - "castle", "castle kingside", "O-O"
 * - "pawn to e4"
 */
export function parseSpokenMove(text: string): string | null {
  const normalized = text.toLowerCase().trim();
  const original = text.trim(); // Keep original case for SAN detection

  console.info("[Voice] Parsing move:", normalized);

  // Handle castling
  if (normalized.includes("castle") || normalized.includes("castling")) {
    if (normalized.includes("queen") || normalized.includes("long")) {
      return "O-O-O";
    }
    return "O-O";
  }

  if (normalized === "o-o" || normalized === "oh oh") {
    return "O-O";
  }

  if (normalized === "o-o-o" || normalized === "oh oh oh") {
    return "O-O-O";
  }

  // *** NEW: Direct SAN notation detection ***
  // Matches: Nc3, Bxe5, Qd1, Nxf7, e4, exd5, Rad1, Nbd2, R1a3, etc.
  const sanPattern = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])(=[QRBN])?(\+|#)?$/i;
  const sanMatch = original.match(sanPattern);

  if (sanMatch) {
    // Reconstruct the SAN move with proper casing
    let move = "";
    if (sanMatch[1]) move += sanMatch[1].toUpperCase(); // Piece
    if (sanMatch[2]) move += sanMatch[2].toLowerCase(); // Disambiguation file
    if (sanMatch[3]) move += sanMatch[3]; // Disambiguation rank
    if (sanMatch[4]) move += "x"; // Capture
    if (sanMatch[5]) move += sanMatch[5].toLowerCase(); // Target file
    if (sanMatch[6]) move += sanMatch[6]; // Target rank
    if (sanMatch[7]) move += sanMatch[7].toUpperCase(); // Promotion
    if (sanMatch[8]) move += sanMatch[8]; // Check/checkmate

    console.info("[Voice] Parsed SAN:", move);
    return move;
  }

  // *** Also handle "Nc3" style without regex (simpler cases) ***
  // Check for 3-character moves like Nc3, Qd4, Rf1
  if (normalized.length === 3) {
    const pieceChar = normalized[0] ?? "";
    const file = normalized[1] ?? "";
    const rank = normalized[2] ?? "";

    if (
      pieceChar &&
      file &&
      rank &&
      PIECE_SYMBOLS[pieceChar] &&
      FILE_NAMES[file] &&
      RANK_NAMES[rank]
    ) {
      const move = PIECE_SYMBOLS[pieceChar] + FILE_NAMES[file] + RANK_NAMES[rank];
      console.info("[Voice] Parsed 3-char move:", move);
      return move;
    }
  }

  // Check for 4-character capture moves like Nxc3, Bxe5
  if (normalized.length === 4 && normalized[1] === "x") {
    const pieceChar = normalized[0] ?? "";
    const file = normalized[2] ?? "";
    const rank = normalized[3] ?? "";

    if (
      pieceChar &&
      file &&
      rank &&
      PIECE_SYMBOLS[pieceChar] &&
      FILE_NAMES[file] &&
      RANK_NAMES[rank]
    ) {
      const move = PIECE_SYMBOLS[pieceChar] + "x" + FILE_NAMES[file] + RANK_NAMES[rank];
      console.info("[Voice] Parsed capture move:", move);
      return move;
    }
  }

  // Extract piece from spoken words
  let piece = "";
  for (const [name, symbol] of Object.entries(PIECE_NAMES)) {
    if (normalized.includes(name)) {
      piece = symbol;
      break;
    }
  }

  // Handle captures
  const isCapture =
    normalized.includes("take") || normalized.includes("capture") || normalized.includes("x");

  // Extract squares (files and ranks)
  const words = normalized.replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  const files: string[] = [];
  const ranks: string[] = [];

  for (const word of words) {
    // Check for file
    if (FILE_NAMES[word]) {
      files.push(FILE_NAMES[word]);
    }
    // Check for rank
    if (RANK_NAMES[word]) {
      ranks.push(RANK_NAMES[word]);
    }
    // Check for combined like "e4"
    if (word.length === 2) {
      const char0 = word[0];
      const char1 = word[1];
      if (char0 && char1) {
        const f = FILE_NAMES[char0];
        const r = RANK_NAMES[char1];
        if (f && r) {
          files.push(f);
          ranks.push(r);
        }
      }
    }
  }

  // Build move
  if (files.length >= 1 && ranks.length >= 1) {
    // If we have two squares, it's a move from-to
    if (files.length >= 2 && ranks.length >= 2) {
      const f0 = files[0];
      const f1 = files[1];
      const r0 = ranks[0];
      const r1 = ranks[1];
      if (f0 && f1 && r0 && r1) {
        const from = f0 + r0;
        const to = f1 + r1;
        console.info("[Voice] Parsed UCI move:", from + to);
        return from + to; // UCI format
      }
    }

    // Single square - SAN format
    const lastFile = files[files.length - 1];
    const lastRank = ranks[ranks.length - 1];
    if (!lastFile || !lastRank) {
      console.info("[Voice] Could not parse move - missing file or rank");
      return null;
    }
    const square = lastFile + lastRank;

    if (piece) {
      const move = isCapture ? piece + "x" + square : piece + square;
      console.info("[Voice] Parsed piece move:", move);
      return move;
    }

    // Pawn move
    if (isCapture && files.length >= 2) {
      const firstFile = files[0];
      if (firstFile) {
        const move = firstFile + "x" + square;
        console.info("[Voice] Parsed pawn capture:", move);
        return move;
      }
    }

    console.info("[Voice] Parsed pawn move:", square);
    return square; // Simple pawn move like "e4"
  }

  console.info("[Voice] Could not parse move");
  return null;
}

// ============= Voice Recording Hook =============

export type RecordingState = "idle" | "recording" | "processing";

export function createVoiceRecorder(onResult: (move: string | null, transcript: string) => void) {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.start();
    } catch (error) {
      console.error("Failed to start recording:", error);
      throw error;
    }
  };

  const stopRecording = async (
    apiKey: string
  ): Promise<{ move: string | null; transcript: string }> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder) {
        reject(new Error("No recording in progress"));
        return;
      }

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });

        // Stop all tracks
        mediaRecorder?.stream.getTracks().forEach((track) => track.stop());

        try {
          const transcript = await transcribeAudio(blob, apiKey);
          const move = parseSpokenMove(transcript);
          onResult(move, transcript);
          resolve({ move, transcript });
        } catch (error) {
          reject(error);
        }
      };

      mediaRecorder.stop();
    });
  };

  const cancelRecording = (): void => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      mediaRecorder.stop();
    }
    chunks = [];
  };

  return { startRecording, stopRecording, cancelRecording };
}