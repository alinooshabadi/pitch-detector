import { useEffect, useRef } from "react";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import "./SheetMusicNote.css";

type SheetMusicNoteProps = {
  noteMidi: number;
  scale?: number;
};

const PITCHES = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: 0 },
];

const midiToPitch = (midi: number) => {
  const safeMidi = Number.isFinite(midi) ? Math.round(midi) : 60;
  const pitchClass = ((safeMidi % 12) + 12) % 12;
  const pitch = PITCHES[pitchClass];
  const octave = Math.floor(safeMidi / 12) - 1;
  return { ...pitch, octave };
};

const buildMusicXml = (noteMidi: number): string => {
  const { step, alter, octave } = midiToPitch(noteMidi);
  const clef = noteMidi < 60 ? { sign: "F", line: 4 } : { sign: "G", line: 2 };
  const alterTag = alter === 0 ? "" : `<alter>${alter}</alter>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Pitch</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>${clef.sign}</sign>
          <line>${clef.line}</line>
        </clef>
      </attributes>
      <note>
        <rest/>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch>
          <step>${step}</step>
          ${alterTag}
          <octave>${octave}</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <rest/>
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
};

const SheetMusicNote = ({ noteMidi, scale = 1.6 }: SheetMusicNoteProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(container, {
        autoResize: true,
        drawTitle: false,
      });
    }

    const osmd = osmdRef.current;
    let isActive = true;

    const renderScore = async () => {
      try {
        await osmd.load(buildMusicXml(noteMidi));
        osmd.Zoom = scale;
        await osmd.render();
      } catch (error) {
        if (isActive) {
          console.error("Failed to render sheet music:", error);
        }
      }
    };

    renderScore();

    return () => {
      isActive = false;
    };
  }, [noteMidi, scale]);

  return (
    <div className="sheet-music-wrapper">
      <div ref={containerRef} className="sheet-music" />
    </div>
  );
};

export default SheetMusicNote;
