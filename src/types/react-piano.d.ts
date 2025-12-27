declare module "react-piano" {
  import * as React from "react";

  export const MidiNumbers: {
    fromNote(note: string): number;
  };

  export interface PianoProps {
    noteRange: { first: number; last: number };
    activeNotes?: number[];
    playNote: (midi: number) => void;
    stopNote: (midi: number) => void;
    width: number;
    keyWidthToHeight?: number;
    className?: string;
  }

  export class Piano extends React.Component<PianoProps> {}
}
