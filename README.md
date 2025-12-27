# Pitch Detector

A lightweight web app that displays a target musical note and listens through your microphone to tell you whether you're on pitch.

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

## Contributing

Issues and PRs are welcome. If you're planning a larger change, open an issue first so we can coordinate.

## License

No license has been specified yet. Add a `LICENSE` file to make the project explicitly open source.
