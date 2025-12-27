import { useEffect, useMemo, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(element.clientWidth);
      setWidth((prev) => (Math.abs(prev - nextWidth) > 1 ? nextWidth : prev));
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(element);
      return () => observer.disconnect();
    }

    const onResize = () => updateWidth();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
    <div className="piano-keys" ref={containerRef}>
      {width > 0 && (
        <Piano
          noteRange={{ first: firstNote, last: lastNote }}
          activeNotes={activeNotes}
          playNote={() => {}}
          stopNote={() => {}}
          width={Math.max(320, width)}
          keyWidthToHeight={0.3}
          className="piano-highlight"
        />
      )}
    </div>
  );
};

export default PianoKeys;
