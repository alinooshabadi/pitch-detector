import {
  type ChangeEvent,
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";
import "./App.css";
import { type OctaveRange, usePitchDetection } from "./hooks/usePitchDetection";
import PianoKeys from "./components/PianoKeys";
import SheetMusicNote from "./components/SheetMusicNote";
import {
  midiToFrequency,
  midiToNoteName,
  randomTargetNote,
} from "./utils/pitch";

type ReferenceTone = "sine" | "piano" | "off";

const DEFAULT_OCTAVE = 4;
const DEFAULT_OCTAVE_RANGE: OctaveRange = {
  start: DEFAULT_OCTAVE,
  end: DEFAULT_OCTAVE,
};
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [octaveSelection, setOctaveSelection] = useState(
    String(DEFAULT_OCTAVE)
  );
  const [octaveRange, setOctaveRange] =
    useState<OctaveRange>(DEFAULT_OCTAVE_RANGE);
  const [referenceTone, setReferenceTone] =
    useState<ReferenceTone>("piano");
  const [targetNote, setTargetNote] = useState<number>(() =>
    randomTargetNote(DEFAULT_OCTAVE_RANGE)
  );
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeoutRef = useRef<number | null>(null);
  const [isPlayingTarget, setIsPlayingTarget] = useState(false);

  const {
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
  } = usePitchDetection({
    targetNote,
    octaveRange,
    onTargetChange: setTargetNote,
  });

  const handleOctaveChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selection = event.target.value;
    const octave = Number(selection);
    if (!Number.isFinite(octave)) return;

    const range = { start: octave, end: octave };
    setOctaveSelection(selection);
    setOctaveRange(range);

    const newTarget = randomTargetNote(range);
    setTargetFromUser(newTarget, isListening ? "listening" : "idle");
  };

  const playTargetNote = async () => {
    try {
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

      const frequency = midiToFrequency(targetNote);
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
  }, [stopMicrophone]);

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
  const targetNoteLabel = targetNoteName.replace(/-?\d+$/, "");
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
        <div className="header-status-group">
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
          <div className="header-status" role="status" aria-live="polite">
            {getStatusText()}
          </div>
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
              <button
                type="button"
                className="target-note"
                onClick={playTargetNote}
                disabled={isPlayingTarget || referenceTone === "off"}
                aria-label="Play target note"
              >
                {targetNoteLabel}
              </button>
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
        <p className="hero-caption">Hold a steady tone to lock the match.</p>
        <div className="hero-staff">
          <SheetMusicNote noteMidi={targetNote} scale={1.2} />
        </div>
      </main>

      <footer className="piano-footer">
        <div className="piano-board">
          <PianoKeys highlightedNote={targetNoteName} />
        </div>
      </footer>
    </div>
  );
}

export default App;
