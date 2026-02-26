import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Play, Square, Loader2, GraduationCap, BookOpen, Settings, X, Eraser } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

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
  const [showSettings, setShowSettings] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whiteboardItems, setWhiteboardItems] = useState<{text: string}[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(true);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const isFirstTurnRef = useRef(true);
  const hasReceivedContentRef = useRef(false);

  const isMicMutedRef = useRef(isMicMuted);
  const isVideoMutedRef = useRef(isVideoMuted);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMicMuted;
      });
    }
  }, [isMicMuted]);

  useEffect(() => {
    isVideoMutedRef.current = isVideoMuted;
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !isVideoMuted;
      });
    }
  }, [isVideoMuted]);

  const requestPermissions = async () => {
    setIsRequestingPermissions(true);
    setPermissionError(null);
    
    // Initialize AudioContext immediately on user gesture to unlock audio on mobile
    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
      // Resume immediately to handle Safari's strict gesture requirements
      playbackContextRef.current.resume();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setShowSplash(false);
      // Automatically start the session after permissions are granted
      startSession();
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
    
    // Stop the camera and mic tracks to turn off the indicators
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setWhiteboardItems([]);
  }, []);

  const startSession = async () => {
    try {
      setError(null);
      setIsConnecting(true);
      setIsMicMuted(true);
      isFirstTurnRef.current = true;
      hasReceivedContentRef.current = false;

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
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      if (playbackContextRef.current.state === 'suspended') {
        await playbackContextRef.current.resume();
      }
      
      nextPlayTimeRef.current = playbackContextRef.current.currentTime;

      // 3. Connect to Live API
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          systemInstruction: `Role: You are "OwlHelp!," a patient, encouraging, and highly observant expert Algebra tutor. Your goal is to help students truly understand math concepts, not just give them the answers.

Capabilities: 
- Vision: You can see the user's handwritten or printed math problems via their camera. Pay close attention to exactly what they are pointing at or writing.
- Whiteboard: You have a digital whiteboard. You can use the "writeOnWhiteboard" tool to draw diagrams, write equations, or explain concepts visually if the student needs extra help.

Initial Greeting: When the session starts, you will receive a prompt to introduce yourself. You MUST say exactly: "Welcome to OwlHelp!, your virtual tutor. How can I help you today? If you have a problem to work on, just point the camera there, and let's get started. You can also ask to use a whiteboard if you need some extra help."

Strict Rules of Engagement:
1. NEVER Give the Final Answer: You must never provide the solution to a problem. Even if you think the student knows it, you must wait for them to explicitly state or write it. If you are tempted to say the answer, ask a guiding question instead.
2. Explicit Verification: Verification means the student has clearly and unambiguously provided the final answer. If there is any doubt, ask: "What do you think the final answer is?" or "Can you write the final result for me?" Only after this explicit confirmation can you say, "That's correct!" or "You got it!".
3. No Spoilers: Do not hint at the final answer or jump ahead. Focus entirely on the current micro-step the student is working on.
4. Handle Ambiguity: If you are unsure what the student is writing or saying, DO NOT GUESS. Do not assume they have the right answer if the camera is blurry or the audio is unclear. Instead, ask the student to clarify, point more clearly, or repeat themselves.
5. Never Let the User Give Up: If a student is frustrated or wants to quit, provide extra encouragement and break the problem down into even smaller, more manageable micro-steps.
6. Prioritize Teaching: Your primary mission is to teach the concept. Use numbers, letters, and pictures (via the whiteboard) to assist them in visualizing the logic.
7. Follow Along with Steps: Recognize when the student is writing intermediate steps. Anticipate them writing steps and follow along as they write.
8. Keep the Whiteboard Updated: Use the whiteboard to mirror the student's work. Continuously update the whiteboard with the steps they've written so it shows the progression of the problem. Use the writeOnWhiteboard tool frequently.
9. Be the Guide: Use the Socratic method. Ask guiding questions to lead the student to the next step.
10. Acknowledge the Visuals: Explicitly state what you see so the student knows you are looking at their work. (e.g., "I see you are pointing at the denominator in that fraction.")
11. Catch Mistakes Live: If the student writes down a wrong number or makes a sign error, politely interrupt and point it out immediately.
12. Keep Responses Conversational: Keep your audio responses short, conversational, and natural.
13. Scaffold Learning: Break down complex problems into small, simple steps.
14. Use Analogies: Explain difficult concepts using relatable examples.
15. Positive Reinforcement: Use encouraging phrases like 'Great start!' or 'You're almost there!'.
16. Refocus: If the student gets off-topic, gently steer them back to their schoolwork.
17. Safety: Never ask for or store personal information about the child.
18. Math Formatting: When writing on the whiteboard, ALWAYS use LaTeX formatting for math equations. Use single dollar signs for inline math (e.g., $x=5$) and double dollar signs for block math (e.g., $$ \frac{1}{2} $$). ALWAYS ensure every opening delimiter has a matching closing delimiter. Align the math properly to show work happening on both sides of the equation.
19. Plain English Explanations: When using the whiteboard, always include a brief explanation in plain English alongside the math equations so the student understands the logic being shown.
20. Clear the Whiteboard: When moving to a new problem or if the whiteboard gets too cluttered, ALWAYS use the clearFirst: true parameter in the writeOnWhiteboard tool to start fresh.
21. Minimize Interruptions: Do not interrupt yourself just because the camera moved. Only interrupt if the student explicitly asks a new question or if they make a significant mistake that needs immediate correction. Finish your current thought before addressing minor visual changes.

You can also write on the virtual whiteboard using the writeOnWhiteboard tool to help explain concepts visually.`,
          tools: [{
            functionDeclarations: [
              {
                name: "writeOnWhiteboard",
                description: "Writes markdown text or math equations on the virtual whiteboard to help explain the problem visually. Use LaTeX for math.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "The markdown text or math equation to write. Always wrap math in $ or $$." },
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

            // Ensure audio context is resumed (browser safety)
            if (playbackContextRef.current?.state === 'suspended') {
              playbackContextRef.current.resume();
            }

            // Trigger initial greeting immediately
            sessionPromise.then(session => {
              session.sendClientContent({
                turns: [{
                  role: "user",
                  parts: [{ text: "Please introduce yourself exactly by saying: 'Welcome to OwlHelp!, your virtual tutor. How can I help you today? If you have a problem to work on, just point the camera there, and let's get started. You can also ask to use a whiteboard if you need some extra help.'" }]
                }],
                turnComplete: true
              });
              
              // Also send a tiny bit of silence to kickstart the realtime stream
              const silence = new Float32Array(16000 * 0.1); // 100ms of silence
              const pcm16 = new Int16Array(silence.length);
              session.sendRealtimeInput({
                media: {
                  mimeType: "audio/pcm;rate=16000",
                  data: arrayBufferToBase64(pcm16.buffer)
                }
              });
            });

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
            if (message.serverContent?.modelTurn) {
              hasReceivedContentRef.current = true;
            }
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

            // Unmute mic after introduction
            if (message.serverContent?.turnComplete && isFirstTurnRef.current && hasReceivedContentRef.current) {
              setIsMicMuted(false);
              isFirstTurnRef.current = false;
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
        {/* Settings Button */}
        <button 
          onClick={() => setShowSettings(true)}
          className="absolute top-6 right-6 z-50 text-slate-400 hover:text-white transition-colors"
        >
          <Settings className="w-8 h-8" />
        </button>

        {/* Settings Modal */}
        {showSettings && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-md p-8 relative max-h-[90vh] overflow-y-auto shadow-2xl">
              <button 
                onClick={() => setShowSettings(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <h2 className="text-3xl font-bold mb-6 text-white">Settings</h2>
              
              <div className="mb-8">
                <label className="block text-sm font-semibold text-slate-300 mb-2">AI Voice</label>
                <select 
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="Puck">Puck: Upbeat and energetic</option>
                  <option value="Charon">Charon: Informative and steady</option>
                  <option value="Kore">Kore: Firm and authoritative</option>
                  <option value="Fenrir">Fenrir: Excitable and high-energy</option>
                  <option value="Aoede">Aoede: Breezy and light</option>
                  <option value="Leda">Leda: Youthful and friendly</option>
                  <option value="Orus">Orus: Firm and consistent</option>
                  <option value="Zephyr">Zephyr: Bright and clear</option>
                  <option value="Callirrhoe">Callirrhoe: Easy-going and relaxed</option>
                  <option value="Autonoe">Autonoe: Bright</option>
                </select>
              </div>

              <div className="mb-8">
                <h3 className="text-xl font-bold mb-4 text-white">Instructions</h3>
                <ul className="space-y-3 text-slate-300 text-sm">
                  <li><strong>1. Start a Session:</strong> Click "Start Learning" and allow camera/microphone permissions.</li>
                  <li><strong>2. Show Your Work:</strong> Point your camera at your math problem. The AI can see what you're working on.</li>
                  <li><strong>3. Talk to OwlHelp!:</strong> Ask questions naturally. The AI will guide you step-by-step without just giving the answer.</li>
                  <li><strong>4. Use the Whiteboard:</strong> The AI will automatically use the digital whiteboard to show steps, or you can ask it to draw something specific.</li>
                  <li><strong>5. End Session:</strong> Click the Stop button when you're done to turn off the camera and mic.</li>
                </ul>
              </div>

              <div className="mt-12 flex flex-col items-center justify-center border-t border-slate-700 pt-8">
                <p className="text-xs text-slate-500 mb-4">Version 1.0.0</p>
                <img 
                  src="/Schmojologo.jpg" 
                  alt="SCHMOJO Logo" 
                  className="w-48 object-contain rounded-lg"
                />
              </div>
            </div>
          </div>
        )}

        {/* Decorative background elements */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col items-center max-w-md w-full bg-slate-900/80 p-8 rounded-3xl border border-slate-800 backdrop-blur-xl shadow-2xl">
          {/* Logo Area */}
          <style>{`
            @keyframes slowFlip {
              0% { transform: perspective(1000px) rotateY(-180deg); opacity: 0; }
              100% { transform: perspective(1000px) rotateY(0deg); opacity: 1; }
            }
          `}</style>
          <div 
            className="w-48 h-48 mb-6 relative rounded-full bg-white flex items-center justify-center border-4 border-slate-700 overflow-hidden shadow-xl"
            style={{ animation: 'slowFlip 2s cubic-bezier(0.23, 1, 0.32, 1) forwards', transformStyle: 'preserve-3d' }}
          >
            <img
              src="/owl-logo.png"
              alt="OwlHelp! Logo"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                document.getElementById('fallback-icon')!.style.display = 'flex';
              }}
            />
            <div id="fallback-icon" className="hidden flex-col items-center justify-center text-slate-400 w-full h-full bg-slate-800">
              <BookOpen className="w-12 h-12 mb-2 text-indigo-400" />
              <span className="text-xs font-medium text-center px-4">OwlHelp!</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-white mb-2 text-center tracking-tight">OwlHelp!</h1>
          <p className="text-slate-400 text-center mb-8 text-sm leading-relaxed">Your Virtual Learning Buddy is ready to help you with your homework!</p>

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
                <Play className="w-5 h-5 fill-current" />
                Start Learning
              </>
            )}
          </button>
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
              alt="OwlHelp! Logo"
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
          <h1 className="text-white font-bold text-xl tracking-tight drop-shadow-md">OwlHelp!</h1>
        </div>
        {isConnected && (
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-400 text-xs font-medium uppercase tracking-wider">Live</span>
          </div>
        )}
      </div>

      {/* Whiteboard Area */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-start p-8 mt-20 mb-32 z-10 overflow-y-auto scrollbar-hide">
        <div className="w-full max-w-3xl pointer-events-auto">
          {whiteboardItems.map((item, i) => (
            <div 
              key={i} 
              className="bg-white/95 backdrop-blur-sm text-slate-900 p-6 rounded-2xl shadow-2xl text-xl md:text-3xl mb-6 border border-slate-200 transform transition-all duration-500 ease-out translate-y-0 opacity-100 w-full break-words"
              style={{ animation: 'slideUpFade 0.5s ease-out' }}
            >
              <div className="markdown-body prose prose-slate prose-lg max-w-none overflow-x-auto">
                <Markdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                  {item.text}
                </Markdown>
              </div>
            </div>
          ))}
        </div>
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

            <button
              onClick={() => setWhiteboardItems([])}
              className="p-4 rounded-full bg-white/20 text-white hover:bg-white/30 backdrop-blur-md border border-white/10 transition-all"
              title="Clear Whiteboard"
            >
              <Eraser className="w-6 h-6" />
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
