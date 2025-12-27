// @ts-expect-error - aubiojs ESM build doesn't have type definitions
import aubio from "aubiojs/build/aubio.esm.js";
import {
  type ChangeEvent,
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
import "./App.css";
import PianoKeys from "./PianoKeys";
import SheetMusicNote from "./SheetMusicNote";
import {
  frequencyToMidi,
  midiToNoteName,
  midiToFrequency,
  NoteStabilityVoter,
  randomTargetNote,
} from "./pitch";

// Type declaration for webkitAudioContext fallback
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type Status = "idle" | "listening" | "no-pitch" | "correct" | "try-again";
type OctaveRange = { start: number; end: number };
type RingDirection = "neutral" | "flat" | "sharp" | "perfect";
type ReferenceTone = "sine" | "piano" | "off";

const DEFAULT_OCTAVE = 4;
const DEFAULT_OCTAVE_RANGE: OctaveRange = {
  start: DEFAULT_OCTAVE,
  end: DEFAULT_OCTAVE,
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

function App() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [ringDirection, setRingDirection] =
    useState<RingDirection>("neutral");
  const [lockProgress, setLockProgress] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [waveSpeed, setWaveSpeed] = useState(WAVE_SPEED_DEFAULT);
  const [centsOffset, setCentsOffset] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [octaveSelection, setOctaveSelection] = useState(
    String(DEFAULT_OCTAVE)
  );
  const [referenceTone, setReferenceTone] =
    useState<ReferenceTone>("piano");
  const [targetNote, setTargetNote] = useState<number>(() =>
    randomTargetNote(DEFAULT_OCTAVE_RANGE)
  );
  const [detectedNote, setDetectedNote] = useState<string>("");

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
  const octaveRangeRef = useRef<OctaveRange>(DEFAULT_OCTAVE_RANGE);
  const lockStartRef = useRef<number | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeoutRef = useRef<number | null>(null);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const hasUserGestureRef = useRef(false);

  const resetLock = () => {
    lockStartRef.current = null;
    setLockProgress((prev) => (prev === 0 ? prev : 0));
    setIsLocked((prev) => (prev ? false : prev));
  };

  /**
   * Start microphone capture and pitch detection loop
   */
  const startMicrophone = async () => {
    try {
      hasUserGestureRef.current = true;
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
          const aubioModule = await aubio();
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
      targetNoteRef.current = targetNote; // Initialize ref with current target note

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
              Number.isFinite(centsOff) &&
              Math.abs(centsOff) <= PERFECT_CENTS;

            const isStableMatch =
              stableNote === targetNoteRef.current && isPerfect;

            if (correctTimeoutRef.current === null) {
              if (isStableMatch) {
                if (lockStartRef.current === null) {
                  lockStartRef.current = now;
                }
                setStatus((prev) => (prev === "listening" ? prev : "listening"));
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
                    const newTarget = randomTargetNote(
                      octaveRangeRef.current
                    );
                    setTargetNote(newTarget);
                    targetNoteRef.current = newTarget; // Update ref as well
                    voterRef.current.reset();
                    setStatus("listening");
                    setDetectedNote("");
                    setRingDirection("neutral");
                    resetLock();
                    setWaveSpeed(WAVE_SPEED_DEFAULT);
                    setCentsOffset(null);
                    correctTimeoutRef.current = null; // Clear the ref after timeout fires
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
  };

  const handleOctaveChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selection = event.target.value;
    const octave = Number(selection);
    if (!Number.isFinite(octave)) return;

    const range = { start: octave, end: octave };
    setOctaveSelection(selection);
    octaveRangeRef.current = range;

    if (correctTimeoutRef.current) {
      clearTimeout(correctTimeoutRef.current);
      correctTimeoutRef.current = null;
    }

    const newTarget = randomTargetNote(range);
    setTargetNote(newTarget);
    targetNoteRef.current = newTarget;
    voterRef.current.reset();
    setDetectedNote("");
    setRingDirection("neutral");
    resetLock();
    setWaveSpeed(WAVE_SPEED_DEFAULT);
    setCentsOffset(null);
    setStatus(isListening ? "listening" : "idle");
  };

  /**
   * Stop microphone and clean up resources
   */
  const stopMicrophone = () => {
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
  };

  const playTargetNote = async () => {
    try {
      hasUserGestureRef.current = true;
      if (referenceTone === "off") {
        return;
      }
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext not supported");
      }

      if (!playbackContextRef.current) {
        playbackContextRef.current = new AudioContextClass();
      }

      const audioContext = playbackContextRef.current;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const frequency = midiToFrequency(targetNoteRef.current);
      if (!frequency) return;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const filterNode = audioContext.createBiquadFilter();
      const now = audioContext.currentTime;

      if (referenceTone === "sine") {
        oscillator.type = "sine";
      } else {
        const harmonics = [1, 0.6, 0.35, 0.2, 0.1];
        const real = new Float32Array(harmonics.length);
        const imag = new Float32Array(harmonics.length);
        harmonics.forEach((amp, index) => {
          real[index] = index === 0 ? 0 : amp;
          imag[index] = 0;
        });
        const wave = audioContext.createPeriodicWave(real, imag, {
          disableNormalization: false,
        });
        oscillator.setPeriodicWave(wave);
      }
      oscillator.frequency.setValueAtTime(frequency, now);

      filterNode.type = "lowpass";
      filterNode.frequency.setValueAtTime(6500, now);
      filterNode.Q.setValueAtTime(0.7, now);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.5, now + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

      oscillator.connect(filterNode);
      filterNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      setIsPlayingTarget(true);
      oscillator.start(now);
      oscillator.stop(now + 1.15);

      oscillator.onended = () => {
        oscillator.disconnect();
        filterNode.disconnect();
        gainNode.disconnect();
      };

      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
      playbackTimeoutRef.current = window.setTimeout(() => {
        setIsPlayingTarget(false);
      }, 1150);
    } catch (error) {
      console.error("Error playing target note:", error);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicrophone();
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      if (playbackContextRef.current) {
        playbackContextRef.current.close().catch(console.error);
        playbackContextRef.current = null;
      }
    };
  }, []);


  // Get status text
  const getStatusText = (): string => {
    switch (status) {
      case "idle":
        return "Ready to start";
      case "listening":
        if (lockProgress > 0 && lockProgress < 1) {
          return "Hold steady...";
        }
        return "Listening...";
      case "no-pitch":
        return "No pitch detected";
      case "correct":
        return `✓ Correct! Great job!`;
      case "try-again":
        return `Try again - Detected: ${detectedNote}`;
      default:
        return "";
    }
  };

  const targetNoteName = midiToNoteName(targetNote);
  const showDetectedNote = detectedNote.length > 0;
  const isDetectedMatch =
    showDetectedNote &&
    detectedNote === targetNoteName &&
    ringDirection === "perfect";
  const showCentsMeter =
    showDetectedNote && centsOffset !== null && Number.isFinite(centsOffset);
  const centsShift = showCentsMeter
    ? Math.round((clamp(centsOffset ?? 0, -50, 50) / 50) * 36)
    : 0;
  const detectedValue = showDetectedNote ? detectedNote : "--";

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-compact">
          <span className="brand-name">Pitch Atelier</span>
          <span
            className={`mic-dot ${isListening ? "is-live" : ""}`}
            aria-hidden="true"
          />
          <span className="sr-only">
            {isListening ? "Microphone live" : "Microphone off"}
          </span>
        </div>
        <div className="header-actions">
          {!isListening ? (
            <button
              onClick={startMicrophone}
              className="glass-button glass-button--primary"
            >
              Start mic
            </button>
          ) : (
            <button
              onClick={stopMicrophone}
              className="glass-button glass-button--danger"
            >
              Stop mic
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings"
            aria-expanded={isPanelOpen}
            aria-controls="config-panel"
            onClick={() => setIsPanelOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z"
                fill="none"
              />
              <path
                d="M4.5 12a7.5 7.5 0 0 1 .1-1.3l-2-1.6 2-3.4 2.4 1a7.7 7.7 0 0 1 2.2-1.3l.3-2.6h4l.3 2.6a7.7 7.7 0 0 1 2.2 1.3l2.4-1 2 3.4-2 1.6a7.5 7.5 0 0 1 0 2.6l2 1.6-2 3.4-2.4-1a7.7 7.7 0 0 1-2.2 1.3l-.3 2.6h-4l-.3-2.6a7.7 7.7 0 0 1-2.2-1.3l-2.4 1-2-3.4 2-1.6A7.5 7.5 0 0 1 4.5 12Z"
                fill="none"
              />
            </svg>
          </button>
        </div>
      </header>

      <div
        className={`config-overlay ${isPanelOpen ? "is-open" : ""}`}
        onClick={() => setIsPanelOpen(false)}
        aria-hidden={!isPanelOpen}
      />
      <aside
        id="config-panel"
        className={`config-panel ${isPanelOpen ? "is-open" : ""}`}
        aria-hidden={!isPanelOpen}
      >
        <div className="panel-header">
          <h2 className="panel-title">Settings</h2>
          <button
            type="button"
            className="icon-button icon-button--ghost"
            aria-label="Close settings"
            onClick={() => setIsPanelOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6l-12 12" fill="none" />
            </svg>
          </button>
        </div>
        <div className="panel-section">
          <label className="panel-label" htmlFor="octave-select">
            Octave selection
          </label>
          <select
            id="octave-select"
            className="panel-select"
            value={octaveSelection}
            onChange={handleOctaveChange}
          >
            {Array.from({ length: 8 }, (_, index) => {
              const octave = index + 1;
              return (
                <option key={octave} value={String(octave)}>
                  Octave {octave}
                </option>
              );
            })}
          </select>
        </div>
        <div className="panel-section">
          <span className="panel-label">Reference tone</span>
          <div className="tone-toggle" role="group" aria-label="Reference tone">
            {(["sine", "piano", "off"] as const).map((tone) => (
              <button
                key={tone}
                type="button"
                className={`tone-option ${
                  referenceTone === tone ? "is-active" : ""
                }`}
                aria-pressed={referenceTone === tone}
                onClick={() => setReferenceTone(tone)}
              >
                {tone === "sine"
                  ? "Sine"
                  : tone === "piano"
                    ? "Piano"
                    : "Off"}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="hero">
        <div
          className={`tuner-ring ${isLocked ? "is-locked" : ""}`}
          data-direction={ringDirection}
          style={
            {
              "--lock-progress": lockProgress,
              "--wave-speed": `${waveSpeed}s`,
            } as CSSProperties
          }
        >
          <div className="ring-glow ring-left" aria-hidden="true" />
          <div className="ring-glow ring-right" aria-hidden="true" />
          <div className="ring-glow ring-full" aria-hidden="true" />
          <div className="ring-lock" aria-hidden="true" />
          <div className="ring-bloom" aria-hidden="true" />
          <div className="ring-core">
            <div className="note-wave" aria-hidden="true" />
            <div className="note-stack">
              <div className="target-note">{targetNoteName}</div>
              <div
                className={`detected-note ${isDetectedMatch ? "is-match" : ""}`}
                data-visible={showDetectedNote}
                aria-hidden={!showDetectedNote}
              >
                <span className="detected-label">Detected note</span>
                <span className="detected-value">{detectedValue}</span>
                <div
                  className="cents-meter"
                  data-direction={ringDirection}
                  data-visible={showCentsMeter}
                  style={
                    {
                      "--cents-shift": `${centsShift}px`,
                    } as CSSProperties
                  }
                >
                  <span className="cents-track" />
                  <span className="cents-indicator" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="hero-caption">
          Hold a steady tone to lock the match.
        </p>
        <div className="hero-staff">
          <SheetMusicNote noteMidi={targetNote} scale={1.2} />
        </div>
        <div className="hero-actions">
          <button
            className="glass-button glass-button--primary"
            type="button"
            onClick={playTargetNote}
            disabled={isPlayingTarget || referenceTone === "off"}
          >
            {referenceTone === "off"
              ? "Reference tone off"
              : isPlayingTarget
                ? "Playing target..."
                : "Play target note"}
          </button>
        </div>
        <div className="hero-status" role="status" aria-live="polite">
          {getStatusText()}
        </div>
      </main>

      <footer className="piano-footer">
        <div className="piano-board">
          <PianoKeys
            highlightedNote={targetNoteName}
            octaveRange={DEFAULT_OCTAVE_RANGE}
          />
        </div>
      </footer>
    </div>
  );
}

export default App;
