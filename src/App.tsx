import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Play, Square, Loader2, GraduationCap, BookOpen, Settings, X, Eraser, Minimize2, Maximize2, Download, Volume2, VolumeX } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';

mermaid.initialize({ 
  startOnLoad: false, 
  theme: 'neutral',
  securityLevel: 'loose',
  fontFamily: 'Inter, system-ui, sans-serif',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
    padding: 20
  },
  themeVariables: {
    fontSize: '16px'
  }
});

const MermaidChart = ({ chart }: { chart: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (chart) {
      setRenderError(false);
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      
      // Small delay to ensure DOM is ready and avoid race conditions on mobile
      const timer = setTimeout(() => {
        mermaid.render(id, chart)
          .then((result) => {
            if (isMounted) setSvg(result.svg);
          })
          .catch(e => {
            console.error('Mermaid render error:', e);
            if (isMounted) setRenderError(true);
            // Mermaid sometimes leaves error SVGs in the DOM on failure
            const errorSvg = document.getElementById(id);
            if (errorSvg) errorSvg.remove();
            const errorSvg2 = document.getElementById('d' + id);
            if (errorSvg2) errorSvg2.remove();
            // Clean up any other orphaned error SVGs
            document.querySelectorAll('svg[id^="dmermaid-"]').forEach(el => el.remove());
            document.querySelectorAll('svg[id^="mermaid-"]').forEach(el => el.remove());
          });
      }, 50);

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }
  }, [chart]);

  if (renderError) {
    return (
      <div className="p-4 bg-slate-100 rounded-lg text-xs font-mono text-slate-500 my-4 overflow-x-auto border border-slate-200">
        <div className="font-bold mb-2 text-slate-400 uppercase tracking-wider text-[10px]">Diagram Render Error</div>
        <pre className="whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }

  return (
    <div 
      key={chart}
      ref={ref} 
      dangerouslySetInnerHTML={{ __html: svg }} 
      className="flex justify-center my-4 overflow-x-auto w-full mermaid-container bg-white/50 rounded-xl p-2 min-h-[100px]" 
    />
  );
};

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
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whiteboardItems, setWhiteboardItems] = useState<{text: string}[]>([]);
  const [isWhiteboardMinimized, setIsWhiteboardMinimized] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(true);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showScrollHint, setShowScrollHint] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const whiteboardScrollRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const isFirstTurnRef = useRef(true);
  const hasReceivedContentRef = useRef(false);
  const isMicMutedRef = useRef(isMicMuted);

  const markdownComponents = useMemo(() => ({
    code({node, inline, className, children, ...props}: any) {
      const match = /language-(\w+)/.exec(className || '');
      if (match && match[1] === 'mermaid') {
        return <MermaidChart chart={String(children).replace(/\n$/, '')} />;
      }
      return <code className={className} {...props}>{children}</code>;
    }
  }), []);
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

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  const handleScroll = useCallback(() => {
    if (whiteboardScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = whiteboardScrollRef.current;
      // Use a slightly larger threshold for mobile
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollHint(!isAtBottom && scrollHeight > clientHeight + 50);
      
      // If we are scrolling and it's been less than 1500ms since last touch/mouse down,
      // consider it a user-initiated scroll (including momentum)
      if (Date.now() - lastUserInteractionRef.current < 1500) {
        isUserScrollingRef.current = true;
      } else {
        isUserScrollingRef.current = false;
      }
    }
  }, []);

  // Auto-scroll whiteboard and handle scroll hints
  useEffect(() => {
    if (whiteboardScrollRef.current && whiteboardItems.length > 0) {
      const el = whiteboardScrollRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
      
      const timer = setTimeout(() => {
        const isInteracting = Date.now() - lastUserInteractionRef.current < 2000;
        if (isNearBottom && !isInteracting && !isUserScrollingRef.current) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        }
        handleScroll();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [whiteboardItems, handleScroll]);

  // Handle resize of content (like mermaid charts loading)
  useEffect(() => {
    if (!whiteboardScrollRef.current) return;
    
    const resizeObserver = new ResizeObserver(() => {
      const el = whiteboardScrollRef.current;
      if (el) {
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
        const isInteracting = Date.now() - lastUserInteractionRef.current < 2000;
        if (isNearBottom && !isInteracting && !isUserScrollingRef.current) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        }
        handleScroll();
      }
    });

    const content = whiteboardScrollRef.current.firstElementChild;
    if (content) resizeObserver.observe(content);
    
    return () => resizeObserver.disconnect();
  }, [handleScroll]);

  const initPlaybackContext = useCallback(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
      try {
        playbackContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      } catch (e) {
        playbackContextRef.current = new AudioContextClass();
      }
    }
    
    if (playbackContextRef.current && (!gainNodeRef.current || gainNodeRef.current.context !== playbackContextRef.current)) {
      gainNodeRef.current = playbackContextRef.current.createGain();
      gainNodeRef.current.connect(playbackContextRef.current.destination);
      gainNodeRef.current.gain.value = volume;
    }
    
    return playbackContextRef.current;
  }, [volume]);

  const requestPermissions = async () => {
    setIsRequestingPermissions(true);
    setPermissionError(null);
    
    // Initialize AudioContext immediately on user gesture to unlock audio on mobile
    const context = initPlaybackContext();
    
    try {
      // Resume immediately to handle strict gesture requirements
      if (context) await context.resume();

      // Prime the audio system with a short, nearly silent beep
      if (context && gainNodeRef.current) {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(gainNodeRef.current);
        gainNode.gain.value = 0.001; 
        oscillator.start();
        oscillator.stop(context.currentTime + 0.05);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
      
      // Re-resume after getUserMedia to reclaim gesture context if lost during permission prompt
      if (playbackContextRef.current.state === 'suspended') {
        await playbackContextRef.current.resume();
      }

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

  const downloadNotes = useCallback(() => {
    if (whiteboardItems.length === 0) return;
    const content = whiteboardItems.map(item => item.text).join('\n\n---\n\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `owlhelp-notes-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [whiteboardItems]);

  const startSession = async () => {
    try {
      setError(null);
      setIsConnecting(true);
      setIsMicMuted(true);
      isFirstTurnRef.current = true;
      hasReceivedContentRef.current = false;
      setWhiteboardItems([{ text: "Unmute the mic below and say hello when ready." }]);

      // 1. Setup Audio Playback & Input Contexts IMMEDIATELY on user gesture
      const context = initPlaybackContext();
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        try {
          audioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
        } catch (e) {
          audioContextRef.current = new AudioContextClass(); // Fallback for older Safari
        }
      }
      
      // Resume immediately to unlock audio on iOS/Safari
      if (context && context.state === 'suspended') {
        context.resume();
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      // 2. Get Media Stream (use existing if available)
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every(t => t.readyState === 'ended')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
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

Initial Greeting: When the session starts, the user will send a message saying "Session started." You MUST immediately respond by introducing yourself. You MUST say exactly: "Welcome to OwlHelp!, your virtual tutor. How can I help you today? If you have a problem to work on, just point the camera there, and let's get started. You can also ask to use a whiteboard if you need some extra help." Do not wait for the user to speak.

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
22. Diagram Support: You can draw diagrams, flowcharts, number lines, and geometric shapes on the whiteboard using Mermaid.js. To do this, use the 'mermaidCode' parameter in the writeOnWhiteboard tool.
    - CRITICAL: Pass ONLY the raw Mermaid code in the 'mermaidCode' parameter. Do NOT wrap it in markdown backticks. Do NOT put text in this parameter.
    - CRITICAL: You MUST NOT combine different diagram types (e.g., 'pie' and 'graph TD') in a single tool call. If you need both, make two separate calls.
    - For Number Lines (e.g., x=4): Use 'graph LR' with nodes for each number. Use double parentheses '(( ))' for the target point to make it a circle.
      Example: graph LR\nn1[-1]---n2[0]---n3[1]---n4[2]---n5[3]---n6((4))---n7[5]\nstyle n6 fill:#fbbf24,stroke:#b45309,stroke-width:4px
    - For Geometric Shapes: Use 'graph TD' or 'graph LR' with custom node shapes.
      - Circle: node1((Text))
      - Square: node1[Text]
      - Rhombus: node1{Text}
      - Triangle-ish: node1>Text]
      - Cylinder: node1[(Text)] (This is the ONLY way to draw a cylinder)
      Example: graph TD\nc1[(Cylinder)]
    - For Pie Charts: Use 'pie' syntax. Each data point MUST be on a new line. The title MUST be on a single line.
      Example: pie title Pets\n"Dogs" : 386\n"Cats" : 85
    - For Flowcharts: Use 'graph TD' or 'graph LR'.
    - ALWAYS ensure the Mermaid code is valid and follows the specific syntax for each type.
23. Double Check Your Work: Always double-check your own math and logic internally before speaking or writing it on the whiteboard to ensure it is 100% correct prior to showing the student.

You MUST use the writeOnWhiteboard tool whenever you want to show a diagram, chart, or long explanation. Do not just speak it.`,
          tools: [{
            functionDeclarations: [
              {
                name: "writeOnWhiteboard",
                description: "Writes markdown text, math equations, or Mermaid.js diagrams on the virtual whiteboard.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    text: { 
                      type: Type.STRING, 
                      description: "The markdown text or math equation to write. Always wrap math in $ or $$." 
                    },
                    mermaidCode: { 
                      type: Type.STRING, 
                      description: "The raw Mermaid.js code to draw a diagram. Do NOT wrap in backticks. Do NOT include markdown. Just the raw mermaid code." 
                    },
                    clearFirst: { type: Type.BOOLEAN, description: "Whether to clear the whiteboard before writing." }
                  }
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

            // Play a local chime to indicate readiness and wake up the audio context
            if (playbackContextRef.current) {
              const sampleRate = playbackContextRef.current.sampleRate;
              const duration = 0.4;
              const length = Math.floor(sampleRate * duration);
              const audioBuffer = playbackContextRef.current.createBuffer(1, length, sampleRate);
              const channelData = audioBuffer.getChannelData(0);
              for (let i = 0; i < length; i++) {
                const t = i / sampleRate;
                const envelope = Math.exp(-t * 10);
                channelData[i] = Math.sin(2 * Math.PI * 880 * t) * envelope * 0.3;
              }
              const source = playbackContextRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(playbackContextRef.current.destination);
              source.start();
            }

            sessionPromise.then(session => {
              // Small delay then send the greeting request
              setTimeout(() => {
                session.sendClientContent({
                  turns: [{
                    role: "user",
                    parts: [{ text: "Session started." }]
                  }],
                  turnComplete: true
                });
              }, 500);
            });

            // Setup Audio Capture
            if (audioContextRef.current && streamRef.current) {
              const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
              const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              source.connect(processor);
              processor.connect(audioContextRef.current.destination);

              processor.onaudioprocess = (e) => {
                if (isMicMutedRef.current) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                const sampleRate = audioContextRef.current?.sampleRate || 16000;
                let pcm16: Int16Array;

                if (sampleRate === 16000) {
                  pcm16 = new Int16Array(inputData.length);
                  for (let i = 0; i < inputData.length; i++) {
                    let s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                  }
                } else {
                  // Simple nearest-neighbor downsampling
                  const ratio = sampleRate / 16000;
                  const newLength = Math.floor(inputData.length / ratio);
                  pcm16 = new Int16Array(newLength);
                  for (let i = 0; i < newLength; i++) {
                    const index = Math.floor(i * ratio);
                    let s = Math.max(-1, Math.min(1, inputData[index]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                  }
                }
                
                const base64Data = arrayBufferToBase64(pcm16.buffer);
                sessionPromise.then(session => {
                  session.sendRealtimeInput({
                    media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                  });
                });
              };
            }

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
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              hasReceivedContentRef.current = true;
              
              // Ensure audio context is active (crucial for mobile)
              if (playbackContextRef.current && playbackContextRef.current.state === 'suspended') {
                await playbackContextRef.current.resume();
              }

              for (const part of parts) {
                const base64Audio = part.inlineData?.data;
                if (base64Audio && playbackContextRef.current) {
                  const binaryString = atob(base64Audio);
                  // Ensure even length for Int16Array
                  const validLength = binaryString.length % 2 === 0 ? binaryString.length : binaryString.length - 1;
                  const bytes = new Uint8Array(validLength);
                  for (let i = 0; i < validLength; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const pcm16 = new Int16Array(bytes.buffer);
                  const float32 = new Float32Array(pcm16.length);
                  for (let i = 0; i < pcm16.length; i++) {
                    float32[i] = pcm16[i] / 32768;
                  }

                  if (float32.length > 0) {
                    const audioBuffer = playbackContextRef.current.createBuffer(1, float32.length, 24000);
                    audioBuffer.getChannelData(0).set(float32);
                    const source = playbackContextRef.current.createBufferSource();
                    source.buffer = audioBuffer;
                    
                    if (gainNodeRef.current) {
                      source.connect(gainNodeRef.current);
                    } else {
                      source.connect(playbackContextRef.current.destination);
                    }

                    const startTime = Math.max(playbackContextRef.current.currentTime, nextPlayTimeRef.current);
                    source.start(startTime);
                    nextPlayTimeRef.current = startTime + audioBuffer.duration;
                  }
                }
              }
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              if (playbackContextRef.current) {
                // Instead of closing, we can just stop scheduling new audio
                // and reset the play time. Closing/reopening can be slow.
                nextPlayTimeRef.current = playbackContextRef.current.currentTime;
              }
            }

            // Unmute mic after introduction or as a fallback
            if (message.serverContent?.turnComplete && isFirstTurnRef.current) {
              // If we received content, unmute immediately. 
              // If not, wait a bit longer just in case, then unmute anyway so the user isn't stuck.
              if (hasReceivedContentRef.current) {
                setIsMicMuted(false);
                isFirstTurnRef.current = false;
                setWhiteboardItems([]); // Clear initial message after intro
              } else {
                // Fallback unmute after 3 seconds if turn completes but no audio was heard
                setTimeout(() => {
                  if (isFirstTurnRef.current) {
                    setIsMicMuted(false);
                    isFirstTurnRef.current = false;
                    setWhiteboardItems([]); // Clear initial message even on fallback
                  }
                }, 3000);
              }
            }

            // Handle tool calls
            const toolCalls = message.toolCall?.functionCalls;
            if (toolCalls) {
              setIsThinking(true);
              const responses = toolCalls.map(call => {
                if (call.name === 'writeOnWhiteboard') {
                  const args = call.args as any;
                  setWhiteboardItems(prev => {
                    const newItems = args.clearFirst ? [] : [...prev];
                    if (args.content) {
                      let content = args.content;
                      
                      // 1. Unescape backticks if the AI escaped them
                      content = content.replace(/\\`/g, '`');
                      
                      // 2. Fix missing backticks for lines starting with "mermaid" or diagram types
                      const diagramTypes = ['graph', 'pie', 'sequenceDiagram', 'gantt', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gitGraph', 'mindmap', 'timeline'];
                      const lines = content.split('\n');
                      const fixedLines = lines.map(line => {
                        const trimmed = line.trim();
                        // If it starts with "mermaid " or a diagram type and isn't already in a code block
                        const startsWithMermaid = trimmed.toLowerCase().startsWith('mermaid ');
                        const startsWithDiagramType = diagramTypes.some(type => trimmed.toLowerCase().startsWith(type + ' ') || trimmed.toLowerCase() === type);
                        
                        if ((startsWithMermaid || startsWithDiagramType) && !content.includes('```')) {
                          let diagramCode = trimmed;
                          if (startsWithMermaid) {
                            diagramCode = trimmed.substring(8).trim();
                          }
                          return `\n\`\`\`mermaid\n${diagramCode}\n\`\`\`\n`;
                        }
                        return line;
                      });
                      content = fixedLines.join('\n');

                      // 3. Fix single-line mermaid blocks and missing newlines
                      content = content.replace(/```mermaid\s*(.+?)\s*```/gs, (match, p1) => {
                        let code = p1.trim();
                        
                        // Remove redundant 'mermaid' keyword at the start of the block
                        if (code.toLowerCase().startsWith('mermaid\n') || code.toLowerCase().startsWith('mermaid ')) {
                          code = code.substring(7).trim();
                        }
                        
                        // Fix pie charts
                        if (code.startsWith('pie')) {
                          code = code.replace(/\s+"/g, '\n"');
                          // Fix multi-line titles by joining everything before the first quote
                          const firstQuoteIndex = code.indexOf('"');
                          if (firstQuoteIndex > -1) {
                            const beforeQuotes = code.substring(0, firstQuoteIndex);
                            const afterQuotes = code.substring(firstQuoteIndex);
                            let fixedTitle = beforeQuotes.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                            // Revert: title should be on the same line as pie
                            if (fixedTitle.startsWith('pie\ntitle ')) {
                              fixedTitle = fixedTitle.replace('pie\ntitle ', 'pie title ');
                            }
                            code = fixedTitle + '\n' + afterQuotes;
                          }
                        }
                        
                        // Fix graphs
                        if (code.startsWith('graph TD') || code.startsWith('graph LR')) {
                          // Replace semicolons with newlines
                          code = code.replace(/;/g, '\n');
                          // Ensure graph declaration is on its own line
                          code = code.replace(/^(graph (TD|LR))\s+/, '$1\n');
                        }
                        
                        return `\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
                      });

                      // 4. Ensure mermaid blocks have newlines around them for better parsing
                      const formattedContent = content
                        .replace(/([^\n])\s*```mermaid/g, '$1\n\n```mermaid')
                        .replace(/```\s*([^\n])/g, '```\n\n$1');
                      
                      newItems.push({ text: formattedContent });
                    } else if (args.text || args.mermaidCode) {
                      let content = "";
                      
                      if (args.text) {
                        content += args.text + "\n\n";
                      }
                      
                      if (args.mermaidCode) {
                        let code = args.mermaidCode.trim();
                        
                        // Remove backticks if the AI accidentally included them
                        code = code.replace(/```mermaid/g, '').replace(/```/g, '').trim();
                        
                        // Remove redundant 'mermaid' keyword
                        if (code.toLowerCase().startsWith('mermaid\n') || code.toLowerCase().startsWith('mermaid ')) {
                          code = code.substring(7).trim();
                        }
                        
                        // Fix pie charts
                        if (code.startsWith('pie')) {
                          code = code.replace(/\s+"/g, '\n"');
                          // Fix multi-line titles by joining everything before the first quote
                          const firstQuoteIndex = code.indexOf('"');
                          if (firstQuoteIndex > -1) {
                            const beforeQuotes = code.substring(0, firstQuoteIndex);
                            const afterQuotes = code.substring(firstQuoteIndex);
                            let fixedTitle = beforeQuotes.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                            // Revert: title should be on the same line as pie
                            if (fixedTitle.startsWith('pie\ntitle ')) {
                              fixedTitle = fixedTitle.replace('pie\ntitle ', 'pie title ');
                            }
                            code = fixedTitle + '\n' + afterQuotes;
                          }
                        }
                        
                        // Fix graphs
                        if (code.startsWith('graph TD') || code.startsWith('graph LR')) {
                          // Replace semicolons with newlines
                          code = code.replace(/;/g, '\n');
                          // Ensure graph declaration is on its own line
                          code = code.replace(/^(graph (TD|LR))\s+/, '$1\n');
                        }
                        
                        content += "```mermaid\n" + code + "\n```\n\n";
                      }
                      
                      if (content.trim()) {
                        newItems.push({ text: content.trim() });
                      }
                    }
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
                setTimeout(() => setIsThinking(false), 1000);
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
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none"
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
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-sky-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-teal-400/20 rounded-full blur-3xl" />

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
              className="w-full h-full object-cover translate-x-[1.5px] scale-[1.02]"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                document.getElementById('fallback-icon')!.style.display = 'flex';
              }}
            />
            <div id="fallback-icon" className="hidden flex-col items-center justify-center text-slate-400 w-full h-full bg-slate-800">
              <BookOpen className="w-12 h-12 mb-2 text-sky-400" />
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
            className="w-full bg-amber-400 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 font-bold py-4 px-6 rounded-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
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
      <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex justify-between items-center z-10 pointer-events-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white overflow-hidden shadow-lg border-2 border-white/20">
            <img
              src="/owl-logo.png"
              alt="OwlHelp! Logo"
              className="w-full h-full object-cover translate-x-[0.75px] scale-[1.02]"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                document.getElementById('fallback-header-icon')!.style.display = 'flex';
              }}
            />
            <div id="fallback-header-icon" className="hidden w-full h-full bg-sky-600 items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
          </div>
          <h1 className="text-white font-bold text-xl tracking-tight drop-shadow-md">OwlHelp!</h1>
        </div>
        {isConnected && (
          <div className="flex items-center gap-3">
            {isThinking && (
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 animate-pulse">
                <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
                <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">Thinking</span>
              </div>
            )}
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-400 text-xs font-medium uppercase tracking-wider">Live</span>
            </div>
          </div>
        )}
      </div>

      {/* Whiteboard Area */}
      <div 
        ref={whiteboardScrollRef}
        onScroll={handleScroll}
        onTouchStart={() => { 
          lastUserInteractionRef.current = Date.now();
          isUserScrollingRef.current = true; 
        }}
        onTouchMove={() => {
          lastUserInteractionRef.current = Date.now();
        }}
        onTouchEnd={() => { 
          lastUserInteractionRef.current = Date.now();
          // Keep it true for a bit to allow for momentum
          setTimeout(() => {
            if (Date.now() - lastUserInteractionRef.current >= 1500) {
              isUserScrollingRef.current = false;
            }
          }, 1500);
        }}
        onMouseDown={() => { 
          lastUserInteractionRef.current = Date.now();
          isUserScrollingRef.current = true; 
        }}
        onMouseUp={() => { 
          lastUserInteractionRef.current = Date.now();
          isUserScrollingRef.current = false; 
        }}
        onWheel={() => {
          lastUserInteractionRef.current = Date.now();
          isUserScrollingRef.current = true;
          // Reset after a short delay
          setTimeout(() => {
            if (Date.now() - lastUserInteractionRef.current >= 500) {
              isUserScrollingRef.current = false;
            }
          }, 500);
        }}
        className={`absolute top-16 bottom-32 left-0 right-0 z-10 overflow-y-auto whiteboard-scroll ${whiteboardItems.length > 0 && !isWhiteboardMinimized ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        <div className="flex flex-col items-center justify-start p-2 md:p-8 w-full min-h-full">
          <div className={`w-full max-w-3xl relative ${whiteboardItems.length > 0 && !isWhiteboardMinimized ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            
            {/* Whiteboard Controls */}
          {whiteboardItems.length > 0 && (
            <div className="sticky top-0 z-50 flex justify-end gap-2 w-full mb-3 pointer-events-auto">
              <button
                onClick={() => setIsWhiteboardMinimized(!isWhiteboardMinimized)}
                className="p-2.5 bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md border border-slate-700 text-slate-300 hover:text-white rounded-full shadow-lg transition-all"
                title={isWhiteboardMinimized ? "Show Whiteboard" : "Minimize Whiteboard"}
              >
                {isWhiteboardMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </button>
              <button
                onClick={downloadNotes}
                className="p-2.5 bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md border border-slate-700 text-slate-300 hover:text-white rounded-full shadow-lg transition-all"
                title="Download Notes"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          )}

          {!isWhiteboardMinimized && whiteboardItems.map((item, i) => (
            <div 
              key={i} 
              className="whiteboard-item bg-white/95 backdrop-blur-sm text-slate-900 p-4 md:p-6 rounded-2xl shadow-2xl text-lg md:text-2xl mb-4 border border-slate-200 transform transition-all duration-500 ease-out translate-y-0 opacity-100 w-full break-words relative z-0"
              style={{ animation: 'slideUpFade 0.5s ease-out' }}
            >
              <div className="markdown-body prose prose-slate prose-lg max-w-none overflow-x-auto">
                <Markdown 
                  remarkPlugins={[remarkMath, remarkGfm]} 
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >
                  {item.text}
                </Markdown>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Scroll Hint - Moved outside to prevent jumping */}
      {showScrollHint && !isWhiteboardMinimized && (
        <button 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (whiteboardScrollRef.current) {
              const container = whiteboardScrollRef.current;
              container.scrollTo({ 
                top: container.scrollHeight, 
                behavior: 'smooth' 
              });
              // Re-check scroll state after a delay
              setTimeout(handleScroll, 500);
            }
          }}
          className="fixed bottom-36 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto bg-emerald-500 text-white px-6 py-3 rounded-full text-sm font-bold shadow-[0_8px_30px_rgb(16,185,129,0.5)] backdrop-blur-md flex items-center gap-2 border border-white/20 active:scale-95 transition-all"
        >
          <span>Scroll to Latest</span>
          <Play className="w-3 h-3 rotate-90 fill-current" />
        </button>
      )}

      {/* Error Message */}
      {error && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-lg backdrop-blur-md z-20 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-8 flex justify-center items-center gap-4 md:gap-6 z-20">
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
          <div className="flex flex-col items-center gap-6 w-full max-w-md px-4">
            {/* Volume Control */}
            <div className="flex flex-col gap-1 w-full">
              <div className="flex justify-between px-2">
                <span className="text-white/60 text-[10px] uppercase font-bold tracking-wider">Tutor Volume</span>
                <span className="text-white/60 text-[10px] font-mono">{Math.round(volume * 100)}%</span>
              </div>
              <div className="flex items-center gap-3 w-full bg-slate-900/60 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 shadow-lg">
                {volume === 0 ? <VolumeX className="w-5 h-5 text-slate-400" /> : <Volume2 className="w-5 h-5 text-white" />}
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={volume} 
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                />
              </div>
            </div>

            <div className="flex justify-center items-center gap-4 md:gap-6">
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
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .mermaid-container svg {
          max-width: 100% !important;
          height: auto !important;
        }
        .markdown-body {
          font-size: inherit;
        }
        .markdown-body p {
          margin-bottom: 1rem;
        }
        .markdown-body p:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </div>
  );
}
