// @ts-expect-error - aubiojs ESM build doesn't have type definitions
import aubio from "aubiojs/build/aubio.esm.js";
import { ChangeEvent, useEffect, useRef, useState } from "react";
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
type OctaveSelection = "all" | "2" | "3" | "4" | "5";

const DEFAULT_OCTAVE_RANGE: OctaveRange = { start: 2, end: 5 };

const selectionToRange = (selection: OctaveSelection): OctaveRange => {
  if (selection === "all") return DEFAULT_OCTAVE_RANGE;
  const octave = Number(selection);
  return { start: octave, end: octave };
};

// Type definition for aubiojs Pitch class
interface AubioPitch {
  do(buffer: Float32Array<ArrayBufferLike> | Float32Array<ArrayBuffer>): number;
}

function App() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [octaveSelection, setOctaveSelection] =
    useState<OctaveSelection>("all");
  const [octaveRange, setOctaveRange] = useState<OctaveRange>(
    DEFAULT_OCTAVE_RANGE
  );
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
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeoutRef = useRef<number | null>(null);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);
  const hasUserGestureRef = useRef(false);

  /**
   * Start microphone capture and pitch detection loop
   */
  const startMicrophone = async () => {
    try {
      hasUserGestureRef.current = true;
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
          // Convert to MIDI note
          const midi = frequencyToMidi(frequency);

          // Add to stability voter
          const stableNote = voterRef.current.addDetection(midi);

          if (stableNote !== null) {
            // We have a stable note detection
            const noteName = midiToNoteName(stableNote);
            setDetectedNote(noteName);

            // Check if it matches target (use ref to get current value)
            if (stableNote === targetNoteRef.current) {
              // Only trigger correct feedback if we're not already waiting to move to next note
              // This prevents resetting the timeout while waiting
              if (correctTimeoutRef.current === null) {
                setStatus("correct");

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
                  correctTimeoutRef.current = null; // Clear the ref after timeout fires
                }, 1500);
              }
            } else {
              // Only update status if we're not waiting to move to next note
              // This prevents overwriting the correct feedback
              if (correctTimeoutRef.current === null) {
                setStatus("try-again");
              }
            }
          } else {
            // Not stable yet, but we have a pitch
            setStatus("listening");
          }
        } else {
          // No pitch detected
          setStatus("no-pitch");
          setDetectedNote("");
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
    const selection = event.target.value as OctaveSelection;
    const range = selectionToRange(selection);

    setOctaveSelection(selection);
    setOctaveRange(range);
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
    voterRef.current.reset();
  };

  const playTargetNote = async () => {
    try {
      hasUserGestureRef.current = true;
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

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-line">
            <h1 className="brand-mark">Pitch Atelier</h1>
            <span className="brand-sep">•</span>
            <span className="brand-sub">Real-time ear training studio</span>
          </div>
        </div>
        <div className="header-actions">
          <div className={`session-status status-${status}`}>
            <span className="session-dot" />
            <span className="session-text">
              {isListening ? "Mic live" : "Mic off"}
            </span>
          </div>
          <div className="controls">
            {!isListening ? (
              <button onClick={startMicrophone} className="button button-start">
                Start microphone
              </button>
            ) : (
              <button onClick={stopMicrophone} className="button button-stop">
                Stop
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="studio">
        <section className="studio-board">
          <div className="board-header">
            <div>
              <p className="eyebrow">Session</p>
              <div className="board-title-row">
                <h2 className="board-title">Find the pitch</h2>
                <span className="board-subtitle">
                  Hold a steady tone for 1-2 seconds to lock the match.
                </span>
              </div>
            </div>
            <div className={`board-status status-${status}`}>
              <span className="status-orb" />
              <span>{getStatusText()}</span>
            </div>
          </div>

          <div className="board-grid">
            <div className="board-target">
              <p className="eyebrow">Target</p>
              <div className="big-note">{midiToNoteName(targetNote)}</div>
              <p className="note-caption">Aim for a centered tone.</p>
              <div className="target-actions">
                <button
                  className="button button-tone"
                  type="button"
                  onClick={playTargetNote}
                  disabled={isPlayingTarget}
                >
                  {isPlayingTarget ? "Playing target..." : "Play target note"}
                </button>
              </div>
            </div>

            <div className="board-detected">
              <p className="eyebrow">Detected</p>
              <div className="detected-big">{detectedNote || "--"}</div>
              <p className="detected-caption">Closest stable pitch</p>
            </div>

            <div className="board-sheet">
              <SheetMusicNote noteMidi={targetNote} />
            </div>
          </div>

          <div className="board-keys">
            <div className="keys-header">
              <div className="keys-copy">
                <h3>Keyboard reference</h3>
                <p>Orient your ear with a quick visual map.</p>
              </div>
              <div className="keys-controls">
                <span className="keys-meta">All octaves</span>
                <label className="octave-label" htmlFor="octave-select">
                  Practice octave
                </label>
                <select
                  id="octave-select"
                  className="octave-select"
                  value={octaveSelection}
                  onChange={handleOctaveChange}
                >
                  <option value="all">All (2-5)</option>
                  <option value="2">Octave 2</option>
                  <option value="3">Octave 3</option>
                  <option value="4">Octave 4</option>
                  <option value="5">Octave 5</option>
                </select>
              </div>
            </div>
            <PianoKeys highlightedNote={midiToNoteName(targetNote)} />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
