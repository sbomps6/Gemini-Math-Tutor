import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Play, Square, Loader2, GraduationCap, BookOpen, Settings, X, Eraser, Minimize2, Maximize2, Download, Volume2, VolumeX, LayoutDashboard, ArrowLeft, BarChart, Pencil, Trash2, Link, Copy, QrCode, Plus, Sparkles, Shield, FileText, Info, AlertCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, db } from './firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { trackPageView, trackEvent } from './services/analytics';
import { jsPDF } from 'jspdf';

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

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("API Key is missing! Check your build-args.");
}

// Fix double-slash in WebSocket URLs (common issue with some proxies and the Gemini SDK)
if (typeof window !== 'undefined') {
  try {
    const OriginalWS = window.WebSocket;
    if (OriginalWS) {
      const WSProxy = function(this: any, url: string | URL, protocols?: string | string[]) {
        let finalUrl = url;
        if (typeof url === 'string' && url.includes('//ws/')) {
          console.log("[OwlHelp!] Cleaning double-slash in WebSocket URL:", url);
          finalUrl = url.replace('//ws/', '/ws/');
        }
        return new OriginalWS(finalUrl, protocols);
      };
      WSProxy.prototype = OriginalWS.prototype;
      (WSProxy as any).CONNECTING = OriginalWS.CONNECTING;
      (WSProxy as any).OPEN = OriginalWS.OPEN;
      (WSProxy as any).CLOSING = OriginalWS.CLOSING;
      (WSProxy as any).CLOSED = OriginalWS.CLOSED;
      
      try {
        // Try direct assignment first
        (window as any).WebSocket = WSProxy;
      } catch (e) {
        // Fallback to defineProperty if assignment fails
        Object.defineProperty(window, 'WebSocket', {
          value: WSProxy,
          configurable: true,
          writable: true
        });
      }
    }
  } catch (e) {
    console.warn("[OwlHelp!] Could not intercept WebSocket:", e);
  }
}

const ai = new GoogleGenAI({ apiKey });

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface ChildProfile {
  id: string;
  name: string;
  grade?: string;
  learningStyle?: string;
  interests?: string;
  pairingCode?: string;
  linkedUserId?: string; // The auth UID of the student if they log in themselves
}

interface UserProfile {
  role: 'student' | 'parent';
  studentName?: string; // For single student accounts
  parentName?: string;
  children?: ChildProfile[]; // For parent accounts
}

const LegalModals = ({ showPrivacy, setShowPrivacy, showTerms, setShowTerms }: { showPrivacy: boolean, setShowPrivacy: (v: boolean) => void, showTerms: boolean, setShowTerms: (v: boolean) => void }) => {
  return (
    <>
      {/* Privacy Policy Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 md:p-6" style={{ zIndex: 9999 }}>
          <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <h2 className="text-2xl font-bold flex items-center gap-2"><Shield className="w-6 h-6 text-sky-400" /> Privacy Policy</h2>
              <button type="button" onClick={() => setShowPrivacy(false)} className="text-slate-400 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-300 leading-relaxed">
              <p><strong>Last Updated:</strong> March 1, 2026</p>
              <p>Welcome to OwlHelp! We are committed to protecting your privacy and ensuring a safe educational environment for students.</p>
              <h3 className="text-lg font-semibold text-white mt-4">1. Information We Collect</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Camera and Microphone Data:</strong> During an active tutoring session, we access your device's camera and microphone to allow the AI to see the math problem and hear the student. <strong>This data is processed in real-time and is NOT recorded or stored by OwlHelp!.</strong></li>
                <li><strong>Account Information:</strong> We collect parent email addresses to create accounts and manage access.</li>
                <li><strong>Student Profiles:</strong> Parents may provide a student's first name, grade level, and interests to personalize the tutoring experience.</li>
              </ul>
              <h3 className="text-lg font-semibold text-white mt-4">2. How We Use Google Gemini</h3>
              <p>OwlHelp! is powered by the Google Gemini API. When a session is active, the real-time audio and video streams are sent securely to Google's servers for processing. According to Google's API terms of service, <strong>Google does not use your data (or your child's data) to train their AI models.</strong> The data is processed ephemerally to generate the tutor's responses.</p>
              <h3 className="text-lg font-semibold text-white mt-4">3. Children's Privacy (COPPA)</h3>
              <p>We comply with the Children's Online Privacy Protection Act (COPPA). OwlHelp! requires a parent or guardian to create an account and set up student profiles. We do not knowingly collect personal information directly from children under 13 without verifiable parental consent.</p>
              <h3 className="text-lg font-semibold text-white mt-4">4. Data Security</h3>
              <p>We implement industry-standard security measures to protect your account information. All communication between your device and our servers (and Google's servers) is encrypted.</p>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTerms && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 md:p-6" style={{ zIndex: 9999 }}>
          <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <h2 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6 text-sky-400" /> Terms of Service</h2>
              <button type="button" onClick={() => setShowTerms(false)} className="text-slate-400 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-sm text-slate-300 leading-relaxed">
              <p><strong>Last Updated:</strong> March 1, 2026</p>
              <h3 className="text-lg font-semibold text-white mt-4">1. Educational Purpose</h3>
              <p>OwlHelp! is designed as an educational tool to assist students with math concepts. It is not a substitute for formal education or professional instruction.</p>
              <h3 className="text-lg font-semibold text-white mt-4">2. AI Limitations</h3>
              <p>OwlHelp! utilizes artificial intelligence (Google Gemini) to provide tutoring. While we strive for accuracy, AI can occasionally make mistakes or provide incomplete information. Students and parents should always review the work and use their own judgment.</p>
              <h3 className="text-lg font-semibold text-white mt-4">3. User Conduct</h3>
              <p>Users agree to use OwlHelp! for its intended educational purposes. Any misuse of the platform, including attempting to bypass safety filters or using the service for inappropriate content, will result in account termination.</p>
              <h3 className="text-lg font-semibold text-white mt-4">4. Parental Responsibility</h3>
              <p>Parents or guardians are responsible for monitoring their child's use of OwlHelp! and managing their account settings through the Parent Portal.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showParentPortal, setShowParentPortal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showAddChildModal, setShowAddChildModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showStudentLogin, setShowStudentLogin] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [studentPairingCode, setStudentPairingCode] = useState('');
  const [editingChild, setEditingChild] = useState<ChildProfile | null>(null);
  const [linkingChild, setLinkingChild] = useState<ChildProfile | null>(null);
  const [statsChild, setStatsChild] = useState<ChildProfile | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
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

  const [email, setEmail] = useState('');
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const isProcessingLinkRef = useRef(false);

  useEffect(() => {
    // Check for pairing code in URL
    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get('pair');
    if (pairCode) {
      setStudentPairingCode(pairCode);
      setShowStudentLogin(true);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Session timeout check (1 hour)
      const lastLogin = window.localStorage.getItem('lastLoginTime');
      if (lastLogin && currentUser) {
        const oneHour = 3600000;
        if (Date.now() - parseInt(lastLogin) > oneHour) {
          console.log("[OwlHelp!] Session expired (1 hour), signing out...");
          await signOut(auth);
          window.localStorage.removeItem('lastLoginTime');
          window.localStorage.removeItem('studentSession');
          setUser(null);
          setUserProfile(null);
          setIsLoadingProfile(false);
          return;
        }
      }

      setUser(currentUser);
      if (currentUser) {
        // Update last login time to extend session if active
        window.localStorage.setItem('lastLoginTime', Date.now().toString());
        
        // Fetch user profile
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const profile = docSnap.data() as UserProfile;
            setUserProfile(profile);
            if (profile.role === 'parent') {
              if (profile.children && profile.children.length > 0) {
                setActiveChildId(profile.children[0].id);
              }
              // Auto-redirect parents to portal if they are returning
              setShowParentPortal(true);
              setShowSplash(false);
            }
            setShowOnboarding(false);
          } else {
            setShowOnboarding(true);
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
          setShowOnboarding(true);
        }
      } else {
        // Check for student session in localStorage if no auth user
        const savedStudentSession = window.localStorage.getItem('studentSession');
        if (savedStudentSession) {
          try {
            const { parentId, childId, studentName } = JSON.parse(savedStudentSession);
            // Verify parent still exists and child is still there
            const parentRef = doc(db, 'users', parentId);
            const parentSnap = await getDoc(parentRef);
            if (parentSnap.exists()) {
              const parentProfile = parentSnap.data() as UserProfile;
              const child = parentProfile.children?.find(c => c.id === childId);
              if (child) {
                setUserProfile({
                  role: 'student',
                  studentName: child.name
                });
                setActiveChildId(childId);
                setShowSplash(false);
              } else {
                window.localStorage.removeItem('studentSession');
                setUserProfile(null);
              }
            } else {
              window.localStorage.removeItem('studentSession');
              setUserProfile(null);
            }
          } catch (e) {
            console.error("Error parsing student session:", e);
            window.localStorage.removeItem('studentSession');
            setUserProfile(null);
          }
        } else {
          setUserProfile(null);
          setShowOnboarding(false);
        }
      }
      setIsLoadingProfile(false);
    });
    
    // Check if returning from a magic link
    if (isSignInWithEmailLink(auth, window.location.href) && !isProcessingLinkRef.current) {
      isProcessingLinkRef.current = true;
      let savedEmail = window.localStorage.getItem('emailForSignIn');
      
      // If we don't have the email saved, we need to ask for it.
      if (!savedEmail) {
        // Use a small timeout to let the UI render first
        setTimeout(() => {
          const promptEmail = window.prompt('Please provide your email for confirmation');
          if (promptEmail) {
            processMagicLink(promptEmail);
          } else {
            isProcessingLinkRef.current = false; // Reset if they cancel
          }
        }, 100);
      } else {
        processMagicLink(savedEmail);
      }
    }

    function processMagicLink(emailToUse: string) {
      signInWithEmailLink(auth, emailToUse, window.location.href)
        .then((result) => {
          window.localStorage.removeItem('emailForSignIn');
          // Clean up the URL
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((error) => {
          console.error("Error signing in with magic link", error);
          setAuthError("Failed to sign in with link. It may have expired.");
          isProcessingLinkRef.current = false;
        });
    }
    
    return () => unsubscribe();
  }, []);

  // Ensure video stream is attached when transitioning to the main screen
  useEffect(() => {
    if (!showSplash && !showOnboarding && !showParentPortal && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
    }
  }, [showSplash, showOnboarding, showParentPortal]);

  const activeStudentName = userProfile?.role === 'parent' 
    ? userProfile.children?.find(c => c.id === activeChildId)?.name 
    : userProfile?.studentName;
    
  const activeChild = userProfile?.role === 'parent' 
    ? userProfile.children?.find(c => c.id === activeChildId)
    : null;

  const generatePairingCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing characters like I, 1, O, 0
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    setIsSendingLink(true);
    setAuthError(null);
    
    const continueUrl = window.location.origin + window.location.pathname;
    
    const actionCodeSettings = {
      url: continueUrl,
      handleCodeInApp: true,
    };
    
    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);
      setLinkSent(true);
    } catch (error: any) {
      console.error("Error sending magic link:", error);
      setAuthError(error.message || "Failed to send magic link.");
    } finally {
      setIsSendingLink(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentPairingCode) return;
    
    setIsLoadingProfile(true);
    setAuthError(null);
    
    // Aggressive normalization: remove everything except A-Z and 0-9
    const cleanCode = studentPairingCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const originalCode = studentPairingCode.trim().toUpperCase();
    
    try {
      // Try variations to be safe
      const variations = Array.from(new Set([
        cleanCode,
        originalCode,
        cleanCode.length === 6 ? `${cleanCode.slice(0, 3)}-${cleanCode.slice(3)}` : null
      ])).filter(Boolean) as string[];

      console.log("Attempting student login with variations:", variations);

      let codeSnap = null;
      for (const code of variations) {
        const ref = doc(db, 'pairingCodes', code);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          codeSnap = snap;
          break;
        }
      }
      
      if (!codeSnap || !codeSnap.exists()) {
        setAuthError(`Invalid pairing code "${originalCode}". Please double check the code from your parent's device.`);
        setIsLoadingProfile(false);
        return;
      }
      
      const data = codeSnap.data();
      const { parentId, childId } = data;
      
      if (!parentId || !childId) {
        setAuthError("This pairing code is incomplete. Please ask your parent to generate a new one.");
        setIsLoadingProfile(false);
        return;
      }
      
      // 2. Fetch the parent's profile to get the child's data
      const parentRef = doc(db, 'users', parentId);
      const parentSnap = await getDoc(parentRef);
      
      if (!parentSnap.exists()) {
        setAuthError("Parent account not found. The account might have been deleted.");
        setIsLoadingProfile(false);
        return;
      }
      
      const parentProfile = parentSnap.data() as UserProfile;
      const child = parentProfile.children?.find(c => c.id === childId);
      
      if (!child) {
        setAuthError("Child profile not found. It may have been removed by your parent.");
        setIsLoadingProfile(false);
        return;
      }
      
      // 3. Create a student profile for this session
      const studentProfile: UserProfile = {
        role: 'student',
        studentName: child.name,
      };
      
      // 4. Save to localStorage for persistence
      window.localStorage.setItem('studentSession', JSON.stringify({
        parentId,
        childId,
        studentName: child.name
      }));
      
      setUserProfile(studentProfile);
      setActiveChildId(childId);
      setShowStudentLogin(false);
      setShowSplash(false);
      
      trackEvent("Auth", "StudentLogin", "Student logged in with pairing code");
    } catch (error: any) {
      console.error("Error during student login:", error);
      setAuthError(`Connection error: ${error.message || "Please try again."}`);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      window.localStorage.setItem('lastLoginTime', Date.now().toString());
    } catch (error) {
      console.error("Error signing in:", error);
      setError("Failed to sign in. Please try again.");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      window.localStorage.removeItem('studentSession');
      window.localStorage.removeItem('lastLoginTime');
      setUserProfile(null);
      setActiveChildId(null);
      setShowParentPortal(false);
      setShowSplash(true);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };
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
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isFirstTurnRef = useRef(true);
  const hasSentInitialGreetingRef = useRef(false);
  const hasReceivedContentRef = useRef(false);
  const isMicMutedRef = useRef(isMicMuted);

  // Track page view on mount
  useEffect(() => {
    trackPageView(window.location.pathname + window.location.search);
  }, []);

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
        console.log("Creating new AudioContext for playback (24kHz)");
        playbackContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      } catch (e) {
        console.log("Fallback: Creating default AudioContext");
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

  const requestPermissions = async (childId?: string) => {
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

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'environment' } });
      } catch (videoErr) {
        console.warn("Initial video permission failed, trying audio only:", videoErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setIsVideoMuted(true);
        } catch (audioErr) {
          console.error("Initial audio permission failed too:", audioErr);
          throw audioErr;
        }
      }
      
      // Re-resume after getUserMedia to reclaim gesture context if lost during permission prompt
      if (playbackContextRef.current.state === 'suspended') {
        await playbackContextRef.current.resume();
      }

      streamRef.current = stream;
      setShowSplash(false);
      setShowParentPortal(false);
      // Automatically start the session after permissions are granted
      startSession(childId);
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
    console.log("Stopping session...");
    trackEvent("Session", "Stop", "Live Tutor Session Stopped");
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) {
        console.error("Error closing session:", e);
      }
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
    isFirstTurnRef.current = true;
    hasSentInitialGreetingRef.current = false;
    hasReceivedContentRef.current = false;

    // Redirect based on role
    if (userProfile?.role === 'parent') {
      setShowParentPortal(true);
    } else {
      setShowSplash(true);
    }
  }, [userProfile]);

  const downloadPDF = useCallback(() => {
    if (whiteboardItems.length === 0) return;
    
    const doc = new jsPDF();
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Branding
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text("OwlHelp!", margin, y);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(`Study Guide - ${new Date().toLocaleDateString()}`, margin, y + 7);
    
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.line(margin, y + 12, pageWidth - margin, y + 12);
    
    y += 25;

    whiteboardItems.forEach((item) => {
      let text = item.text;
      
      // 1. Clean up LaTeX and Markdown symbols
      text = text
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
        .replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)')
        .replace(/\\times/g, 'x')
        .replace(/\\div/g, '/')
        .replace(/\\pm/g, '+/-')
        .replace(/\\approx/g, '~')
        .replace(/\\neq/g, '!=')
        .replace(/\\le/g, '<=')
        .replace(/\\ge/g, '>=')
        .replace(/\\infty/g, 'infinity')
        .replace(/\\pi/g, 'pi')
        .replace(/\\theta/g, 'theta')
        .replace(/\\alpha/g, 'alpha')
        .replace(/\\beta/g, 'beta')
        .replace(/\\gamma/g, 'gamma')
        .replace(/\\delta/g, 'delta')
        .replace(/\\sigma/g, 'sigma')
        .replace(/\\mu/g, 'mu')
        .replace(/\\lambda/g, 'lambda')
        .replace(/\\omega/g, 'omega')
        .replace(/\\phi/g, 'phi')
        .replace(/\\psi/g, 'psi')
        .replace(/\\rho/g, 'rho')
        .replace(/\\tau/g, 'tau')
        .replace(/\\epsilon/g, 'epsilon')
        .replace(/\\zeta/g, 'zeta')
        .replace(/\\eta/g, 'eta')
        .replace(/\\xi/g, 'xi')
        .replace(/\\chi/g, 'chi')
        .replace(/\\nu/g, 'nu')
        .replace(/\\kappa/g, 'kappa')
        .replace(/\\iota/g, 'iota')
        .replace(/\\upsilon/g, 'upsilon')
        .replace(/\\partial/g, 'd')
        .replace(/\\nabla/g, 'grad')
        .replace(/\\int/g, 'integral')
        .replace(/\\sum/g, 'sum')
        .replace(/\\prod/g, 'product')
        .replace(/\\cup/g, 'union')
        .replace(/\\cap/g, 'intersection')
        .replace(/\\subset/g, 'subset')
        .replace(/\\supset/g, 'superset')
        .replace(/\\in/g, 'in')
        .replace(/\\notin/g, 'not in')
        .replace(/\\forall/g, 'for all')
        .replace(/\\exists/g, 'exists')
        .replace(/\\neg/g, 'not')
        .replace(/\\land/g, 'and')
        .replace(/\\lor/g, 'or')
        .replace(/\\Rightarrow/g, '=>')
        .replace(/\\Leftrightarrow/g, '<=>')
        .replace(/\\rightarrow/g, '->')
        .replace(/\\leftarrow/g, '<-')
        .replace(/\\uparrow/g, 'up')
        .replace(/\\downarrow/g, 'down')
        .replace(/\\dots/g, '...')
        .replace(/\\cdots/g, '...')
        .replace(/\\vdots/g, '...')
        .replace(/\\ddots/g, '...')
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\mathbf\{([^}]*)\}/g, '$1')
        .replace(/\\mathit\{([^}]*)\}/g, '$1')
        .replace(/\\mathrm\{([^}]*)\}/g, '$1')
        .replace(/\\mathcal\{([^}]*)\}/g, '$1')
        .replace(/\\mathfrak\{([^}]*)\}/g, '$1')
        .replace(/\\mathbb\{([^}]*)\}/g, '$1')
        .replace(/\\mathtt\{([^}]*)\}/g, '$1')
        .replace(/\\underline\{([^}]*)\}/g, '$1')
        .replace(/\\overline\{([^}]*)\}/g, '$1')
        .replace(/\\hat\{([^}]*)\}/g, '$1')
        .replace(/\\tilde\{([^}]*)\}/g, '$1')
        .replace(/\\bar\{([^}]*)\}/g, '$1')
        .replace(/\\vec\{([^}]*)\}/g, '$1')
        .replace(/\\dot\{([^}]*)\}/g, '$1')
        .replace(/\\ddot\{([^}]*)\}/g, '$1')
        .replace(/\\acute\{([^}]*)\}/g, '$1')
        .replace(/\\grave\{([^}]*)\}/g, '$1')
        .replace(/\\check\{([^}]*)\}/g, '$1')
        .replace(/\\breve\{([^}]*)\}/g, '$1')
        .replace(/\\mathring\{([^}]*)\}/g, '$1')
        .replace(/\\overrightarrow\{([^}]*)\}/g, '$1')
        .replace(/\\overleftarrow\{([^}]*)\}/g, '$1')
        .replace(/\\overbrace\{([^}]*)\}/g, '$1')
        .replace(/\\underbrace\{([^}]*)\}/g, '$1')
        .replace(/\{/g, '') // Remove remaining braces
        .replace(/\}/g, '')
        .replace(/\$/g, '') // Remove LaTeX delimiters
        .replace(/\*\*/g, '') // Remove bold
        .replace(/###/g, '') // Remove headers
        .replace(/##/g, '')
        .replace(/#/g, '')
        .replace(/\\/g, ''); // Remove backslashes from LaTeX

      // 2. Filter out answers
      const lines = text.split('\n');
      const filteredLines = lines.filter(line => {
        const lower = line.toLowerCase().trim();
        // Skip lines that look like final answers
        if (lower.startsWith('answer:') || 
            lower.startsWith('the answer is') || 
            lower.startsWith('final answer:') ||
            lower.startsWith('result:') ||
            (lower.includes('is') && lower.includes('answer'))) {
          return false;
        }
        return true;
      });
      
      if (filteredLines.length === 0) return;
      
      const cleanedText = filteredLines.join('\n').trim();
      if (!cleanedText) return;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(51, 65, 85); // slate-700
      
      const splitText = doc.splitTextToSize(cleanedText, pageWidth - (margin * 2));
      
      // Check for page break
      if (y + (splitText.length * 6) > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      
      doc.text(splitText, margin, y);
      y += (splitText.length * 6) + 10;
    });

    doc.save(`owlhelp-study-guide-${new Date().toISOString().split('T')[0]}.pdf`);
    trackEvent("Whiteboard", "Download", "PDF Study Guide Downloaded");
  }, [whiteboardItems]);

  const startSession = async (childId?: string) => {
    if (isConnecting || isConnected) {
      console.log("Session already in progress, skipping startSession");
      return;
    }
    const currentChildId = childId || activeChildId;
    const currentStudentName = userProfile?.role === 'parent' 
      ? userProfile.children?.find(c => c.id === currentChildId)?.name 
      : userProfile?.studentName;
    console.log("Starting session for student:", currentStudentName);
    const currentChild = userProfile?.role === 'parent' 
      ? userProfile.children?.find(c => c.id === currentChildId)
      : null;

    try {
      setError(null);
      setIsConnecting(true);
      setIsMicMuted(true);
      isFirstTurnRef.current = true;
      hasSentInitialGreetingRef.current = false;
      hasReceivedContentRef.current = false;
      sessionRef.current = null;
      
      trackEvent("Session", "Start", "Live Tutor Session Started");
      
      setWhiteboardItems([{ text: "Show Your Work: Point your camera at your math problem. OwlHelp! can see what you're working on. Talk to your tutor or ask questions naturally. OwlHelp! will guide you step-by-step without just giving the answer." }]);

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
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 16000
            }, 
            video: { facingMode: 'environment' } 
          });
        } catch (videoErr) {
          console.warn("Video failed, trying audio only:", videoErr);
          try {
            stream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
              }
            });
            setIsVideoMuted(true); // Mute video if it failed to start
          } catch (audioErr) {
            console.error("Audio failed too:", audioErr);
            throw new Error("We need microphone access to hear your questions. Please allow access in your browser settings.");
          }
        }
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
${currentStudentName ? `\nThe student you are tutoring is named ${currentStudentName}. Always greet them by their name when the session starts, and occasionally use their name to encourage them.` : ''}
${currentChild?.grade ? `\nThe student is in grade: ${currentChild.grade}. Adjust your vocabulary and explanation complexity to be appropriate for this grade level.` : ''}
${currentChild?.learningStyle ? `\nThe student's learning style is: ${currentChild.learningStyle}. Try to adapt your teaching methods to fit this style.` : ''}
${currentChild?.interests ? `\nThe student is interested in: ${currentChild.interests}. You MUST ALWAYS use these specific interests and hobbies when building data, giving examples, or creating visuals. Do not use generic examples if an interest-based one can be used.` : ''}

Capabilities: 
- Vision: You can see the user's handwritten or printed math problems via their camera. Pay close attention to exactly what they are pointing at or writing.
- Whiteboard: You have a digital whiteboard. You can use the "writeOnWhiteboard" tool to draw diagrams, write equations, or explain concepts visually if the student needs extra help.

Initial Greeting: The session has just started. You will receive a hidden message "START_SESSION". You MUST immediately respond with a warm audio introduction. You MUST say: "Welcome to OwlHelp!, ${currentStudentName || 'Student'}! I am your virtual tutor. How can I help you today? If you have a problem to work on, just point the camera there, and let's get started. You can also ask to use a whiteboard if you need some extra help." It is CRITICAL that you are the first to speak. Do not wait for the student. If you see "START_SESSION", it is your absolute priority to respond with this greeting. If you do not respond, the student will keep asking until you do.

Strict Rules of Engagement:
1. NEVER Give the Final Answer or Next Step: You must never provide the solution or the next logical step to a problem. You are a guide, not a solver. You must wait for the student to explicitly state, write, or attempt the next step. If the student is stuck, ask a very small, leading question about the current step. DO NOT write the next step on the whiteboard before the student has done it themselves.
2. Explicit Verification: Verification means the student has clearly and unambiguously provided the final answer. If there is any doubt, ask: "What do you think the final answer is?" or "Can you write the final result for me?" Only after this explicit confirmation can you say, "That's correct!" or "You got it!".
3. No Spoilers: Do not hint at the final answer or jump ahead. Focus entirely on the current micro-step the student is working on. Never show the "next step" on the whiteboard as a visual aid; only show what has already been discussed and confirmed.
4. Wait for the Student: After asking a question or seeing the student start to work, PAUSE. Give them ample time to think and write. Do not fill the silence with more talking unless they ask for help.
5. Handle Ambiguity: If you are unsure what the student is writing or saying, DO NOT GUESS. Do not assume they have the right answer if the camera is blurry or the audio is unclear. Instead, ask the student to clarify, point more clearly, or repeat themselves.
5. Never Let the User Give Up: If a student is frustrated or wants to quit, provide extra encouragement and break the problem down into even smaller, more manageable micro-steps.
6. Prioritize Teaching: Your primary mission is to teach the concept. Use numbers, letters, and pictures (via the whiteboard) to assist them in visualizing the logic.
7. Follow Along with Steps: Recognize when the student is writing intermediate steps. Anticipate them writing steps and follow along as they write.
8. Keep the Whiteboard Updated (Mirroring Only): Use the whiteboard to mirror the student's work. Continuously update the whiteboard with the steps they've ALREADY written or confirmed so it shows the progression of the problem. NEVER use the whiteboard to show a step the student hasn't reached yet.
9. Be the Guide: Use the Socratic method. Ask guiding questions to lead the student to the next step.
10. Acknowledge the Visuals: Explicitly state what you see so the student knows you are looking at their work. (e.g., "I see you are pointing at the denominator in that fraction.")
11. Catch Mistakes Live: If the student writes down a wrong number or makes a sign error, politely interrupt and point it out immediately.
12. Keep Responses Conversational: Keep your audio responses short, conversational, and natural.
13. Scaffold Learning: Break down complex problems into small, simple steps.
14. Use Analogies: Explain difficult concepts using relatable examples. ALWAYS use the student's defined interests for these analogies.
15. Positive Reinforcement: Use encouraging phrases like 'Great start!' or 'You're almost there!'.
16. Refocus: If the student gets off-topic, gently steer them back to their schoolwork.
17. Safety: Never ask for or store personal information about the child.
18. Math Formatting: When writing on the whiteboard, ALWAYS use LaTeX formatting for math equations. Use single dollar signs for inline math (e.g., $x=5$) and double dollar signs for block math (e.g., $$ \frac{1}{2} $$). ALWAYS ensure every opening delimiter has a matching closing delimiter. Align the math properly to show work happening on both sides of the equation.
19. Plain English Explanations: When using the whiteboard, always include a brief explanation in plain English alongside the math equations so the student understands the logic being shown.
20. Clear the Whiteboard: When moving to a new problem or if the whiteboard gets too cluttered, ALWAYS use the clearFirst: true parameter in the writeOnWhiteboard tool to start fresh.
21. Minimize Interruptions: Do not interrupt yourself just because the camera moved. Only interrupt if the student explicitly asks a new question or if they make a significant mistake that needs immediate correction. Finish your current thought before addressing minor visual changes.
22. Diagram Support: You can draw diagrams, flowcharts, number lines, and coordinate planes on the whiteboard using Mermaid.js. To do this, use the 'mermaidCode' parameter in the writeOnWhiteboard tool.
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
      Example:
      pie title Pets
      "Dogs" : 386
      "Cats" : 85
    - For Cartesian Planes and Function Graphs: You MUST use 'xychart-beta' syntax. This is the best way to show a coordinate plane.
      - CRITICAL: 'xychart-beta' ONLY supports 'line' and 'bar'. It does NOT support 'scatter'.
      - CRITICAL: The data array for 'line' or 'bar' MUST have the exact same number of elements as the 'x-axis' array.
      - CRITICAL: Do NOT use coordinate pairs like [[x, y]]. Use a single array of values that map to the x-axis categories.
      Example (Graphing y = 2x + 1):
      xychart-beta
      title "Graph of y = 2x + 1"
      x-axis [-2, -1, 0, 1, 2]
      y-axis "y-value" -5 --> 5
      line [-3, -1, 1, 3, 5]
      
      Example (Showing a specific point at x=0, y=4):
      xychart-beta
      title "Point (0, 4)"
      x-axis [-2, -1, 0, 1, 2]
      y-axis "y" 0 --> 5
      bar [0, 0, 4, 0, 0]
    - For Flowcharts: Use 'graph TD' or 'graph LR'.
    - ALWAYS ensure the Mermaid code is valid and follows the specific syntax for each type.
23. Double Check Your Work: Always double-check your own math and logic internally before speaking or writing it on the whiteboard to ensure it is 100% correct prior to showing the student.

You MUST use the writeOnWhiteboard tool whenever you want to show a diagram, chart, or any explanation that would benefit from being visual. If the student asks to use the whiteboard or asks for a visual explanation, you MUST use this tool immediately. Do not just speak it.
24. Interest-Based Visuals: When using the whiteboard to show examples, ALWAYS incorporate the student's interests. For example, if they like Minecraft, use blocks or creepers in your word problems and diagrams. If they like soccer, use goals or players.`,
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
            console.log("Live API Connection Opened");
            setIsConnected(true);
            setIsConnecting(false);

            // Ensure audio context is resumed (browser safety)
            if (playbackContextRef.current?.state === 'suspended') {
              console.log("Resuming playbackContext on open");
              playbackContextRef.current.resume().catch(e => console.error("Error resuming on open:", e));
            }

            // Play a local chime to indicate readiness and wake up the audio context
            if (playbackContextRef.current) {
              console.log("Playing readiness chime");
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

            // Multi-stage greeting sequence for maximum reliability
            const sendGreeting = (attempt: number) => {
              if (hasReceivedContentRef.current || !isConnected) {
                if (hasReceivedContentRef.current) console.log("Greeting cancelled: content already received");
                return;
              }
              
              console.log(`Sending initial greeting (Attempt ${attempt})...`);
              sessionPromise.then(session => {
                session.sendClientContent({
                  turns: [{ role: 'user', parts: [{ text: 'START_SESSION' }] }],
                  turnComplete: true
                });
              }).catch(e => console.error(`Error in greeting attempt ${attempt}:`, e));
            };

            // Stage 1: Immediate-ish (after chime)
            setTimeout(() => sendGreeting(1), 1000);
            
            // Stage 2: 4 seconds
            setTimeout(() => sendGreeting(2), 4000);
            
            // Stage 3: 8 seconds
            setTimeout(() => sendGreeting(3), 8000);

            // Fallback unmute: If AI doesn't respond at all within 15 seconds, unmute so user isn't stuck
            setTimeout(() => {
              if (isFirstTurnRef.current && isMicMutedRef.current) {
                console.log("Fallback unmute triggered - AI did not respond to initial greeting.");
                setIsMicMuted(false);
                isFirstTurnRef.current = false;
              }
            }, 15000);

            // Setup Audio Capture with Noise Suppression
            if (audioContextRef.current && streamRef.current) {
              const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
              
              // 1. High-pass filter to remove low-frequency hum/rumble
              const highPassFilter = audioContextRef.current.createBiquadFilter();
              highPassFilter.type = 'highpass';
              highPassFilter.frequency.value = 150; // Filter out everything below 150Hz
              
              // 2. Compressor to even out volume levels
              const compressor = audioContextRef.current.createDynamicsCompressor();
              compressor.threshold.setValueAtTime(-50, audioContextRef.current.currentTime);
              compressor.knee.setValueAtTime(40, audioContextRef.current.currentTime);
              compressor.ratio.setValueAtTime(12, audioContextRef.current.currentTime);
              compressor.attack.setValueAtTime(0, audioContextRef.current.currentTime);
              compressor.release.setValueAtTime(0.25, audioContextRef.current.currentTime);

              const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              
              // Connect the chain: source -> filter -> compressor -> processor
              source.connect(highPassFilter);
              highPassFilter.connect(compressor);
              compressor.connect(processor);
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
                    audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
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
            console.log("Live API Message Received:", message);

            // Handle setupComplete
            if (message.setupComplete) {
              console.log("Live API Setup Complete");
              
              setWhiteboardItems(prev => [...prev, { text: "OwlHelp! is ready. Connecting to your tutor..." }]);
              
              // Ensure audio contexts are active
              if (playbackContextRef.current && playbackContextRef.current.state === 'suspended') {
                console.log("Resuming playbackContext on setupComplete");
                playbackContextRef.current.resume().catch(e => console.error("Error resuming playback context:", e));
              }
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                console.log("Resuming audioContext on setupComplete");
                audioContextRef.current.resume().catch(e => console.error("Error resuming audio context:", e));
              }

              // Send a nudge greeting on setupComplete
              console.log("Sending nudge greeting on setupComplete...");
              sessionPromise.then(session => {
                if (!hasReceivedContentRef.current) {
                  session.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: 'START_SESSION' }] }],
                    turnComplete: true
                  });
                }
              }).catch(e => console.error("Error sending nudge greeting:", e));
            }

            // Handle audio output
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              console.log("Received modelTurn parts:", parts.length);
              hasReceivedContentRef.current = true;
              
              // Clear the "Connecting..." message on first content
              if (isFirstTurnRef.current) {
                setWhiteboardItems(prev => prev.filter(item => !item.text.includes("Connecting to your tutor")));
              }
              
              // Ensure audio context is active (crucial for mobile)
              if (playbackContextRef.current && playbackContextRef.current.state === 'suspended') {
                await playbackContextRef.current.resume();
              }

              parts.forEach((part, i) => {
                const base64Audio = part.inlineData?.data;
                if (base64Audio && playbackContextRef.current) {
                  const binaryString = atob(base64Audio);
                  // Ensure even length for Int16Array
                  const validLength = binaryString.length % 2 === 0 ? binaryString.length : binaryString.length - 1;
                  const bytes = new Uint8Array(validLength);
                  for (let j = 0; j < validLength; j++) {
                    bytes[j] = binaryString.charCodeAt(j);
                  }
                  const pcm16 = new Int16Array(bytes.buffer);
                  const float32 = new Float32Array(pcm16.length);
                  for (let j = 0; j < pcm16.length; j++) {
                    float32[j] = pcm16[j] / 32768;
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
                    if (i === 0) {
                      console.log("Scheduling audio chunk at", startTime, "Context state:", playbackContextRef.current.state);
                    }
                    source.onended = () => {
                      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
                    };
                    activeSourcesRef.current.push(source);
                    source.start(startTime);
                    nextPlayTimeRef.current = startTime + audioBuffer.duration;
                  }
                }
              });
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              // Stop all currently playing sources
              activeSourcesRef.current.forEach(source => {
                try {
                  source.stop();
                } catch (e) {
                  // Source might have already ended
                }
              });
              activeSourcesRef.current = [];
              
              if (playbackContextRef.current) {
                nextPlayTimeRef.current = playbackContextRef.current.currentTime;
              }
            }

            // Unmute mic after introduction or as a fallback
            if (message.serverContent?.turnComplete && isFirstTurnRef.current) {
              console.log("Turn complete, unmuting mic if content received. hasReceivedContent:", hasReceivedContentRef.current);
              // If we received content, unmute immediately. 
              // If not, wait a bit longer just in case, then unmute anyway so the user isn't stuck.
              if (hasReceivedContentRef.current) {
                setIsMicMuted(false);
                isFirstTurnRef.current = false;
                // We keep the instructions on the whiteboard for now
              } else {
                // Fallback unmute after 3 seconds if turn completes but no audio was heard
                setTimeout(() => {
                  if (isFirstTurnRef.current) {
                    setIsMicMuted(false);
                    isFirstTurnRef.current = false;
                    // We keep the instructions on the whiteboard
                  }
                }, 3000);
              }
            }

            // Handle tool calls
            const toolCalls = message.toolCall?.functionCalls;
            if (toolCalls) {
              console.log("Received tool calls:", toolCalls.length);
              hasReceivedContentRef.current = true;
              setIsThinking(true);
              
              // Clear the "Connecting..." message on first content
              if (isFirstTurnRef.current) {
                setWhiteboardItems(prev => prev.filter(item => !item.text.includes("Connecting to your tutor")));
              }
              
              const responses = toolCalls.map(call => {
                if (call.name === 'writeOnWhiteboard') {
                  const args = call.args as any;
                  setIsWhiteboardMinimized(false);
                  setWhiteboardItems(prev => {
                    const newItems = args.clearFirst ? [] : [...prev];
                    if (args.text) {
                      let content = args.text;
                      
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
            console.error("Live API Error Details:", err);
            // Check if it's a common restriction error
            const errorMsg = err?.message || "";
            if (errorMsg.includes("403") || errorMsg.includes("API_KEY_INVALID")) {
              setError("Connection rejected. This is usually caused by Google Cloud API Key restrictions. Ensure 'www.owlhelp.study/*' is added to your HTTP Referrer restrictions in the Google Cloud Console.");
            } else if (errorMsg.includes("404")) {
              setError("Tutor service not found. This might be a temporary issue with the AI service or the proxy configuration.");
            } else {
              setError(`Connection error: ${errorMsg || "Please try again."}`);
            }
            stopSession();
          },
          onclose: () => {
            stopSession();
          }
        }
      });
      sessionPromise.then(session => {
        console.log("Live API Session Promise Resolved");
        sessionRef.current = session;
      }).catch(err => {
        console.error("Live API Connection Promise Rejected:", err);
        setError("Failed to connect to AI. Please try again.");
        stopSession();
      });

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

  if (isLoadingProfile) {
    return (
      <div className="w-full h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  if (showOnboarding && user) {
    return (
      <div className="relative w-full h-screen bg-slate-900 flex items-center justify-center overflow-hidden font-sans">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-sky-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-teal-400/20 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 flex flex-col items-center max-w-md w-full bg-slate-900/80 p-8 rounded-3xl border border-slate-800 backdrop-blur-xl shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Welcome to OwlHelp!</h2>
          <p className="text-slate-400 text-center mb-8 text-sm">Let's set up your profile so we can personalize your tutoring sessions.</p>

          <form 
            className="w-full flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const role = formData.get('role') as 'student' | 'parent';
              const parentName = formData.get('parentName') as string;
              
              let profile: UserProfile;

              if (role === 'student') {
                const studentName = formData.get('studentName') as string;
                if (!studentName) return;
                profile = { role, studentName };
              } else {
                // Parent role
                const childNamesString = formData.get('childNames') as string;
                if (!childNamesString) return;
                
                const children: ChildProfile[] = childNamesString
                  .split(',')
                  .map(name => name.trim())
                  .filter(name => name.length > 0)
                  .map(name => ({
                    id: crypto.randomUUID(),
                    name
                  }));
                  
                if (children.length === 0) return;
                profile = { role, parentName, children };
              }
              
              try {
                await setDoc(doc(db, 'users', user.uid), {
                  ...profile,
                  createdAt: serverTimestamp()
                });
                setUserProfile(profile);
                if (profile.role === 'parent' && profile.children && profile.children.length > 0) {
                  setActiveChildId(profile.children[0].id);
                }
                setShowOnboarding(false);
              } catch (error) {
                console.error("Error saving profile:", error);
                setAuthError("Failed to save profile. Please try again.");
              }
            }}
          >
            <div className="flex flex-col gap-2">
              <label className="text-slate-300 text-sm font-medium">Who is setting this up?</label>
              <select 
                name="role" 
                className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                required
                onChange={(e) => {
                  const isParent = e.target.value === 'parent';
                  const parentInput = document.getElementById('parentNameInput');
                  const singleStudentInput = document.getElementById('singleStudentInput');
                  const multiStudentInput = document.getElementById('multiStudentInput');
                  
                  if (parentInput) parentInput.style.display = isParent ? 'flex' : 'none';
                  if (singleStudentInput) singleStudentInput.style.display = isParent ? 'none' : 'flex';
                  if (multiStudentInput) multiStudentInput.style.display = isParent ? 'flex' : 'none';
                  
                  // Toggle required attributes
                  const studentNameInput = document.querySelector('input[name="studentName"]') as HTMLInputElement;
                  const childNamesInput = document.querySelector('input[name="childNames"]') as HTMLInputElement;
                  
                  if (studentNameInput) studentNameInput.required = !isParent;
                  if (childNamesInput) childNamesInput.required = isParent;
                }}
              >
                <option value="student">I am the Student</option>
                <option value="parent">I am a Parent/Guardian</option>
              </select>
            </div>

            <div id="singleStudentInput" className="flex flex-col gap-2">
              <label className="text-slate-300 text-sm font-medium">What is your first name?</label>
              <input
                type="text"
                name="studentName"
                placeholder="e.g. Alex"
                className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
                required
              />
            </div>

            <div id="parentNameInput" className="flex-col gap-2 hidden">
              <label className="text-slate-300 text-sm font-medium">What is your (parent) name? (Optional)</label>
              <input
                type="text"
                name="parentName"
                placeholder="e.g. Sarah"
                className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
              />
            </div>

            <div id="multiStudentInput" className="flex-col gap-2 hidden">
              <label className="text-slate-300 text-sm font-medium">What are your children's names?</label>
              <input
                type="text"
                name="childNames"
                placeholder="e.g. Alex, Sam, Jordan (comma separated)"
                className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
              />
              <p className="text-slate-500 text-xs mt-1">Separate multiple names with commas.</p>
            </div>

            {authError && (
              <div className="text-red-400 text-xs text-center mt-2">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-4 px-6 rounded-xl transition-all mt-4"
            >
              Save Profile
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (showParentPortal && userProfile?.role === 'parent') {
    return (
      <div className="min-h-screen bg-slate-950 p-6 font-sans text-white relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-sky-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-teal-400/20 rounded-full blur-3xl pointer-events-none" />
        
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold">Parent Portal</h1>
            <button 
              onClick={() => setShowParentPortal(false)} 
              className="text-slate-400 hover:text-white flex items-center gap-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Home
            </button>
          </div>
          
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-semibold">Welcome, {userProfile.parentName || 'Parent'}!</h2>
                <p className="text-slate-400 text-sm mt-1">Manage your children's learning sessions.</p>
              </div>
              <button 
                onClick={handleSignOut}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>

            <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
              <h3 className="text-lg font-semibold text-slate-200">Your Students</h3>
              <button 
                onClick={() => setShowAddChildModal(true)} 
                className="text-sm bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors font-medium border border-sky-500/30"
              >
                <Plus className="w-4 h-4" /> Add Student
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {userProfile.children?.map(child => (
                <div key={child.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 flex flex-col gap-4 hover:border-slate-600 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-sky-500/20 text-sky-400 rounded-full flex items-center justify-center text-xl font-bold border border-sky-500/30">
                        {child.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">{child.name}</h3>
                        <p className="text-slate-400 text-sm">{child.grade ? `Grade ${child.grade}` : 'Student'}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setEditingChild(child)}
                      className="text-slate-400 hover:text-white p-2 transition-colors rounded-lg hover:bg-slate-700/50"
                      title="Edit Profile"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <button 
                      onClick={() => {
                        setActiveChildId(child.id);
                        setShowParentPortal(false);
                        requestPermissions(child.id);
                      }}
                      className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-sky-500/20"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Start Tutor
                    </button>
                    {!child.pairingCode ? (
                      <button 
                        onClick={() => {
                          setLinkingChild(child);
                          setShowLinkModal(true);
                        }}
                        className="bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-indigo-500/30"
                      >
                        <Link className="w-4 h-4" />
                        Link Device
                      </button>
                    ) : (
                      <button 
                        onClick={() => {
                          setStatsChild(child);
                          setShowStatsModal(true);
                        }}
                        className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors border border-emerald-500/30"
                      >
                        <BarChart className="w-4 h-4" />
                        Usage Stats
                      </button>
                    )}
                  </div>
                  {child.pairingCode && (
                    <button 
                      onClick={() => {
                        setLinkingChild(child);
                        setShowLinkModal(true);
                      }}
                      className="mt-1 text-xs text-indigo-400 hover:text-indigo-300 flex items-center justify-center gap-1 w-full py-2 bg-slate-800/50 rounded-lg border border-slate-700/50 transition-colors"
                    >
                      <QrCode className="w-3 h-3" /> Device Linked (View Code)
                    </button>
                  )}
                </div>
              ))}
              
              {(!userProfile.children || userProfile.children.length === 0) && (
                <div className="col-span-full text-center py-8 text-slate-500">
                  No students found. Please update your profile.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Modal */}
        {showStatsModal && statsChild && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-md p-8 relative shadow-2xl">
              <button 
                onClick={() => {
                  setShowStatsModal(false);
                  setStatsChild(null);
                }}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/30">
                <BarChart className="w-8 h-8 text-emerald-400" />
              </div>

              <h2 className="text-2xl font-bold mb-2 text-white text-center">{statsChild.name}'s Usage Stats</h2>
              <p className="text-slate-400 text-sm mb-8 text-center">
                Activity from their linked device.
              </p>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center">
                  <p className="text-3xl font-bold text-white mb-1">12</p>
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Sessions</p>
                </div>
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center">
                  <p className="text-3xl font-bold text-white mb-1">4.5h</p>
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Time</p>
                </div>
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center col-span-2">
                  <p className="text-lg font-bold text-white mb-1">Algebra & Fractions</p>
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Top Subjects</p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowStatsModal(false);
                  setStatsChild(null);
                }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-4 rounded-xl transition-all"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Add Child Modal */}
        {showAddChildModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-md p-8 relative shadow-2xl">
              <button 
                onClick={() => setShowAddChildModal(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <h2 className="text-2xl font-bold mb-6 text-white">Add a Student</h2>
              
              <form 
                className="flex flex-col gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!user || !userProfile) return;
                  
                  const formData = new FormData(e.currentTarget);
                  const newChild: ChildProfile = {
                    id: crypto.randomUUID(),
                    name: formData.get('name') as string,
                    grade: formData.get('grade') as string,
                    learningStyle: formData.get('learningStyle') as string,
                    interests: formData.get('interests') as string,
                  };

                  const updatedChildren = [...(userProfile.children || []), newChild];
                  const updatedProfile = { ...userProfile, children: updatedChildren };

                  try {
                    await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
                    setUserProfile(updatedProfile);
                    setShowAddChildModal(false);
                  } catch (error) {
                    console.error("Error adding child:", error);
                    alert("Failed to add student.");
                  }
                }}
              >
                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Name</label>
                  <input
                    type="text"
                    name="name"
                    placeholder="e.g. Jordan"
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    required
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Grade Level</label>
                  <select
                    name="grade"
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select a grade...</option>
                    <option value="K-2">Kindergarten - 2nd Grade</option>
                    <option value="3-5">3rd - 5th Grade</option>
                    <option value="6-8">Middle School (6th - 8th)</option>
                    <option value="9-12">High School (9th - 12th)</option>
                    <option value="College">College / University</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Learning Style</label>
                  <select
                    name="learningStyle"
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select a style...</option>
                    <option value="Visual">Visual (Prefers diagrams, pictures, whiteboard)</option>
                    <option value="Auditory">Auditory (Prefers listening and talking it out)</option>
                    <option value="Kinesthetic">Kinesthetic (Prefers hands-on, real-world examples)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Interests / Hobbies</label>
                  <input
                    type="text"
                    name="interests"
                    placeholder="e.g. Minecraft, Soccer, Space, Dinosaurs"
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 px-4 rounded-xl transition-all mt-2"
                >
                  Add Student
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Link Device Modal */}
        {showLinkModal && linkingChild && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-md p-8 relative shadow-2xl text-center">
              <button 
                onClick={() => {
                  setShowLinkModal(false);
                  setLinkingChild(null);
                }}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-indigo-500/30">
                <Link className="w-8 h-8 text-indigo-400" />
              </div>

              <h2 className="text-2xl font-bold mb-2 text-white">Link {linkingChild.name}'s Device</h2>
              <p className="text-slate-400 text-sm mb-8">
                Want {linkingChild.name} to use OwlHelp on their own iPad or phone? Generate a pairing code below.
              </p>

              {!linkingChild.pairingCode ? (
                <button
                  onClick={async () => {
                    if (!user || !userProfile || !userProfile.children) return;
                    const newCode = generatePairingCode();
                    const updatedChildren = userProfile.children.map(c => 
                      c.id === linkingChild.id ? { ...c, pairingCode: newCode } : c
                    );
                    const updatedProfile = { ...userProfile, children: updatedChildren };
                    
                    try {
                      console.log("Generating new pairing code for child:", linkingChild.name);
                      // 1. Update the parent's profile
                      await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
                      console.log("Parent profile updated with new code:", newCode);
                      
                      // 2. Store the pairing code in a global lookup collection
                      await setDoc(doc(db, 'pairingCodes', newCode), {
                        parentId: user.uid,
                        childId: linkingChild.id,
                        childName: linkingChild.name,
                        createdAt: serverTimestamp()
                      });
                      console.log("Global pairing code document created successfully.");

                      setUserProfile(updatedProfile);
                      setLinkingChild({ ...linkingChild, pairingCode: newCode });
                    } catch (error) {
                      console.error("Error generating code:", error);
                      alert("Failed to generate code.");
                    }
                  }}
                  className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg shadow-indigo-500/20"
                >
                  Generate Pairing Code
                </button>
              ) : (
                <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 mb-6">
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Option 1: Pairing Code</p>
                  <div className="flex items-center justify-center gap-4 mb-6">
                    <span className="text-4xl font-mono font-bold text-white tracking-widest">
                      {linkingChild.pairingCode.length === 6 
                        ? `${linkingChild.pairingCode.slice(0, 3)}-${linkingChild.pairingCode.slice(3)}`
                        : linkingChild.pairingCode}
                    </span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(linkingChild.pairingCode!);
                        alert("Code copied to clipboard!");
                      }}
                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                      title="Copy Code"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="w-full h-px bg-slate-700 mb-6"></div>

                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Option 2: Magic Invite Link</p>
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}?pair=${linkingChild.pairingCode}`;
                      navigator.clipboard.writeText(link);
                      alert("Invite link copied! You can text or email this to your child's device.");
                    }}
                    className="w-full bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Link className="w-4 h-4" />
                    Copy Invite Link
                  </button>
                </div>
              )}

              {linkingChild.pairingCode && (
                <div className="text-left bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
                  <h4 className="text-sm font-bold text-slate-200 mb-2">How to use:</h4>
                  <ul className="text-xs text-slate-400 space-y-2 list-disc list-inside">
                    <li><strong>If using the code:</strong> Open OwlHelp on their device, click "I am a Student", and enter the code.</li>
                    <li><strong>If using the link:</strong> Just text them the link. When they click it, it will log them in automatically!</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit Child Modal */}
        {editingChild && !showLinkModal && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-md p-8 relative shadow-2xl">
              <button 
                onClick={() => setEditingChild(null)}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <h2 className="text-2xl font-bold mb-6 text-white">Edit {editingChild.name}'s Profile</h2>
              
              <form 
                className="flex flex-col gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!user || !userProfile || !userProfile.children) return;
                  
                  const formData = new FormData(e.currentTarget);
                  const updatedChild: ChildProfile = {
                    id: editingChild.id,
                    name: formData.get('name') as string,
                    grade: formData.get('grade') as string,
                    learningStyle: formData.get('learningStyle') as string,
                    interests: formData.get('interests') as string,
                  };

                  const updatedChildren = userProfile.children.map(c => 
                    c.id === editingChild.id ? updatedChild : c
                  );

                  const updatedProfile = { ...userProfile, children: updatedChildren };

                  try {
                    await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
                    setUserProfile(updatedProfile);
                    setEditingChild(null);
                  } catch (error) {
                    console.error("Error updating child:", error);
                    alert("Failed to save changes.");
                  }
                }}
              >
                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Name</label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={editingChild.name}
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                    required
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Grade Level</label>
                  <select
                    name="grade"
                    defaultValue={editingChild.grade || ""}
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select a grade...</option>
                    <option value="K-2">Kindergarten - 2nd Grade</option>
                    <option value="3-5">3rd - 5th Grade</option>
                    <option value="6-8">Middle School (6th - 8th)</option>
                    <option value="9-12">High School (9th - 12th)</option>
                    <option value="College">College / University</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Learning Style</label>
                  <select
                    name="learningStyle"
                    defaultValue={editingChild.learningStyle || ""}
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select a style...</option>
                    <option value="Visual">Visual (Prefers diagrams, pictures, whiteboard)</option>
                    <option value="Auditory">Auditory (Prefers listening and talking it out)</option>
                    <option value="Kinesthetic">Kinesthetic (Prefers hands-on, real-world examples)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-slate-300 text-sm font-medium">Interests / Hobbies</label>
                  <input
                    type="text"
                    name="interests"
                    defaultValue={editingChild.interests || ""}
                    placeholder="e.g. Minecraft, Soccer, Space, Dinosaurs"
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
                  />
                  <p className="text-slate-500 text-xs mt-1">The AI will use these to create fun, personalized word problems!</p>
                </div>

                <div className="flex gap-3 mt-4">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user || !userProfile || !userProfile.children) return;
                      const confirmDelete = window.confirm(`Are you sure you want to delete ${editingChild.name}? This cannot be undone.`);
                      if (confirmDelete) {
                        const updatedChildren = userProfile.children.filter(c => c.id !== editingChild.id);
                        const updatedProfile = { ...userProfile, children: updatedChildren };
                        try {
                          await setDoc(doc(db, 'users', user.uid), updatedProfile, { merge: true });
                          setUserProfile(updatedProfile);
                          setEditingChild(null);
                          if (activeChildId === editingChild.id) {
                            setActiveChildId(updatedChildren.length > 0 ? updatedChildren[0].id : null);
                          }
                        } catch (error) {
                          console.error("Error deleting child:", error);
                          alert("Failed to delete profile.");
                        }
                      }
                    }}
                    className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                  <button
                    type="submit"
                    className="flex-[2] bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 px-4 rounded-xl transition-all"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        <LegalModals showPrivacy={showPrivacy} setShowPrivacy={setShowPrivacy} showTerms={showTerms} setShowTerms={setShowTerms} />
      </div>
    );
  }

  if (showSplash) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden">
        {/* About Button */}
        <button 
          onClick={() => setShowAbout(true)}
          className="absolute top-6 left-6 z-50 text-slate-400 hover:text-white transition-colors flex items-center gap-2 group"
        >
          <Info className="w-8 h-8" />
          <span className="text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline">About OwlHelp!</span>
        </button>

        {/* Settings Button */}
        <button 
          onClick={() => setShowSettings(true)}
          className="absolute top-6 right-6 z-50 text-slate-400 hover:text-white transition-colors"
        >
          <Settings className="w-8 h-8" />
        </button>

        {/* About Modal */}
        {showAbout && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-2xl p-8 relative max-h-[90vh] overflow-y-auto shadow-2xl">
              <button 
                onClick={() => setShowAbout(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center p-2 shadow-lg">
                  <img src="/owl-logo.png" alt="OwlHelp! Logo" className="w-full h-full object-contain" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-white">About OwlHelp!</h2>
                  <p className="text-sky-400 font-medium">Your Virtual Socratic Tutor</p>
                </div>
              </div>

              <div className="space-y-6 text-slate-300 leading-relaxed">
                <section>
                  <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-yellow-400" />
                    What is OwlHelp!?
                  </h3>
                  <p>
                    OwlHelp! is an AI-powered math tutor designed to help students truly understand algebra and geometry concepts. 
                    Unlike other tools that just give you the answer, OwlHelp! acts like a real tutor in the room, guiding you step-by-step 
                    through the logic of every problem.
                  </p>
                </section>

                <section className="grid sm:grid-cols-2 gap-6">
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700">
                    <h4 className="text-white font-bold mb-2 flex items-center gap-2">
                      <Mic className="w-4 h-4 text-sky-400" />
                      Talk Naturally
                    </h4>
                    <p className="text-sm">
                      Encourage your student to talk to OwlHelp! just like a human. They can ask "How do I start?" or 
                      "Wait, why did we do that?" and get a patient, helpful response.
                    </p>
                  </div>
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700">
                    <h4 className="text-white font-bold mb-2 flex items-center gap-2">
                      <LayoutDashboard className="w-4 h-4 text-emerald-400" />
                      Visual Whiteboard
                    </h4>
                    <p className="text-sm">
                      OwlHelp! uses a digital whiteboard to mirror the student's work, draw diagrams, number lines, 
                      and coordinate planes to make abstract concepts concrete.
                    </p>
                  </div>
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700">
                    <h4 className="text-white font-bold mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-orange-400" />
                      Study Guides
                    </h4>
                    <p className="text-sm">
                      At any time, you can download a PDF of the current whiteboard. It automatically filters out 
                      final answers, creating a perfect practice sheet for the student to solve later.
                    </p>
                  </div>
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700">
                    <h4 className="text-white font-bold mb-2 flex items-center gap-2">
                      <GraduationCap className="w-4 h-4 text-purple-400" />
                      Socratic Method
                    </h4>
                    <p className="text-sm">
                      Our AI is trained to never "spoil" the answer. It asks leading questions that empower 
                      the student to find the solution themselves, building confidence and mastery.
                    </p>
                  </div>
                </section>

                <div className="bg-sky-500/10 border border-sky-500/20 p-6 rounded-2xl">
                  <h3 className="text-sky-400 font-bold mb-2">Parent Tip:</h3>
                  <p className="text-sm italic">
                    "OwlHelp! works best when the student treats it like a study partner. Have them point the camera 
                    at their paper and explain what they're thinking out loud. The AI will follow along and catch 
                    mistakes in real-time!"
                  </p>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2 text-slate-500 text-xs">
                  <span>Powered by Google Gemini</span>
                </div>
                <button 
                  onClick={() => setShowAbout(false)}
                  className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 px-6 rounded-xl transition-all"
                >
                  Got it!
                </button>
              </div>
            </div>
          </div>
        )}

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
                  <option value="Zephyr">Zephyr: Bright and clear</option>
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
                  className="w-48 object-contain rounded-lg mb-8"
                />
                
                {/* Footer with Privacy Policy and Gemini Credit */}
                <div className="w-full flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                    <span>Powered by</span>
                    <span className="flex items-center gap-1 text-sky-400">
                      <Sparkles className="w-3 h-3" />
                      Google Gemini
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPrivacy(true); }} className="hover:text-slate-300 underline decoration-slate-700 underline-offset-2 transition-colors cursor-pointer relative z-50">Privacy Policy</button>
                    <span>&bull;</span>
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTerms(true); }} className="hover:text-slate-300 underline decoration-slate-700 underline-offset-2 transition-colors cursor-pointer relative z-50">Terms of Service</button>
                  </div>
                </div>
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

          {user ? (
            <div className="flex flex-col items-center w-full gap-4 mb-8">
              <div className="flex items-center gap-3 bg-slate-800/50 p-3 rounded-2xl border border-slate-700 w-full">
                <img 
                  src={user.photoURL || ''} 
                  alt={user.displayName || 'User'} 
                  className="w-10 h-10 rounded-full border border-slate-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{user.displayName || userProfile?.parentName || activeStudentName || 'User'}</p>
                  <p className="text-slate-400 text-xs truncate">{user.email}</p>
                </div>
                <button 
                  onClick={handleSignOut}
                  className="text-slate-400 hover:text-white p-2 transition-colors"
                  title="Sign Out"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {userProfile?.role === 'parent' ? (
                <button
                  onClick={() => setShowParentPortal(true)}
                  className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-4 px-6 rounded-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
                >
                  <LayoutDashboard className="w-5 h-5" />
                  Open Parent Portal
                </button>
              ) : (
                <button
                  onClick={() => requestPermissions()}
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
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center w-full gap-4 mb-8">
              <button
                onClick={handleSignIn}
                className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-4 px-6 rounded-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                Sign In with Google
              </button>
              
              <div className="flex items-center w-full gap-4 my-2">
                <div className="flex-1 h-px bg-slate-700"></div>
                <span className="text-slate-500 text-xs font-medium">OR</span>
                <div className="flex-1 h-px bg-slate-700"></div>
              </div>

              {linkSent ? (
                <div className="bg-emerald-500/10 border border-emerald-500/50 text-emerald-400 text-sm p-4 rounded-xl w-full text-center">
                  Check your email! We sent a magic link to <strong>{email}</strong>.
                </div>
              ) : (
                <form onSubmit={handleSendMagicLink} className="w-full flex flex-col gap-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter parent email"
                    className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={isSendingLink || !email}
                    className="w-full bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    {isSendingLink ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Magic Link'}
                  </button>
                </form>
              )}

              <div className="w-full mt-6 pt-6 border-t border-slate-800">
                <button
                  onClick={() => setShowStudentLogin(true)}
                  className="w-full bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 font-bold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-3"
                >
                  <QrCode className="w-5 h-5" />
                  I am a Student (Pairing Code)
                </button>
              </div>

              {authError && (
                <div className="text-red-400 text-xs text-center mt-2">
                  {authError}
                </div>
              )}

              <p className="text-slate-500 text-[10px] text-center px-4 mt-2">
                Sign in to save your progress and access personalized tutoring.
              </p>
            </div>
          )}

          {permissionError && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm p-4 rounded-xl mb-6 text-center w-full">
              {permissionError}
            </div>
          )}

          {/* Footer with Privacy Policy and Gemini Credit */}
          <div className="w-full mt-auto pt-8 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
              <span>Powered by</span>
              <span className="flex items-center gap-1 text-sky-400">
                <Sparkles className="w-3 h-3" />
                Google Gemini
              </span>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-slate-500">
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPrivacy(true); }} className="hover:text-slate-300 underline decoration-slate-700 underline-offset-2 transition-colors cursor-pointer relative z-50">Privacy Policy</button>
              <span>&bull;</span>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTerms(true); }} className="hover:text-slate-300 underline decoration-slate-700 underline-offset-2 transition-colors cursor-pointer relative z-50">Terms of Service</button>
            </div>
          </div>
        </div>

        {/* Student Login Modal */}
        {showStudentLogin && !user && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-6">
            <div className="bg-slate-900 border border-slate-700 text-white rounded-3xl w-full max-w-md p-8 relative shadow-2xl text-center">
              <button 
                onClick={() => setShowStudentLogin(false)}
                className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-indigo-500/30">
                <GraduationCap className="w-8 h-8 text-indigo-400" />
              </div>

              <h2 className="text-2xl font-bold mb-2 text-white">Student Login</h2>
              <p className="text-slate-400 text-sm mb-8">
                Enter the 6-digit pairing code from your parent's device.
              </p>

              <form 
                onSubmit={handleStudentLogin}
                className="flex flex-col gap-4"
              >
                <div className="relative">
                  <input
                    type="text"
                    value={studentPairingCode}
                    onChange={(e) => setStudentPairingCode(e.target.value.toUpperCase())}
                    placeholder="e.g. A7B-9X2"
                    maxLength={12}
                    className="w-full bg-slate-800/80 border border-slate-600 text-white px-4 py-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center text-2xl font-mono tracking-widest uppercase pr-12"
                    required
                  />
                  {studentPairingCode && (
                    <button
                      type="button"
                      onClick={() => setStudentPairingCode('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
                {authError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={studentPairingCode.length < 6 || isLoadingProfile}
                  className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg shadow-indigo-500/20 mt-2 flex items-center justify-center gap-2"
                >
                  {isLoadingProfile ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    "Connect Device"
                  )}
                </button>
              </form>
            </div>
          </div>
        )}
        <LegalModals showPrivacy={showPrivacy} setShowPrivacy={setShowPrivacy} showTerms={showTerms} setShowTerms={setShowTerms} />
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
          <div className="relative">
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
            {user?.photoURL && (
              <img 
                src={user.photoURL} 
                alt="" 
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-black shadow-md"
              />
            )}
          </div>
          <div className="flex flex-col">
            <h1 className="text-white font-bold text-xl tracking-tight drop-shadow-md leading-none">OwlHelp!</h1>
            {user && <span className="text-white/60 text-[10px] font-medium truncate max-w-[100px]">{user.displayName}</span>}
          </div>
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
                onClick={downloadPDF}
                className="p-2.5 bg-slate-900/90 hover:bg-slate-800 backdrop-blur-md border border-slate-700 text-slate-300 hover:text-white rounded-full shadow-lg transition-all"
                title="Download Study Guide (PDF)"
              >
                <FileText className="w-4 h-4" />
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
            onClick={() => startSession()}
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
                onClick={() => setIsWhiteboardMinimized(!isWhiteboardMinimized)}
                className={`p-4 rounded-full backdrop-blur-md transition-all ${
                  !isWhiteboardMinimized 
                    ? 'bg-emerald-500/80 text-white hover:bg-emerald-500' 
                    : 'bg-white/20 text-white hover:bg-white/30 border border-white/10'
                }`}
                title={isWhiteboardMinimized ? "Show Whiteboard" : "Hide Whiteboard"}
              >
                <LayoutDashboard className="w-6 h-6" />
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

      <LegalModals showPrivacy={showPrivacy} setShowPrivacy={setShowPrivacy} showTerms={showTerms} setShowTerms={setShowTerms} />
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
