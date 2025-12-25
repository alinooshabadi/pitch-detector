/**
 * Pitch detection utilities: frequency-to-note conversion and stability voting
 */

// MIDI note names
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert frequency (Hz) to MIDI note number
 * Formula: midi = round(69 + 12 * log2(freq / 440))
 * where 69 is MIDI note A4 (440 Hz)
 */
export function frequencyToMidi(freq: number): number {
  if (freq <= 0) return -1;
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

/**
 * Convert MIDI note number to note name with octave
 * Example: 60 -> "C4", 61 -> "C#4"
 */
export function midiToNoteName(midi: number): string {
  if (midi < 0 || midi > 127) return '';
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Convert frequency directly to note name
 */
export function frequencyToNoteName(freq: number): string {
  const midi = frequencyToMidi(freq);
  return midiToNoteName(midi);
}

/**
 * Stability voting system: keeps a window of recent note detections
 * and accepts a note only if at least 70% of the window agrees
 */
export class NoteStabilityVoter {
  private window: (number | null)[] = [];
  private readonly windowSize: number;
  private readonly threshold: number; // 0.7 = 70%

  constructor(windowSize: number = 10, threshold: number = 0.7) {
    this.windowSize = windowSize;
    this.threshold = threshold;
  }

  /**
   * Add a detected MIDI note (or null if no pitch detected)
   * Returns the stable note if threshold is met, null otherwise
   */
  addDetection(midi: number | null): number | null {
    // Add to window
    this.window.push(midi);
    
    // Keep window size
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    // Need at least windowSize samples to make a decision
    if (this.window.length < this.windowSize) {
      return null;
    }

    // Filter out nulls (no pitch detected)
    const validNotes = this.window.filter((n): n is number => n !== null);
    
    if (validNotes.length === 0) {
      return null;
    }

    // Count occurrences of each note
    const counts = new Map<number, number>();
    for (const note of validNotes) {
      counts.set(note, (counts.get(note) || 0) + 1);
    }

    // Find the note with highest count
    let maxNote: number | null = null;
    let maxCount = 0;
    for (const [note, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        maxNote = note;
      }
    }

    // Check if it meets the threshold (70% of valid notes)
    if (maxNote !== null && maxCount / validNotes.length >= this.threshold) {
      return maxNote;
    }

    return null;
  }

  /**
   * Reset the voting window
   */
  reset(): void {
    this.window = [];
  }
}

/**
 * Generate a random MIDI note in the range C3 to C5 (48 to 72)
 */
export function randomTargetNote(): number {
  // C3 = 48, C5 = 72 (inclusive)
  return Math.floor(Math.random() * (72 - 48 + 1)) + 48;
}


