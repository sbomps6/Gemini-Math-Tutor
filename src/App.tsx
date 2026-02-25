import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Play, Square, Loader2, GraduationCap, BookOpen } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whiteboardItems, setWhiteboardItems] = useState<{text: string}[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const videoIntervalRef = useRef<number | null>(null);

  const isMicMutedRef = useRef(isMicMuted);
  const isVideoMutedRef = useRef(isVideoMuted);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    isVideoMutedRef.current = isVideoMuted;
  }, [isVideoMuted]);

  const requestPermissions = async () => {
    setIsRequestingPermissions(true);
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setShowSplash(false);
    } catch (err) {
      console.error("Permission error:", err);
      setPermissionError("We need camera and microphone access to see your homework and hear your questions. Please allow access in your browser settings.");
    } finally {
      setIsRequestingPermissions(false);
    }
  };

  useEffect(() => {
    if (!showSplash && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [showSplash]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    // We intentionally DO NOT stop the media stream tracks here
    // so the camera preview stays active between sessions.
    setIsConnected(false);
    setIsConnecting(false);
    setWhiteboardItems([]);
  }, []);

  const startSession = async () => {
    try {
      setError(null);
      setIsConnecting(true);

      // 1. Get Media Stream (use existing if available)
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every(t => t.readyState === 'ended')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }

      // 2. Setup Audio Playback
      playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = playbackContextRef.current.currentTime;

      // 3. Connect to Live API
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `Role: You are "OwlTutor," a patient, encouraging, and highly observant expert Algebra tutor. Your goal is to help students truly understand math concepts, not just give them the answers.

Capabilities: You have vision. The user will show you their handwritten or printed math problems via their camera. You must pay close attention to exactly what they are pointing at or writing.

Strict Rules of Engagement:
1. Never Give the Final Answer: Under no circumstances should you just solve the problem for them.
2. Be the Guide: Use the Socratic method. Ask guiding questions to lead the student to the next step.
3. Acknowledge the Visuals: Explicitly state what you see so the student knows you are looking at their work. (e.g., "I see you are pointing at the denominator in that fraction.")
4. Catch Mistakes Live: If the student writes down a wrong number or makes a sign error (like dropping a negative sign), politely interrupt and point it out immediately.
5. Keep Responses Conversational: Keep your audio responses short, conversational, and natural. Do not lecture for long periods. Pause and let the student respond.
6. Scaffold Learning: Break down complex problems into small, simple steps.
7. Use Analogies: Explain difficult concepts using relatable examples (e.g., 'fractions are like slices of pizza').
8. Positive Reinforcement: Use emojis and encouraging phrases like 'Great start!' or 'You're almost there!'.
9. Refocus: If the student gets off-topic, gently steer them back to their schoolwork.
10. Safety: Never ask for or store personal information about the child.

You can also write on the virtual whiteboard using the writeOnWhiteboard tool to help explain concepts visually.`,
          tools: [{
            functionDeclarations: [
              {
                name: "writeOnWhiteboard",
                description: "Writes text or math equations on the virtual whiteboard to help explain the problem visually.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "The text or math equation to write." },
                    clearFirst: { type: Type.BOOLEAN, description: "Whether to clear the whiteboard before writing." }
                  },
                  required: ["text"]
                }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);

            // Setup Audio Capture
            audioContextRef.current = new AudioContext({ sampleRate: 16000 });
            const source = audioContextRef.current.createMediaStreamSource(stream!);
            const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            source.connect(processor);
            processor.connect(audioContextRef.current.destination);

            processor.onaudioprocess = (e) => {
              if (isMicMutedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              const base64Data = arrayBufferToBase64(pcm16.buffer);
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };

            // Setup Video Capture
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            videoIntervalRef.current = window.setInterval(() => {
              if (isVideoMutedRef.current) return;
              if (videoRef.current && videoRef.current.readyState >= 2 && ctx) {
                // Resize to max 720p to save bandwidth
                const maxDim = 720;
                let w = videoRef.current.videoWidth;
                let h = videoRef.current.videoHeight;
                if (w > maxDim || h > maxDim) {
                  if (w > h) {
                    h = Math.round((h * maxDim) / w);
                    w = maxDim;
                  } else {
                    w = Math.round((w * maxDim) / h);
                    h = maxDim;
                  }
                }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(videoRef.current, 0, 0, w, h);
                const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                sessionPromise.then(session => {
                  session.sendRealtimeInput({
                    media: { data: base64Data, mimeType: 'image/jpeg' }
                  });
                });
              }
            }, 1000); // 1 FPS
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && playbackContextRef.current) {
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcm16 = new Int16Array(bytes.buffer);
              const float32 = new Float32Array(pcm16.length);
              for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768;
              }
              const audioBuffer = playbackContextRef.current.createBuffer(1, float32.length, 24000);
              audioBuffer.getChannelData(0).set(float32);
              
              const source = playbackContextRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(playbackContextRef.current.destination);
              
              const startTime = Math.max(playbackContextRef.current.currentTime, nextPlayTimeRef.current);
              source.start(startTime);
              nextPlayTimeRef.current = startTime + audioBuffer.duration;
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              if (playbackContextRef.current) {
                playbackContextRef.current.close();
                playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
                nextPlayTimeRef.current = playbackContextRef.current.currentTime;
              }
            }

            // Handle tool calls
            const toolCalls = message.toolCall?.functionCalls;
            if (toolCalls) {
              const responses = toolCalls.map(call => {
                if (call.name === 'writeOnWhiteboard') {
                  const args = call.args as any;
                  setWhiteboardItems(prev => {
                    const newItems = args.clearFirst ? [] : [...prev];
                    newItems.push({ text: args.text });
                    return newItems;
                  });
                  return {
                    id: call.id,
                    name: call.name,
                    response: { result: "success" }
                  };
                }
                return {
                  id: call.id,
                  name: call.name,
                  response: { error: "Unknown function" }
                };
              });
              
              sessionPromise.then(session => {
                session.sendToolResponse({ functionResponses: responses });
              });
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            stopSession();
          },
          onclose: () => {
            stopSession();
          }
        }
      });
      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error("Failed to start session:", err);
      setError(err.message || "Failed to start session");
      setIsConnecting(false);
      stopSession();
    }
  };

  useEffect(() => {
    return () => {
      stopSession();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [stopSession]);

  if (showSplash) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col items-center max-w-md w-full bg-slate-900/80 p-8 rounded-3xl border border-slate-800 backdrop-blur-xl shadow-2xl">
          {/* Logo Area */}
          <div className="w-48 h-48 mb-6 relative rounded-full bg-white flex items-center justify-center border-4 border-slate-700 overflow-hidden shadow-xl">
            <img
              src="/owl-logo.png"
              alt="OwlTutor Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                document.getElementById('fallback-icon')!.style.display = 'flex';
              }}
            />
            <div id="fallback-icon" className="hidden flex-col items-center justify-center text-slate-400 w-full h-full bg-slate-800">
              <BookOpen className="w-12 h-12 mb-2 text-indigo-400" />
              <span className="text-xs font-medium text-center px-4">OwlTutor</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-white mb-2 text-center tracking-tight">OwlTutor</h1>
          <p className="text-slate-400 text-center mb-8 text-sm leading-relaxed">Your Virtual Learning Buddy is ready to help you with your math homework!</p>

          {permissionError && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm p-4 rounded-xl mb-6 text-center w-full">
              {permissionError}
            </div>
          )}

          <button
            onClick={requestPermissions}
            disabled={isRequestingPermissions}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:text-indigo-300 text-white font-semibold py-4 px-6 rounded-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
          >
            {isRequestingPermissions ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <Video className="w-5 h-5" />
                <Mic className="w-5 h-5" />
                Allow Camera & Mic
              </>
            )}
          </button>
          <p className="text-slate-500 text-xs text-center mt-6">
            We need access to see your homework and hear your questions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col font-sans">
      {/* Video Background */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        playsInline
        muted
      />

      {/* Overlay Gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white overflow-hidden shadow-lg border-2 border-white/20">
            <img
              src="/owl-logo.png"
              alt="OwlTutor Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                document.getElementById('fallback-header-icon')!.style.display = 'flex';
              }}
            />
            <div id="fallback-header-icon" className="hidden w-full h-full bg-indigo-600 items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
          </div>
          <h1 className="text-white font-bold text-xl tracking-tight drop-shadow-md">OwlTutor</h1>
        </div>
        {isConnected && (
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-400 text-xs font-medium uppercase tracking-wider">Live</span>
          </div>
        )}
      </div>

      {/* Whiteboard Area */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8 mt-16 mb-32 z-10">
        {whiteboardItems.map((item, i) => (
          <div 
            key={i} 
            className="bg-white/95 backdrop-blur-sm text-slate-900 p-6 rounded-2xl shadow-2xl text-2xl md:text-4xl font-mono mb-4 border border-slate-200 transform transition-all duration-500 ease-out translate-y-0 opacity-100"
            style={{ animation: 'slideUpFade 0.5s ease-out' }}
          >
            {item.text}
          </div>
        ))}
      </div>

      {/* Error Message */}
      {error && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-lg backdrop-blur-md z-20 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-8 flex justify-center items-center gap-6 z-20">
        {!isConnected && !isConnecting ? (
          <button
            onClick={startSession}
            className="flex items-center gap-3 bg-white text-black px-8 py-4 rounded-full font-semibold text-lg hover:scale-105 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.3)]"
          >
            <Play className="w-6 h-6 fill-current" />
            Start Tutoring
          </button>
        ) : isConnecting ? (
          <div className="flex items-center gap-3 bg-white/20 backdrop-blur-md text-white px-8 py-4 rounded-full font-semibold text-lg border border-white/10">
            <Loader2 className="w-6 h-6 animate-spin" />
            Connecting...
          </div>
        ) : (
          <>
            <button
              onClick={() => setIsMicMuted(!isMicMuted)}
              className={`p-4 rounded-full backdrop-blur-md transition-all ${
                isMicMuted 
                  ? 'bg-red-500/80 text-white hover:bg-red-500' 
                  : 'bg-white/20 text-white hover:bg-white/30 border border-white/10'
              }`}
            >
              {isMicMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            
            <button
              onClick={stopSession}
              className="p-5 rounded-full bg-red-500 text-white hover:bg-red-600 hover:scale-105 transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)]"
            >
              <Square className="w-6 h-6 fill-current" />
            </button>

            <button
              onClick={() => setIsVideoMuted(!isVideoMuted)}
              className={`p-4 rounded-full backdrop-blur-md transition-all ${
                isVideoMuted 
                  ? 'bg-red-500/80 text-white hover:bg-red-500' 
                  : 'bg-white/20 text-white hover:bg-white/30 border border-white/10'
              }`}
            >
              {isVideoMuted ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
