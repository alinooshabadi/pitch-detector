import { useEffect, useRef, useState } from "react";
import { MidiNumbers, Piano } from "react-piano";
import "react-piano/dist/styles.css";
import "./PianoKeys.css";

interface PianoKeysProps {
  highlightedNote?: string; // Optional note to highlight (e.g., "C4", "A#3")
}

const FIRST_NOTE = MidiNumbers.fromNote("a0");
const LAST_NOTE = MidiNumbers.fromNote("c8");

const normalizeNoteName = (note: string): string | null => {
  const match = note.trim().match(/^([A-Ga-g])(#?)(-?\d+)$/);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  return `${letter.toLowerCase()}${accidental}${octave}`;
};

const PianoKeys = ({ highlightedNote }: PianoKeysProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pianoWidth, setPianoWidth] = useState(0);

  const activeNotes = (() => {
    if (!highlightedNote) return [];
    const normalized = normalizeNoteName(highlightedNote);
    if (!normalized) return [];
    return [MidiNumbers.fromNote(normalized)];
  })();

  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.getBoundingClientRect().width;
    setPianoWidth(Math.max(0, Math.floor(width)));
  }, []);

  return (
    <div className="piano-keys piano-keys--full" ref={containerRef}>
      {pianoWidth > 0 && (
        <Piano
          noteRange={{ first: FIRST_NOTE, last: LAST_NOTE }}
          activeNotes={activeNotes}
          playNote={() => {}}
          stopNote={() => {}}
          width={pianoWidth}
          keyWidthToHeight={0.24}
          className="piano-highlight"
        />
      )}
    </div>
  );
};

export default PianoKeys;
