import { useMemo } from "react";
import { MidiNumbers, Piano } from "react-piano";
import "react-piano/dist/styles.css";
import "./PianoKeys.css";

interface PianoKeysProps {
  highlightedNote?: string; // Optional note to highlight (e.g., "C4", "A#3")
  octaveRange?: { start: number; end: number }; // Optional octave range to display
}

const normalizeNoteName = (note: string): string | null => {
  const match = note.trim().match(/^([A-Ga-g])(#?)(-?\d+)$/);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  return `${letter.toLowerCase()}${accidental}${octave}`;
};

const PianoKeys = ({
  highlightedNote,
  octaveRange = { start: 0, end: 8 },
}: PianoKeysProps) => {
  const firstNote = useMemo(
    () => MidiNumbers.fromNote(`c${octaveRange.start}`),
    [octaveRange.start]
  );
  const lastNote = useMemo(
    () => MidiNumbers.fromNote(`b${octaveRange.end}`),
    [octaveRange.end]
  );
  const activeNotes = useMemo(() => {
    if (!highlightedNote) return [];
    const normalized = normalizeNoteName(highlightedNote);
    if (!normalized) return [];
    return [MidiNumbers.fromNote(normalized)];
  }, [highlightedNote]);

  return (
    <div className="piano-keys piano-keys--full">
      <Piano
        noteRange={{ first: firstNote, last: lastNote }}
        activeNotes={activeNotes}
        playNote={() => {}}
        stopNote={() => {}}
        keyWidthToHeight={0.32}
        className="piano-highlight"
      />
    </div>
  );
};

export default PianoKeys;
