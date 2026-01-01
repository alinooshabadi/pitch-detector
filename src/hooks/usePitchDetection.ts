// @ts-expect-error - aubiojs ESM build doesn't have type definitions
import aubio from "aubiojs/build/aubio.esm.js";
import aubioWasmUrl from "aubiojs/build/aubio.esm.wasm?url";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  frequencyToMidi,
  midiToNoteName,
  midiToFrequency,
  NoteStabilityVoter,
  randomTargetNote,
} from "../utils/pitch";

// Type declaration for webkitAudioContext fallback
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export type PitchStatus =
  | "idle"
  | "listening"
  | "no-pitch"
  | "correct"
  | "try-again";
export type OctaveRange = { start: number; end: number };
export type RingDirection = "neutral" | "flat" | "sharp" | "perfect";

type UsePitchDetectionOptions = {
  targetNote: number;
  octaveRange: OctaveRange;
  onTargetChange: (nextTarget: number) => void;
};

type UsePitchDetectionResult = {
  isListening: boolean;
  status: PitchStatus;
  ringDirection: RingDirection;
  lockProgress: number;
  isLocked: boolean;
  waveSpeed: number;
  centsOffset: number | null;
  detectedNote: string;
  startMicrophone: () => Promise<void>;
  stopMicrophone: () => void;
  setTargetFromUser: (nextTarget: number, nextStatus?: PitchStatus) => void;
};

const PERFECT_CENTS = 10;
const HOLD_DURATION_MS = 1200;
const WAVE_SPEED_DEFAULT = 8;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// Type definition for aubiojs Pitch class
interface AubioPitch {
  do(buffer: Float32Array<ArrayBufferLike> | Float32Array<ArrayBuffer>): number;
}

export function usePitchDetection({
  targetNote,
  octaveRange,
  onTargetChange,
}: UsePitchDetectionOptions): UsePitchDetectionResult {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<PitchStatus>("idle");
  const [ringDirection, setRingDirection] = useState<RingDirection>("neutral");
  const [lockProgress, setLockProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [waveSpeed, setWaveSpeed] = useState(WAVE_SPEED_DEFAULT);
  const [centsOffset, setCentsOffset] = useState<number | null>(null);
  const [detectedNote, setDetectedNote] = useState("");

  // Refs for audio processing (avoid re-renders)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const voterRef = useRef<NoteStabilityVoter>(new NoteStabilityVoter(10, 0.7));
  const correctTimeoutRef = useRef<number | null>(null);
  const pitchDetectorRef = useRef<AubioPitch | null>(null);
  const audioBufferRef = useRef<Float32Array | null>(null);
  const targetNoteRef = useRef<number>(targetNote);
  const octaveRangeRef = useRef<OctaveRange>(octaveRange);
  const lockStartRef = useRef<number | null>(null);
  const isListeningRef = useRef(isListening);

  useEffect(() => {
    targetNoteRef.current = targetNote;
  }, [targetNote]);

  useEffect(() => {
    octaveRangeRef.current = octaveRange;
  }, [octaveRange]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const resetLock = useCallback(() => {
    lockStartRef.current = null;
    setLockProgress((prev) => (prev === 0 ? prev : 0));
    setIsLocked((prev) => (prev ? false : prev));
  }, []);

  const resetForTargetChange = useCallback(
    (nextStatus?: PitchStatus) => {
      voterRef.current.reset();
      setDetectedNote("");
      setRingDirection("neutral");
      resetLock();
      setWaveSpeed(WAVE_SPEED_DEFAULT);
      setCentsOffset(null);
      setStatus(nextStatus ?? (isListeningRef.current ? "listening" : "idle"));
    },
    [resetLock]
  );

  const applyTargetChange = useCallback(
    (nextTarget: number, nextStatus?: PitchStatus) => {
      targetNoteRef.current = nextTarget;
      onTargetChange(nextTarget);
      resetForTargetChange(nextStatus);
    },
    [onTargetChange, resetForTargetChange]
  );

  const setTargetFromUser = useCallback(
    (nextTarget: number, nextStatus?: PitchStatus) => {
      if (correctTimeoutRef.current) {
        clearTimeout(correctTimeoutRef.current);
        correctTimeoutRef.current = null;
      }
      applyTargetChange(nextTarget, nextStatus);
    },
    [applyTargetChange]
  );

  /**
   * Start microphone capture and pitch detection loop
   */
  const startMicrophone = useCallback(async () => {
    try {
      setRingDirection("neutral");
      resetLock();
      setWaveSpeed(WAVE_SPEED_DEFAULT);
      setCentsOffset(null);
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Create AudioContext (with fallback for webkit browsers)
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext not supported");
      }
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // Get the actual sample rate from AudioContext
      const actualSampleRate = audioContext.sampleRate;

      // Reinitialize aubio with the correct sample rate if it doesn't match
      if (!pitchDetectorRef.current) {
        try {
          const aubioModule = await aubio({
            locateFile: (path: string) =>
              path.endsWith(".wasm") ? aubioWasmUrl : path,
          });
          const { Pitch } = aubioModule;
          const bufferSize = 2048;
          const hopSize = 512;
          pitchDetectorRef.current = new Pitch(
            "default",
            bufferSize,
            hopSize,
            actualSampleRate
          );
        } catch (aubioError) {
          console.error("Error initializing aubiojs:", aubioError);
          alert(
            `Failed to initialize pitch detection library: ${
              aubioError instanceof Error
                ? aubioError.message
                : String(aubioError)
            }. Please check the browser console for details.`
          );
          setIsListening(false);
          setStatus("idle");
          return;
        }
      }

      // Create analyser node
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Create audio buffer for aubio
      const bufferSize = analyser.fftSize;
      audioBufferRef.current = new Float32Array(bufferSize);

      setIsListening(true);
      setStatus("listening");
      voterRef.current.reset();
      targetNoteRef.current = targetNote;

      // Start pitch detection loop
      const detectLoop = () => {
        if (
          !analyserRef.current ||
          !pitchDetectorRef.current ||
          !audioBufferRef.current
        )
          return;

        // Get audio data
        // @ts-expect-error - getFloatTimeDomainData accepts Float32Array regardless of underlying buffer type
        analyserRef.current.getFloatTimeDomainData(audioBufferRef.current);

        // Create a new Float32Array by copying the data to ensure proper type compatibility
        const audioData = new Float32Array(Array.from(audioBufferRef.current));

        // Detect pitch using aubiojs
        // The do() method returns the frequency directly
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const frequency = pitchDetectorRef.current.do(audioData as any);

        if (frequency && frequency > 0) {
          const now = performance.now();
          const targetFrequency = midiToFrequency(targetNoteRef.current);
          const centsOff =
            targetFrequency > 0
              ? 1200 * Math.log2(frequency / targetFrequency)
              : Number.NaN;
          let nextDirection: RingDirection = "neutral";
          if (Number.isFinite(centsOff)) {
            if (Math.abs(centsOff) <= PERFECT_CENTS) {
              nextDirection = "perfect";
            } else {
              nextDirection = centsOff < 0 ? "flat" : "sharp";
            }
          }
          if (correctTimeoutRef.current === null) {
            setRingDirection((prev) =>
              prev === nextDirection ? prev : nextDirection
            );

            if (Number.isFinite(centsOff)) {
              const nextWaveSpeed = clamp(
                WAVE_SPEED_DEFAULT - (centsOff / 100) * 2,
                4,
                10
              );
              setWaveSpeed((prev) =>
                Math.abs(prev - nextWaveSpeed) < 0.2 ? prev : nextWaveSpeed
              );
              setCentsOffset((prev) =>
                prev !== null && Math.abs(prev - centsOff) < 0.5
                  ? prev
                  : centsOff
              );
            } else {
              setCentsOffset((prev) => (prev === null ? prev : null));
            }
          }

          // Convert to MIDI note
          const midi = frequencyToMidi(frequency);

          // Add to stability voter
          const stableNote = voterRef.current.addDetection(midi);

          if (stableNote !== null) {
            // We have a stable note detection
            const noteName = midiToNoteName(stableNote);
            setDetectedNote(noteName);

            // Check if it matches target (use ref to get current value)
            const isPerfect =
              Number.isFinite(centsOff) && Math.abs(centsOff) <= PERFECT_CENTS;

            const isStableMatch =
              stableNote === targetNoteRef.current && isPerfect;

            if (correctTimeoutRef.current === null) {
              if (isStableMatch) {
                if (lockStartRef.current === null) {
                  lockStartRef.current = now;
                }
                setStatus((prev) =>
                  prev === "listening" ? prev : "listening"
                );
                const progress = Math.min(
                  (now - lockStartRef.current) / HOLD_DURATION_MS,
                  1
                );
                setLockProgress((prev) =>
                  Math.abs(prev - progress) < 0.01 ? prev : progress
                );

                if (progress >= 1 && !isLocked) {
                  setIsLocked(true);
                  setStatus("correct");
                  setLockProgress(1);

                  // Pick new target after 1500ms to give user time to see the feedback
                  correctTimeoutRef.current = window.setTimeout(() => {
                    const newTarget = randomTargetNote(octaveRangeRef.current);
                    applyTargetChange(newTarget, "listening");
                    correctTimeoutRef.current = null;
                  }, 1500);
                }
              } else {
                resetLock();
                setStatus("try-again");
              }
            }
          } else {
            // Not stable yet, but we have a pitch
            resetLock();
            setStatus("listening");
          }
        } else {
          // No pitch detected
          setStatus("no-pitch");
          setDetectedNote("");
          resetLock();
          setRingDirection((prev) => (prev === "neutral" ? prev : "neutral"));
          setWaveSpeed(WAVE_SPEED_DEFAULT);
          setCentsOffset((prev) => (prev === null ? prev : null));
        }

        // Continue loop
        animationFrameRef.current = requestAnimationFrame(detectLoop);
      };

      detectLoop();
    } catch (error) {
      console.error("Error accessing microphone:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      alert(
        `Failed to access microphone: ${errorMessage}. Please check browser permissions and ensure your microphone is connected.`
      );
      setIsListening(false);
      setStatus("idle");
    }
  }, [applyTargetChange, isLocked, resetLock, targetNote]);

  /**
   * Stop microphone and clean up resources
   */
  const stopMicrophone = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }

    // Clear timeout
    if (correctTimeoutRef.current) {
      clearTimeout(correctTimeoutRef.current);
      correctTimeoutRef.current = null;
    }

    // Clear pitch detector and audio buffer
    pitchDetectorRef.current = null;
    audioBufferRef.current = null;

    // Reset state
    setIsListening(false);
    setStatus("idle");
    setDetectedNote("");
    setRingDirection("neutral");
    resetLock();
    setWaveSpeed(WAVE_SPEED_DEFAULT);
    setCentsOffset(null);
    voterRef.current.reset();
  }, [resetLock]);

  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, [stopMicrophone]);

  return {
    isListening,
    status,
    ringDirection,
    lockProgress,
    isLocked,
    waveSpeed,
    centsOffset,
    detectedNote,
    startMicrophone,
    stopMicrophone,
    setTargetFromUser,
  };
}
