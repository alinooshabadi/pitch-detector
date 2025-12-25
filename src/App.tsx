import { useState, useRef, useEffect } from 'react';
import { YIN } from 'pitchfinder';
import {
  frequencyToMidi,
  frequencyToNoteName,
  midiToNoteName,
  NoteStabilityVoter,
  randomTargetNote,
} from './pitch';
import './App.css';

type Status = 'idle' | 'listening' | 'no-pitch' | 'detected' | 'correct' | 'try-again';

function App() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [targetNote, setTargetNote] = useState<number>(randomTargetNote());
  const [detectedNote, setDetectedNote] = useState<string>('');
  const [detectedFreq, setDetectedFreq] = useState<number>(0);

  // Refs for audio processing (avoid re-renders)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Float32Array | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const voterRef = useRef<NoteStabilityVoter>(new NoteStabilityVoter(10, 0.7));
  const correctTimeoutRef = useRef<number | null>(null);

  // Initialize pitch detector (YIN algorithm from pitchfinder)
  const detectPitch = YIN({ sampleRate: 44100 });

  /**
   * Start microphone capture and pitch detection loop
   */
  const startMicrophone = async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Create AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create analyser node
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Create data array for audio samples
      const bufferLength = analyser.fftSize;
      const dataArray = new Float32Array(bufferLength);
      dataArrayRef.current = dataArray;

      setIsListening(true);
      setStatus('listening');
      voterRef.current.reset();

      // Start pitch detection loop
      const detectLoop = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;

        // Get audio data
        analyserRef.current.getFloatTimeDomainData(dataArrayRef.current);

        // Detect pitch
        const frequency = detectPitch(dataArrayRef.current);

        if (frequency && frequency > 0) {
          // Convert to MIDI note
          const midi = frequencyToMidi(frequency);

          // Add to stability voter
          const stableNote = voterRef.current.addDetection(midi);

          if (stableNote !== null) {
            // We have a stable note detection
            const noteName = midiToNoteName(stableNote);
            setDetectedNote(noteName);
            setDetectedFreq(frequency);
            setStatus('detected');

            // Check if it matches target
            if (stableNote === targetNote) {
              setStatus('correct');
              
              // Clear any existing timeout
              if (correctTimeoutRef.current) {
                clearTimeout(correctTimeoutRef.current);
              }

              // Pick new target after 800ms
              correctTimeoutRef.current = window.setTimeout(() => {
                const newTarget = randomTargetNote();
                setTargetNote(newTarget);
                voterRef.current.reset();
                setStatus('listening');
                setDetectedNote('');
                setDetectedFreq(0);
              }, 800);
            } else {
              setStatus('try-again');
            }
          } else {
            // Not stable yet, but we have a pitch
            setStatus('listening');
          }
        } else {
          // No pitch detected
          setStatus('no-pitch');
          setDetectedNote('');
          setDetectedFreq(0);
        }

        // Continue loop
        animationFrameRef.current = requestAnimationFrame(detectLoop);
      };

      detectLoop();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Failed to access microphone. Please check permissions.');
      setIsListening(false);
      setStatus('idle');
    }
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
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
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

    // Reset state
    setIsListening(false);
    setStatus('idle');
    setDetectedNote('');
    setDetectedFreq(0);
    voterRef.current.reset();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, []);

  // Get status text
  const getStatusText = (): string => {
    switch (status) {
      case 'idle':
        return 'Ready to start';
      case 'listening':
        return 'Listening...';
      case 'no-pitch':
        return 'No pitch detected';
      case 'detected':
        return `Detected: ${detectedNote} (${detectedFreq.toFixed(1)} Hz)`;
      case 'correct':
        return 'Correct!';
      case 'try-again':
        return 'Try again';
      default:
        return '';
    }
  };

  return (
    <div className="app">
      <h1 className="target-note">Play: {midiToNoteName(targetNote)}</h1>
      
      <div className="status">{getStatusText()}</div>

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
  );
}

export default App;
