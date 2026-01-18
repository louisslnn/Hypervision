/**
 * useVoice Hook - Voice input and coach speech
 */

import { useCallback, useRef, useState } from "react";

import {
  parseSpokenMove,
  playAudioBuffer,
  RecordingState,
  stopAudio,
  synthesizeSpeech,
  transcribeAudio
} from "./voiceService";

export type VoiceState = {
  // Voice input
  recordingState: RecordingState;
  lastTranscript: string | null;
  lastParsedMove: string | null;
  inputError: string | null;

  // Coach speech
  isSpeaking: boolean;
  autoPlayCoach: boolean;
  speechError: string | null;
};

export function useVoice(apiKey: string | undefined) {
  const [state, setState] = useState<VoiceState>({
    recordingState: "idle",
    lastTranscript: null,
    lastParsedMove: null,
    inputError: null,
    isSpeaking: false,
    autoPlayCoach: false,
    speechError: null
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef(false);

  // ============= Voice Input =============

  const startListening = useCallback(async () => {
    if (!apiKey) {
      setState((s) => ({ ...s, inputError: "No API key configured" }));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Find a supported MIME type - prefer mp4 for better Whisper compatibility
      let mimeType = "audio/webm";
      const preferredTypes = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus"
      ];
      for (const type of preferredTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // Collect data every 100ms for better chunks

      setState((s) => ({
        ...s,
        recordingState: "recording",
        inputError: null,
        lastTranscript: null,
        lastParsedMove: null
      }));
    } catch (error) {
      console.error("Failed to start recording:", error);
      setState((s) => ({
        ...s,
        recordingState: "idle",
        inputError: "Microphone access denied"
      }));
    }
  }, [apiKey]);

  const stopListening = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current;

      if (!mediaRecorder || mediaRecorder.state !== "recording") {
        setState((s) => ({ ...s, recordingState: "idle" }));
        resolve(null);
        return;
      }

      setState((s) => ({ ...s, recordingState: "processing" }));

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        if (!apiKey) {
          setState((s) => ({ ...s, recordingState: "idle", inputError: "No API key" }));
          resolve(null);
          return;
        }

        try {
          const transcript = await transcribeAudio(blob, apiKey);
          const move = parseSpokenMove(transcript);

          setState((s) => ({
            ...s,
            recordingState: "idle",
            lastTranscript: transcript,
            lastParsedMove: move,
            inputError: move ? null : `Couldn't parse: "${transcript}"`
          }));

          resolve(move);
        } catch {
          setState((s) => ({
            ...s,
            recordingState: "idle",
            inputError: "Transcription failed"
          }));
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, [apiKey]);

  const cancelListening = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      mediaRecorder.stop();
    }
    chunksRef.current = [];
    setState((s) => ({ ...s, recordingState: "idle" }));
  }, []);

  // ============= Coach Speech =============

  // Use browser TTS as fallback (works without API key)
  const speakWithBrowserTTS = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        console.warn("[Voice] Browser TTS not available");
        resolve();
        return;
      }

      const synth = window.speechSynthesis;

      // Cancel any ongoing speech
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        console.error("[Voice] Browser TTS error:", e);
        resolve();
      };

      // Workaround for mobile: voices may not be loaded yet
      const voices = synth.getVoices();
      if (voices.length > 0) {
        // Prefer English voices
        const englishVoice = voices.find((v) => v.lang.startsWith("en"));
        if (englishVoice) {
          utterance.voice = englishVoice;
        }
      }

      synth.speak(utterance);
      console.info("[Voice] Speaking via browser TTS:", text.substring(0, 50) + "...");
    });
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;

    isProcessingQueueRef.current = true;

    while (speechQueueRef.current.length > 0) {
      const text = speechQueueRef.current.shift();
      if (!text) continue;

      setState((s) => ({ ...s, isSpeaking: true }));

      // Try OpenAI TTS first, fall back to browser TTS
      if (apiKey) {
        try {
          const audioBuffer = await synthesizeSpeech(text, apiKey, "nova");
          await playAudioBuffer(audioBuffer);
          continue; // Success, move to next
        } catch (error) {
          console.warn("[Voice] OpenAI TTS failed, falling back to browser:", error);
        }
      }

      // Fallback: use browser TTS
      await speakWithBrowserTTS(text);
    }

    setState((s) => ({ ...s, isSpeaking: false }));
    isProcessingQueueRef.current = false;
  }, [apiKey, speakWithBrowserTTS]);

  const speakCoachFeedback = useCallback(
    async (text: string) => {
      if (!text) return;

      console.info("[Voice] Queueing speech:", text.substring(0, 50) + "...");

      // Add to queue
      speechQueueRef.current.push(text);
      processQueue();
    },
    [processQueue]
  );

  const stopSpeaking = useCallback(() => {
    speechQueueRef.current = [];
    stopAudio();
    // Also stop browser TTS
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setState((s) => ({ ...s, isSpeaking: false }));
  }, []);

  const toggleAutoPlay = useCallback(() => {
    setState((s) => ({ ...s, autoPlayCoach: !s.autoPlayCoach }));
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    cancelListening,
    speakCoachFeedback,
    stopSpeaking,
    toggleAutoPlay,
    hasApiKey: !!apiKey
  };
}
