# Pitch Detector

A lightweight web app that displays a target musical note and listens through your microphone to tell you whether you're on pitch.

## Screenshot

<img width="2776" height="1348" alt="image" src="https://github.com/user-attachments/assets/90c3b0b8-bc74-4c39-9558-89b460b03d77" />

## Demo

Live demo: https://alinooshabadi.github.io/pitch-detector/


## Features

- Real-time pitch detection with live feedback
- Randomized target notes with octave selection
- Visual piano keys and sheet-music target display
- Stable detection via voting to reduce flicker

## Tech Stack

- React + TypeScript + Vite
- Web Audio API for microphone input
- aubiojs for pitch detection
- react-piano and OpenSheetMusicDisplay for visuals

## Getting Started

### Requirements

- Node.js 18+ (or any modern Node that works with Vite)
- A microphone-enabled browser (Chrome, Edge, or Safari)

### Install

```bash
npm install
```

### Run Dev Server

```bash
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

## Usage

1. Click "Start microphone" and allow microphone access.
2. Play or sing the target note.
3. When you match the pitch, the target updates automatically.

## How It Works

The app captures microphone audio with the Web Audio API, detects pitch with aubiojs, and converts the detected frequency into a MIDI note number. A stability voter keeps the most recent detections and only accepts a note once it is consistent, which smooths out jitter. When a stable note matches the current target (default range C2–C5), the UI shows success and selects a new target after a short delay.

## FAQ / Troubleshooting

**Microphone permission prompt doesn't appear.**
Make sure the site has mic access in your browser settings and that no other tab/app is using the microphone.

**No pitch detected or unstable readings.**
Try a quieter room, get closer to the mic, or use a more consistent tone (e.g., a tuner app or a sustained note).

**Browser compatibility.**
Works best in Chrome, Edge, and Safari. Some browsers or privacy settings may block audio input APIs.

## Roadmap / Future Ideas

- Alternate tunings and calibration (A4 reference)
- Instrument-specific modes (voice, guitar, violin)
- Practice modes (sustained note, interval training)
- Visual note history and accuracy stats

## Contributing

Issues and PRs are welcome. If you're planning a larger change, open an issue first so we can coordinate.

## License

No license has been specified yet. Add a `LICENSE` file to make the project explicitly open source.

## Credits / Acknowledgments

- [aubiojs](https://github.com/aubio/aubio) for pitch detection
- [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) for sheet music rendering
- [react-piano](https://github.com/kevinsqi/react-piano) for the piano keyboard UI
