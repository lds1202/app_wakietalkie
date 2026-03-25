/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, Users, Globe, History, Settings, Lock, 
  ChevronRight, Plus, Search, Signal, Volume2, 
  MoreVertical, ShieldCheck, Radio, X, Menu, BarChart3,
  Sun, Moon, User, Bell, Smartphone, Camera, PlusCircle, LogIn,
  UserCheck, UserX, Edit3, RotateCcw, Info, ChevronLeft, Eye, EyeOff,
  Hash, Play, BookOpen, HelpCircle, Palette, Check, Heart, Home, Coffee, Car, 
  Tent, BellOff, VolumeX, MicOff, MapPin, Dog, Bike, Ghost, Languages, Trash2,
  ChevronDown, LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from './translations';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  signInAnonymously
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  serverTimestamp,
  getDoc,
  addDoc,
  getDocFromServer,
  getDocs,
  deleteDoc,
  orderBy,
  limit
} from 'firebase/firestore';

// --- Firestore Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if ((this as any).state.hasError) {
      let errorMessage = "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
      try {
        const parsed = JSON.parse((this as any).state.error?.message || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          errorMessage = "권한이 없거나 보안 규칙에 위배되었습니다. 관리자에게 문의하세요.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="h-screen flex flex-col items-center justify-center p-6 text-center bg-red-50">
          <X size={48} className="text-red-500 mb-4" />
          <h1 className="text-xl font-bold mb-2">오류가 발생했습니다</h1>
          <p className="text-sm text-gray-600 mb-6">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-500 text-white rounded-full font-bold"
          >
            새로고침
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

/**
 * TeamWave App
 * 가족, 연인, 소규모 팀을 위한 따뜻한 감성의 Apple HIG 스타일 무전기
 */

type PttState = 'idle' | 'sending' | 'receiving' | 'replaying';
type TabId = 'radio' | 'channels' | 'history' | 'settings';
type ChannelView = 'list' | 'create' | 'join';

interface TeamMember {
  id: number;
  userId?: string;
  name: string;
  status: 'online' | 'offline';
  icon: React.ReactNode;
  manner: boolean;
  currentChannelId?: string | null;
}

interface Channel {
  id: string;
  name: string;
  members: number;
  active: boolean;
  iconType: string;
  category?: string;
  isOwner?: boolean;
  distance?: number;
}

interface LogEntry {
  id: string;
  senderId: string;
  sender: string;
  time: string;
  room: string;
  icon: string;
  manner: boolean;
  audioData?: string;
}

const themeColors = {
  Red: '#FF3B30',
  Green: '#34C759',
  Purple: '#AF52DE',
  Blue: '#007AFF',
  Amber: '#FF9500'
};

type SkinId = 'general' | 'kids' | 'military' | 'lovely';
type FontId = 'sans' | 'serif' | 'mono' | 'rounded';

const skins: Record<SkinId, { name: string, icon: any, color: string }> = {
  general: { name: '일반', icon: Smartphone, color: '#007AFF' },
  kids: { name: '어린이', icon: Dog, color: '#FFCC00' },
  military: { name: '밀리터리', icon: ShieldCheck, color: '#4B5320' },
  lovely: { name: '러블리', icon: Heart, color: '#FF2D55' }
};

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  // --- 1. 전역 상태 관리 ---
  const [activeTab, setActiveTab] = useState<TabId>('radio');
  const [channelView, setChannelView] = useState<ChannelView>('list');
  const [darkMode, setDarkMode] = useState(false);
  const [skin, setSkin] = useState<SkinId>('general');
  const [font, setFont] = useState<FontId>('rounded');
  const [language, setLanguage] = useState<Language>('ko');
  const [displayName, setDisplayName] = useState(() => {
    return localStorage.getItem('teamwave_display_name') || '행복한 아빠';
  });
  const [userId, setUserId] = useState('');
  const [pttState, setPttState] = useState<PttState>('idle');
  const [isMannerMode, setIsMannerMode] = useState(false);
  const [currentGroup, setCurrentGroup] = useState(() => {
    return localStorage.getItem('teamwave_current_group_name') || '우리 가족 대화방';
  });
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);
  const [speakerName, setSpeakerName] = useState('');
  
  // 채널 생성 및 참여 폼 상태
  const [newChannelName, setNewChannelName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [newChannelCode, setNewChannelCode] = useState('');
  const [joinCode, setJoinCode] = useState('');

  // 송신 테마 설정
  const [sendingTheme, setSendingTheme] = useState<keyof typeof themeColors>('Amber');
  
  // 시스템 설정
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [beepVolume, setBeepVolume] = useState(60);
  const [beepSound, setBeepSound] = useState('띠리릭');
  const [showGuide, setShowGuide] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [remoteSpeaker, setRemoteSpeaker] = useState<{id: string, name: string} | null>(null);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ show: false, title: '', message: '', onConfirm: () => {} });
  
  const [collapsedSections, setCollapsedSections] = useState({
    previous: true,
    local: false,
    public: false
  });
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastPlayedLogIdRef = useRef<string | null>(null);

  const t = translations[language];

  // --- 2. 데이터 세팅 ---
  const [myChannels, setMyChannels] = useState<Channel[]>([]);
  const [publicChannels, setPublicChannels] = useState<Channel[]>([]);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(() => {
    return localStorage.getItem('teamwave_current_channel_id');
  });
  const [allUsers, setAllUsers] = useState<TeamMember[]>([]);

  const onlineMembers = allUsers.filter(m => m.status === 'online');
  const offlineMembers = allUsers.filter(m => m.status === 'offline');

  const roomOnlineMembers = allUsers.filter(m => m.status === 'online' && m.currentChannelId === currentChannelId);

  const getChannelMemberCount = (channelId: string) => {
    return allUsers.filter(u => u.status === 'online' && u.currentChannelId === channelId).length;
  };

  const isSending = pttState === 'sending';
  const activeSendingColor = themeColors[sendingTheme];

  const getSkinTheme = () => {
    const isDark = darkMode;
    
    switch (skin) {
      case 'kids':
        return {
          bg: isDark ? '#2C1A00' : '#FFF9E5',
          itemBg: isDark ? 'bg-[#3D2B00]' : 'bg-white',
          divider: isDark ? 'border-[#4D3B00]' : 'border-[#FFE082]',
          text: isDark ? 'text-[#FFD60A]' : 'text-[#856404]',
          subText: isDark ? 'text-[#FFD60A]/60' : 'text-[#856404]/60',
          accent: '#FFCC00',
          radius: 'rounded-[32px]',
        };
      case 'military':
        return {
          bg: isDark ? '#1A1C14' : '#E8E9E4',
          itemBg: isDark ? 'bg-[#25281D]' : 'bg-white',
          divider: isDark ? 'border-[#323627]' : 'border-[#A3A895]',
          text: isDark ? 'text-[#D0D4C5]' : 'text-[#353B29]',
          subText: isDark ? 'text-[#D0D4C5]/60' : 'text-[#353B29]/60',
          accent: '#4B5320',
          radius: 'rounded-none',
        };
      case 'lovely':
        return {
          bg: isDark ? '#220A12' : '#FFF0F5',
          itemBg: isDark ? 'bg-[#33121C]' : 'bg-white',
          divider: isDark ? 'border-[#441A26]' : 'border-[#FFC0CB]',
          text: isDark ? 'text-[#FFB6C1]' : 'text-[#C71585]',
          subText: isDark ? 'text-[#FFB6C1]/60' : 'text-[#C71585]/60',
          accent: '#FF2D55',
          radius: 'rounded-[40px]',
        };
      default:
        return {
          bg: isDark ? '#0A0F1E' : '#F2F2F7',
          itemBg: isDark ? 'bg-[#161B2E]' : 'bg-white',
          divider: isDark ? 'border-[#242B42]' : 'border-[#C6C6C8]',
          text: isDark ? 'text-white' : 'text-black',
          subText: isDark ? 'text-[#8E8E93]' : 'text-[#8E8E93]',
          accent: '#007AFF',
          radius: 'rounded-[24px]',
        };
    }
  };

  const skinTheme = getSkinTheme();

  const requestMicPermission = async () => {
    if (micPermission === 'denied') {
      alert("마이크 권한이 차단되어 있습니다. 브라우저 주소창 옆의 자물쇠 아이콘을 누르거나 설정에서 마이크 권한을 '허용'으로 변경해 주세요.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop immediately after permission check
      setMicPermission('granted');
      return true;
    } catch (err) {
      console.error("Microphone permission denied:", err);
      setMicPermission('denied');
      return false;
    }
  };

  useEffect(() => {
    if (userId && isAuthReady) {
      // Check if permission was already granted
      navigator.permissions?.query?.({ name: 'microphone' as PermissionName }).then((result) => {
        if (result.state === 'granted') {
          setMicPermission('granted');
        } else if (result.state === 'denied') {
          setMicPermission('denied');
        }
      }).catch(() => {
        // Fallback if permissions API not supported
      });
    }
  }, [userId, isAuthReady]);

  useEffect(() => {
    if (userId && isAuthReady && activeTab === 'radio' && micPermission === 'prompt') {
      requestMicPermission();
    }
  }, [userId, isAuthReady, activeTab, micPermission]);

  const theme = {
    bgInline: isSending ? activeSendingColor : skinTheme.bg,
    itemBg: isSending ? 'bg-white/10' : skinTheme.itemBg,
    divider: isSending ? 'border-white/20' : skinTheme.divider,
    text: isSending ? 'text-white' : skinTheme.text,
    subText: isSending ? 'text-white/70' : skinTheme.subText,
    accent: isSending ? '#FFFFFF' : skinTheme.accent,
    radius: skinTheme.radius,
    font: font === 'sans' ? 'font-sans' : font === 'serif' ? 'font-serif' : font === 'mono' ? 'font-mono' : 'font-rounded',
  };

  // --- 3. 이벤트 핸들러 ---
  // Firebase Auth & Sync
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setIsAuthReady(true);
        setUserId(user.uid);
        setDisplayName(user.displayName || '사용자');
        localStorage.setItem('teamwave_user_id', user.uid);
        localStorage.setItem('teamwave_display_name', user.displayName || '사용자');
        
        // Sync profile
        try {
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            displayName: user.displayName || '사용자',
            photoURL: user.photoURL || '',
            lastActive: serverTimestamp(),
            isOnline: true
          }, { merge: true });
        } catch (error) {
          console.error("Firestore Error: ", error);
        }
      } else {
        setIsAuthReady(true);
        setUserId('');
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // Test connection
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    } catch (error: any) {
      console.error("Login Error: ", error);
      if (error.code === 'auth/admin-restricted-operation') {
        alert(t.auth.googleDisabled);
      } else {
        alert(t.auth.error + error.message);
      }
    }
  };

  const handleAnonymousLogin = async () => {
    try {
      await signInAnonymously(auth);
    } catch (error: any) {
      console.error("Anonymous Login Error: ", error);
      if (error.code === 'auth/admin-restricted-operation') {
        alert(t.auth.anonymousDisabled);
      } else {
        alert(t.auth.error + error.message);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserId('');
      setIsAuthReady(false);
    } catch (error) {
      console.error("Logout Error: ", error);
    }
  };

  // Sync current channel to localStorage
  useEffect(() => {
    if (currentChannelId) {
      localStorage.setItem('teamwave_current_channel_id', currentChannelId);
    } else {
      localStorage.removeItem('teamwave_current_channel_id');
    }
  }, [currentChannelId]);

  useEffect(() => {
    if (currentGroup) {
      localStorage.setItem('teamwave_current_group_name', currentGroup);
    }
  }, [currentGroup]);

  // Sync current channel to Firestore
  useEffect(() => {
    if (!userId || !isAuthReady) return;
    
    const syncChannel = async () => {
      try {
        await setDoc(doc(db, 'users', userId), {
          currentChannelId: currentChannelId || null,
          lastActive: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error("Error syncing channel:", error);
      }
    };
    
    syncChannel();
  }, [currentChannelId, userId, isAuthReady]);

  // Fetch Users
  useEffect(() => {
    if (!userId || !isAuthReady) return;
    const q = query(collection(db, 'users'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: Math.random(),
          userId: data.uid,
          name: data.displayName,
          status: data.isOnline ? 'online' : 'offline',
          icon: data.photoURL ? <img src={data.photoURL} className="w-full h-full rounded-full" referrerPolicy="no-referrer" /> : '👤',
          manner: false,
          currentChannelId: data.currentChannelId || null
        } as TeamMember;
      });
      setAllUsers(users);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
    return () => unsubscribe();
  }, [isAuthReady]);

  // Fetch Channels
  useEffect(() => {
    if (!userId || !isAuthReady) {
      setMyChannels([]);
      setPublicChannels([]);
      return;
    }

    console.log("Fetching channels for user:", userId);

    const publicQ = query(collection(db, 'channels'), where('isPublic', '==', true));
    const unsubscribePublic = onSnapshot(publicQ, (snapshot) => {
      const channels = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          members: data.memberCount || 0,
          active: false,
          iconType: data.iconType || 'globe',
          category: 'Public',
          distance: data.distance || 0,
          isOwner: data.ownerId === userId
        } as Channel;
      });
      setPublicChannels(channels);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'channels'));

    const myQ = query(collection(db, 'memberships'), where('userId', '==', userId));
    console.log("Querying memberships with userId:", userId);
    const unsubscribeMy = onSnapshot(myQ, (snapshot) => {
      console.log("Memberships snapshot received, count:", snapshot.size);
      if (snapshot.empty) {
        console.log("No memberships found for user:", userId);
      }
      const channels = snapshot.docs.map(doc => {
        const data = doc.data();
        console.log("Membership doc data:", data);
        return {
          id: data.channelId,
          name: data.channelName,
          members: 0,
          active: true,
          iconType: data.iconType || 'home',
          isOwner: data.isOwner || false
        } as Channel;
      });
      setMyChannels(channels);
      if (channels.length > 0) {
        const currentExists = channels.some(c => c.id === currentChannelId);
        if (!currentExists || !currentChannelId) {
          setCurrentChannelId(channels[0].id);
          setCurrentGroup(channels[0].name);
        }
      } else {
        setCurrentChannelId(null);
        setCurrentGroup('대화방을 선택하세요');
      }
    }, (error) => {
      console.error("Memberships snapshot error:", error);
      handleFirestoreError(error, OperationType.LIST, 'memberships');
    });

    return () => {
      unsubscribePublic();
      unsubscribeMy();
    };
  }, [userId, isAuthReady]);

  // Fetch Logs
  useEffect(() => {
    if (!userId || !currentChannelId || !isAuthReady) return;

    const logsQ = query(
      collection(db, 'channels', currentChannelId, 'logs'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsubscribeLogs = onSnapshot(logsQ, (snapshot) => {
      const logs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          senderId: data.senderId,
          sender: data.senderName,
          time: data.timestamp?.toDate().toLocaleTimeString() || '',
          room: currentGroup,
          icon: '🎙️',
          manner: data.isMannerMode || false,
          audioData: data.audioData
        } as LogEntry;
      });
      setRecentLogs(logs);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `channels/${currentChannelId}/logs`));

    return () => unsubscribeLogs();
  }, [currentChannelId, isAuthReady, currentGroup]);

  // Listen for remote PTT
  useEffect(() => {
    if (!userId || !isAuthReady || !currentChannelId) return;

    const q = query(
      collection(db, 'ptt_status'), 
      where('channelId', '==', currentChannelId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeSenders = snapshot.docs
        .map(doc => doc.data())
        .filter(data => data.userId !== auth.currentUser?.uid && data.status === 'sending');

      if (activeSenders.length > 0) {
        const sender = activeSenders[0];
        setSpeakerName(sender.userName);
        setRemoteSpeaker({ id: sender.userId, name: sender.userName });
        if (pttState === 'idle') {
          setPttState('receiving');
        }
      } else {
        setRemoteSpeaker(null);
        if (pttState === 'receiving') {
          setPttState('idle');
        }
      }
    }, (error) => {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: 'list',
        path: 'ptt_status',
        authInfo: { userId: auth.currentUser?.uid }
      }));
    });

    return () => unsubscribe();
  }, [isAuthReady, pttState, currentChannelId]);

  // Update my PTT status
  useEffect(() => {
    if (!isAuthReady || !auth.currentUser || !currentChannelId) return;

    const updateStatus = async () => {
      try {
        await setDoc(doc(db, 'ptt_status', auth.currentUser!.uid), {
          userId: auth.currentUser!.uid,
          userName: displayName,
          channelId: currentChannelId,
          status: pttState === 'sending' ? 'sending' : 'idle',
          timestamp: serverTimestamp()
        });
      } catch (error) {
        console.error("Firestore Error: ", JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          operationType: 'write',
          path: `ptt_status/${auth.currentUser?.uid}`,
          authInfo: { userId: auth.currentUser?.uid }
        }));
      }
    };

    updateStatus();
  }, [pttState, isAuthReady, displayName, currentChannelId]);

  useEffect(() => {
    localStorage.setItem('teamwave_display_name', displayName);
  }, [displayName]);

  const handleCreateChannel = async () => {
    if (!newChannelName.trim() || isProcessing || !auth.currentUser) return;
    setIsProcessing(true);
    try {
      const uid = auth.currentUser.uid;
      const channelData = {
        name: newChannelName,
        isPublic: isPublic,
        inviteCode: isPublic ? '' : newChannelCode,
        ownerId: uid,
        createdAt: serverTimestamp(),
        memberCount: 1,
        iconType: ['radio', 'shield', 'heart', 'star', 'zap'][Math.floor(Math.random() * 5)],
        distance: Math.floor(Math.random() * 100)
      };
      const docRef = await addDoc(collection(db, 'channels'), channelData);
      
      // Add membership
      await addDoc(collection(db, 'memberships'), {
        userId: uid,
        channelId: docRef.id,
        channelName: newChannelName,
        joinedAt: serverTimestamp(),
        isOwner: true,
        iconType: channelData.iconType
      });

      const createdChannelName = newChannelName;
      setNewChannelName('');
      setNewChannelCode('');
      setChannelView('list');
      setCurrentChannelId(docRef.id);
      setCurrentGroup(createdChannelName);
      setActiveTab('radio');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'channels');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleJoinChannel = async () => {
    if (!joinCode.trim() || isProcessing || !auth.currentUser) return;
    setIsProcessing(true);
    try {
      const uid = auth.currentUser.uid;
      const q = query(collection(db, 'channels'), where('inviteCode', '==', joinCode));
      const snapshot = await getDocs(q); 
      
      if (!snapshot.empty) {
        const channel = snapshot.docs[0];
        const channelId = channel.id;
        const channelName = channel.data().name;

        // Check if already a member
        const memQ = query(collection(db, 'memberships'), where('userId', '==', uid), where('channelId', '==', channelId));
        const memSnapshot = await getDocs(memQ);

        if (memSnapshot.empty) {
          const channelData = channel.data();
          await addDoc(collection(db, 'memberships'), {
            userId: uid,
            channelId: channelId,
            channelName: channelName,
            joinedAt: serverTimestamp(),
            isOwner: false,
            iconType: channelData.iconType || 'globe'
          });
        }

        const joinedChannelName = channelName;
        setChannelView('list');
        setJoinCode('');
        setCurrentChannelId(channelId);
        setCurrentGroup(joinedChannelName);
        setActiveTab('radio');
      } else {
        alert("유효하지 않은 초대 코드입니다.");
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'channels');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteChannel = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      show: true,
      title: t.channels.delete,
      message: "정말로 이 대화방을 삭제하시겠습니까? 모든 대화 기록이 사라집니다.",
      onConfirm: async () => {
        console.log("Confirming deletion for channel:", channelId);
        try {
          // 1. Delete memberships
          const memQ = query(collection(db, 'memberships'), where('channelId', '==', channelId));
          const memSnapshot = await getDocs(memQ);
          console.log(`Deleting ${memSnapshot.size} memberships`);
          const memDeletePromises = memSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(memDeletePromises);
          
          // 2. Delete PTT logs
          const logQ = query(collection(db, 'channels', channelId, 'logs'));
          const logSnapshot = await getDocs(logQ);
          console.log(`Deleting ${logSnapshot.size} logs`);
          const logDeletePromises = logSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(logDeletePromises);
          
          // 3. Delete channel
          console.log("Deleting channel document");
          await deleteDoc(doc(db, 'channels', channelId));
          
          if (currentChannelId === channelId) {
            setCurrentChannelId(null);
            setCurrentGroup('대화방을 선택하세요');
          }
        } catch (error) {
          console.error("Deletion error:", error);
          handleFirestoreError(error, OperationType.DELETE, `channels/${channelId}`);
        } finally {
          console.log("Closing modal");
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const handleDeleteLog = async (logId: string) => {
    if (!currentChannelId) return;
    try {
      await deleteDoc(doc(db, 'channels', currentChannelId, 'logs', logId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `channels/${currentChannelId}/logs/${logId}`);
    }
  };

  const handleClearHistory = async () => {
    if (!currentChannelId) return;
    setConfirmModal({
      show: true,
      title: t.history.clear,
      message: "현재 대화방의 모든 무전 기록을 삭제하시겠습니까?",
      onConfirm: async () => {
        try {
          const q = query(collection(db, 'channels', currentChannelId, 'logs'));
          const snapshot = await getDocs(q);
          const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deletePromises);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `channels/${currentChannelId}/logs`);
        } finally {
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const handleLeaveChannel = async (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      show: true,
      title: t.channels.leave,
      message: "정말로 이 대화방을 나가시겠습니까?",
      onConfirm: async () => {
        try {
          const memQ = query(collection(db, 'memberships'), where('userId', '==', userId), where('channelId', '==', channelId));
          const memSnapshot = await getDocs(memQ);
          if (!memSnapshot.empty) {
            await deleteDoc(memSnapshot.docs[0].ref);
          }
          
          if (currentChannelId === channelId) {
            setCurrentChannelId(null);
            setCurrentGroup('대화방을 선택하세요');
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `memberships/${channelId}`);
        } finally {
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const handleSendRadio = async (audioBase64?: string) => {
    if (!currentChannelId || !userId) return;
    try {
      const logData = {
        senderId: userId,
        senderName: displayName,
        channelId: currentChannelId,
        timestamp: serverTimestamp(),
        isMannerMode: isMannerMode,
        audioData: audioBase64 || null
      };
      await addDoc(collection(db, 'channels', currentChannelId, 'logs'), logData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `channels/${currentChannelId}/logs`);
    }
  };

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (pttState === 'sending') {
        setPttState('idle');
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.onstop = async () => {
            const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
            const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
              const base64data = reader.result as string;
              handleSendRadio(base64data);
            };
            
            // Stop all tracks
            mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
          };
          mediaRecorderRef.current.stop();
        } else {
          handleSendRadio();
        }

        if (hapticEnabled && navigator.vibrate) navigator.vibrate(30);
      }
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, [pttState, hapticEnabled, currentChannelId, userId, displayName, isMannerMode]);

  const handlePttStart = async (e: React.PointerEvent) => {
    if (isMannerMode || pttState === 'receiving' || pttState === 'replaying') return;
    if (e.cancelable) e.preventDefault();

    // Request permission if not granted
    if (micPermission !== 'granted') {
      const granted = await requestMicPermission();
      if (!granted) {
        alert("무전을 하려면 마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해 주세요.");
        return;
      }
    }

    try {
      if (typeof MediaRecorder === 'undefined') {
        alert("이 브라우저는 무전 기능을 지원하지 않습니다.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setPttState('sending');
      if (hapticEnabled && navigator.vibrate) navigator.vibrate(50);
    } catch (err) {
      console.error("Error starting recording:", err);
    }
  };

  // Auto-play incoming audio
  useEffect(() => {
    if (recentLogs.length > 0 && !isMannerMode) {
      const latestLog = recentLogs[0];
      if (latestLog.id !== lastPlayedLogIdRef.current && latestLog.audioData && latestLog.senderId !== userId) {
        lastPlayedLogIdRef.current = latestLog.id;
        
        // Ensure UI state is receiving
        if (pttState === 'idle') {
          setPttState('receiving');
          setSpeakerName(latestLog.sender);
        }

        const audio = new Audio(latestLog.audioData);
        audio.onended = () => {
          if (pttState === 'receiving') setPttState('idle');
        };
        audio.play().catch(err => {
          console.error("Error playing audio:", err);
          if (pttState === 'receiving') setPttState('idle');
        });
      }
    }
  }, [recentLogs, isMannerMode, userId, pttState]);

  const playLogAudio = (log: LogEntry) => {
    if (!log.audioData || pttState !== 'idle') return;
    
    setPttState('replaying');
    setSpeakerName(log.sender);
    
    const audio = new Audio(log.audioData);
    audio.onended = () => setPttState('idle');
    audio.onerror = (e) => {
      console.error("Audio playback error:", e);
      setPttState('idle');
    };
    audio.play().catch(err => {
      console.error("Play log error:", err);
      setPttState('idle');
    });
  };

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pttState !== 'idle') return;
    
    // Find last log with audio (prefer others, but allow self for testing)
    const lastLogWithAudio = recentLogs.find(log => log.audioData && log.senderId !== userId) || 
                             recentLogs.find(log => log.audioData);
    
    if (!lastLogWithAudio) {
      alert("다시 들을 수 있는 최근 무전이 없습니다.");
      return;
    }

    playLogAudio(lastLogWithAudio);
  };

  // --- 4. 하위 컴포넌트 및 데이터 ---
  const TabButton = ({ id, icon: Icon, label }: { id: TabId, icon: any, label: string }) => (
    <button 
      onClick={() => {
        setActiveTab(id);
        if (id === 'channels') setChannelView('list');
      }} 
      className={`flex flex-col items-center justify-center w-full py-2 transition-colors ${activeTab === id ? (isSending ? 'text-white' : 'text-[#007AFF]') : theme.subText}`}
    >
      <Icon size={24} strokeWidth={activeTab === id ? 2.5 : 2} />
      <span className="text-[10px] font-medium mt-1">{label}</span>
    </button>
  );

  const getTranslatedSound = (sound: string) => {
    switch(sound) {
      case '띠리릭': return t.sounds.beep;
      case '휘슬': return t.sounds.whistle;
      case '벨소리': return t.sounds.ringtone;
      case '디지털': return t.sounds.digital;
      default: return sound;
    }
  };

  const getTranslatedMember = (name: string) => {
    switch(name) {
      case '엄마❤️': return t.members.mom;
      case '행복한 아빠': return t.members.dad;
      case '첫째 아들': return t.members.son;
      case '귀요미 막내': return t.members.baby;
      case '김철수': return t.members.chulsoo;
      case '이영희': return t.members.younghee;
      case '박지민': return t.members.jimin;
      case '최동훈': return t.members.donghoon;
      default: return name;
    }
  };

  const renderIcon = (type: string) => {
    const size = 18;
    switch(type) {
      case 'home': return <Home size={size} />;
      case 'heart': return <Heart size={size} />;
      case 'pin': return <MapPin size={size} />;
      case 'dog': return <Dog size={size} />;
      case 'bike': return <Bike size={size} />;
      case 'ghost': return <Ghost size={size} />;
      case 'shield': return <ShieldCheck size={size} />;
      case 'zap': return <Signal size={size} />;
      case 'star': return <Smartphone size={size} />;
      case 'radio': return <Radio size={size} />;
      case 'globe': return <Globe size={size} />;
      default: return <Radio size={size} />;
    }
  };

  if (!userId) {
    return (
      <div className={`flex flex-col h-screen items-center justify-center p-6 text-center ${darkMode ? 'bg-[#0A0F1E] text-white' : 'bg-[#F2F2F7] text-black'}`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8 max-w-sm w-full"
        >
          <div className="space-y-4">
            <div className="w-24 h-24 bg-[#007AFF] rounded-[24px] mx-auto flex items-center justify-center shadow-2xl shadow-[#007AFF]/30">
              <Radio size={48} className="text-white" />
            </div>
            <h1 className="text-3xl font-black tracking-tight">Walkie-Talkie</h1>
            <p className="text-sm opacity-60 leading-relaxed">
              가족, 연인, 소규모 팀을 위한<br />따뜻한 감성의 실시간 무전기
            </p>
          </div>

          <div className="space-y-3">
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-white text-black rounded-[20px] font-bold shadow-lg flex items-center justify-center gap-3 active:scale-95 transition-all border border-gray-200"
            >
              <Globe size={20} className="text-[#4285F4]" />
              Google로 시작하기
            </button>

            <button 
              onClick={handleAnonymousLogin}
              className="w-full py-4 bg-black/5 dark:bg-white/10 rounded-[20px] font-bold flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all"
            >
              <div className="flex items-center gap-3">
                <User size={20} className="opacity-60" />
                익명으로 시작하기
              </div>
              <span className="text-[10px] opacity-40 font-medium">{t.auth.anonymousNotice}</span>
            </button>
          </div>
          
          <p className="text-[11px] opacity-40">
            로그인 시 서비스 이용약관 및 개인정보 처리방침에 동의하게 됩니다.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div 
      className={`flex flex-col h-screen ${theme.text} ${theme.font} overflow-hidden select-none max-w-md mx-auto relative transition-colors duration-500 border-x border-gray-200 dark:border-white/10 ${darkMode ? 'dark bg-navy-950' : 'bg-[#F2F2F7]'}`}
      style={{ backgroundColor: theme.bgInline }}
    >
      {/* 상단 내비게이션 바 */}
      <div 
        className={`flex-none p-4 pt-12 flex justify-between items-center backdrop-blur-xl border-b ${theme.divider} transition-colors duration-500 z-40`}
        style={{ backgroundColor: isSending ? `${activeSendingColor}E6` : (darkMode ? 'rgba(10, 15, 30, 0.8)' : 'rgba(255,255,255,0.8)') }}
      >
        {activeTab === 'channels' && channelView !== 'list' ? (
          <button onClick={() => setChannelView('list')} className={`${isSending ? 'text-white' : 'text-[#007AFF]'} flex items-center gap-1 transition-colors`}>
            <ChevronLeft size={24} />
            <span className="text-[17px]">{t.channels.list}</span>
          </button>
        ) : (
          <button onClick={() => setShowMembersDrawer(true)} className={`${isSending ? 'text-white' : 'text-[#007AFF]'} flex items-center gap-1 z-50`}>
            <Users size={24} />
          </button>
        )}
        
        <h1 className="text-base font-bold tracking-tight">
          {activeTab === 'settings' ? t.tabs.settings : 
           activeTab === 'channels' ? (channelView === 'create' ? t.channels.create : channelView === 'join' ? t.channels.join : t.channels.explore) : 
           activeTab === 'history' ? t.history.recent : currentGroup}
        </h1>

        <div className="w-12 flex justify-end">
        </div>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth no-scrollbar">
        <AnimatePresence mode="wait">
          {/* --- 1. 무전 화면 --- */}
          {activeTab === 'radio' && (
            <motion.div 
              key="radio"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-3 sm:space-y-4 pb-10"
            >
              {micPermission !== 'granted' && (
                <div className={`p-3 ${theme.radius} ${micPermission === 'denied' ? 'bg-red-500/10 border-red-500/20' : 'bg-[#007AFF]/10 border-[#007AFF]/20'} border flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <MicOff size={16} className={micPermission === 'denied' ? 'text-red-500' : 'text-[#007AFF]'} />
                    <span className="text-[12px] font-bold">{micPermission === 'denied' ? '마이크 권한이 차단되었습니다' : '마이크 권한이 필요합니다'}</span>
                  </div>
                  <button 
                    onClick={requestMicPermission}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold ${micPermission === 'denied' ? 'bg-red-500 text-white' : 'bg-[#007AFF] text-white'}`}
                  >
                    {micPermission === 'denied' ? '설정 방법' : '권한 허용'}
                  </button>
                </div>
              )}

              <div className={`flex-none flex items-center justify-between px-4 py-2.5 ${theme.radius} transition-all shadow-sm border ${isMannerMode ? 'bg-[#007AFF]/10 border-[#007AFF]/20' : 'bg-gray-500/5 border-transparent'}`}>
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg transition-colors ${isMannerMode ? 'bg-[#007AFF] text-white shadow-lg' : 'bg-gray-400 text-white'}`}>
                    {isMannerMode ? <BellOff size={18} /> : <Bell size={18} />}
                  </div>
                  <div className="flex flex-col items-start text-left">
                    <span className={`text-[14px] font-bold transition-colors ${isMannerMode ? 'text-[#007AFF]' : 'text-gray-500'}`}>{t.radio.mannerMode}</span>
                    <span className="text-[9px] opacity-60 font-medium">{t.radio.mannerDesc}</span>
                  </div>
                </div>
                <button onClick={() => setIsMannerMode(!isMannerMode)} className={`w-12 h-7 rounded-full transition-all relative ${isMannerMode ? 'bg-[#007AFF]' : 'bg-gray-300'}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow-md absolute top-1 transition-transform ${isMannerMode ? 'translate-x-6' : 'translate-x-1'}`}></div>
                </button>
              </div>

              <div className={`flex-none ${theme.itemBg} ${theme.radius} p-4 sm:p-5 shadow-sm border ${theme.divider} relative overflow-hidden transition-all duration-500`}>
                <div className="flex justify-between items-center mb-4 sm:mb-5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full transition-colors ${isMannerMode ? 'bg-[#007AFF] shadow-[0_0_8px_#007AFF]' : 'bg-[#34C759] shadow-[0_0_8px_#34C759]'}`}></div>
                    <span className="text-[15px] sm:text-[17px] font-bold tracking-tight">
                      {isMannerMode ? `${t.radio.mannerMode} 🌙` : pttState === 'idle' ? t.radio.waiting : ""}
                      {!isMannerMode && isSending && t.radio.talking}
                      {!isMannerMode && pttState === 'receiving' && `${speakerName}${t.radio.isTalking}`}
                      {isMannerMode && pttState === 'receiving' && t.radio.receiving}
                      {pttState === 'replaying' && t.radio.replaying}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isMannerMode ? 'bg-[#007AFF] shadow-[0_0_8px_#007AFF]' : 'bg-[#34C759] shadow-[0_0_8px_#34C759]'}`}></div>
                    <span className={`text-[10px] font-bold ${isMannerMode ? 'text-[#007AFF]' : 'text-[#34C759]'}`}>{isMannerMode ? t.radio.silent : t.radio.live}</span>
                  </div>
                </div>

                <div className={`${isSending ? 'bg-white/10' : (darkMode ? 'bg-black/40' : 'bg-[#F2F2F7]')} ${theme.radius} h-8 sm:h-10 flex items-center justify-center gap-1 overflow-hidden px-4 transition-colors duration-500`}>
                  {[...Array(20)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`w-1 rounded-full transition-all duration-300 ${pttState !== 'idle' ? 'animate-wave' : ''} ${pttState !== 'idle' ? (isSending ? 'bg-white' : (isMannerMode ? 'bg-[#007AFF]' : '#007AFF')) : theme.subText}`}
                      style={{ 
                        height: pttState !== 'idle' ? `${30 + Math.random() * 50}%` : '10%', 
                        opacity: pttState !== 'idle' ? 1 : 0.2,
                        animationDelay: `${i * 0.05}s`,
                        backgroundColor: pttState !== 'idle' ? (isSending ? '#FFFFFF' : (isMannerMode ? '#8E8E93' : '#007AFF')) : '' 
                      }} 
                    />
                  ))}
                </div>
              </div>

              <div className="flex-none grid grid-cols-2 gap-2 sm:gap-3">
                <div onClick={() => setShowMembersDrawer(true)} className={`${theme.itemBg} p-3 sm:p-4 ${theme.radius} border ${theme.divider} shadow-sm cursor-pointer active:scale-95 transition-all duration-500 text-left`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Users size={14} className={`${isSending ? 'text-white' : 'text-[#007AFF]'}`} />
                    <span className={`${theme.subText} text-[9px] sm:text-[10px] font-bold uppercase`}>{t.radio.people}</span>
                  </div>
                  <span className="text-base sm:text-lg font-bold">{getChannelMemberCount(currentChannelId || '')}{t.radio.onlineCount}</span>
                </div>
                <div className={`${theme.itemBg} p-3 sm:p-4 ${theme.radius} border ${theme.divider} shadow-sm transition-all duration-500 text-left`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Signal size={14} className={`${isSending ? 'text-white' : 'text-[#AF52DE]'}`} />
                    <span className={`${theme.subText} text-[9px] sm:text-[10px] font-bold uppercase`}>{t.radio.signal}</span>
                  </div>
                  <span className="text-base sm:text-lg font-bold">{t.radio.excellent}</span>
                </div>
              </div>

              <div className="flex-none flex flex-col items-center justify-center gap-3 relative z-10 min-h-0 py-1">
                <div className="relative pointer-events-auto w-full px-8">
                  <div className={`absolute inset-0 ${theme.radius} blur-3xl transition-all duration-500 ${isSending ? 'bg-white/30 scale-110' : isMannerMode ? 'bg-[#007AFF]/10' : 'bg-transparent'}`}></div>
                  <button 
                    onPointerDown={handlePttStart} 
                    onContextMenu={(e) => e.preventDefault()} 
                    style={{ touchAction: 'none' }}
                    className={`w-full h-24 sm:h-32 ${theme.radius} flex flex-col items-center justify-center transition-all duration-200 shadow-2xl touch-none border-[6px] sm:border-[8px] outline-none select-none relative z-20
                      ${isMannerMode ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60 scale-95 shadow-none cursor-not-allowed' : 
                        isSending ? 'bg-white border-white/20 scale-[0.98] shadow-inner' :
                        (pttState === 'receiving' || pttState === 'replaying') ? 'bg-[#8E8E93] border-black/5 opacity-60 cursor-not-allowed' : 
                        'bg-white border-white/10 dark:bg-[#2C2C2E] active:scale-95 cursor-pointer'}
                    `}
                  >
                    <div className="flex items-center gap-4">
                      {isMannerMode ? <MicOff size={32} className="text-[#007AFF] opacity-40" /> : <Mic size={36} style={{ color: isSending ? activeSendingColor : (pttState === 'idle' ? '#007AFF' : '#FFFFFF') }} fill={(pttState === 'idle' || isSending) ? 'none' : 'currentColor'} />}
                      <span className={`font-black text-xl sm:text-2xl tracking-[0.1em]`} style={{ color: isMannerMode ? '#007AFF' : isSending ? activeSendingColor : (pttState === 'idle' ? (darkMode ? '#FFFFFF' : '#000000') : '#FFFFFF') }}>
                        {isMannerMode ? t.radio.silent : t.radio.ptt}
                      </span>
                    </div>
                  </button>
                </div>

                <div className="flex flex-col items-center gap-4">
                  <button onClick={handleReplay} disabled={pttState !== 'idle'} className={`flex items-center gap-2 px-8 py-3 ${theme.radius} border shadow-sm transition-all active:scale-95 ${isSending ? 'border-white/40 text-white bg-white/10' : 'border-gray-300 dark:border-white/20 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-30'}`}>
                    <Play size={14} fill="currentColor" className={isSending ? 'text-white' : 'text-[#007AFF]'} />
                    <span className="text-[15px] font-bold tracking-tight">{t.radio.replay}</span>
                  </button>
                  <div className="opacity-20 text-[10px] font-bold tracking-widest uppercase">v1.0.5</div>
                </div>
              </div>
            </motion.div>
          )}

          {/* --- 2. 대화방 탭 --- */}
          {activeTab === 'channels' && (
            <motion.div 
              key="channels"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8 pb-10"
            >
              {channelView === 'list' && (
                <>
                  {/* 방 만들기 섹션 */}
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setChannelView('create')} className={`flex items-center gap-3 p-4 ${theme.radius} ${theme.itemBg} border ${theme.divider} active:opacity-60 transition-all shadow-sm text-left`}>
                      <PlusCircle size={24} className={isSending ? 'text-white' : 'text-[#007AFF]'} />
                      <span className="text-[15px] font-bold">{t.channels.create}</span>
                    </button>
                    <button onClick={() => setChannelView('join')} className={`flex items-center gap-3 p-4 ${theme.radius} ${theme.itemBg} border ${theme.divider} active:opacity-60 transition-all shadow-sm text-left`}>
                      <LogIn size={24} className={isSending ? 'text-white' : 'text-[#5856D6]'} />
                      <span className="text-[15px] font-bold">{t.channels.join}</span>
                    </button>
                  </div>

                  {/* 현재 참여중인 대화방 */}
                  <div className="space-y-2 text-left">
                    <h3 className={`${theme.subText} text-[13px] font-semibold uppercase tracking-tight ml-4`}>{t.channels.sectionCurrent}</h3>
                    <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                      {myChannels.filter(c => c.id === currentChannelId).length > 0 ? (
                        myChannels.filter(c => c.id === currentChannelId).map((chan) => (
                          <div key={chan.id} className={`p-4 flex justify-between items-center transition-all border-t first:border-t-0 ${theme.divider} bg-[#007AFF]/5`}>
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 rounded-xl bg-[#007AFF] text-white">{renderIcon(chan.iconType)}</div>
                              <div className="flex flex-col">
                                <span className="font-bold text-[16px] block">{chan.name}</span>
                                <span className="text-[11px] text-[#007AFF] font-bold uppercase tracking-widest">ACTIVE</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={(e) => chan.isOwner ? handleDeleteChannel(chan.id, e) : handleLeaveChannel(chan.id, e)}
                                className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                                title={chan.isOwner ? t.channels.delete : t.channels.leave}
                              >
                                {chan.isOwner ? <Trash2 size={18} /> : <LogOut size={18} />}
                              </button>
                              <button onClick={() => setActiveTab('radio')} className={`px-4 py-1.5 ${theme.radius} font-bold text-[12px] bg-[#007AFF] text-white active:scale-95 transition-transform`}>{t.channels.enter}</button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-8 text-center opacity-40 text-[14px]">{t.channels.noJoined}</div>
                      )}
                    </div>
                  </div>

                  {/* 참여했던 대화방 목록 */}
                  <div className="space-y-2 text-left">
                    <button 
                      onClick={() => setCollapsedSections(prev => ({ ...prev, previous: !prev.previous }))}
                      className="flex items-center justify-between w-full px-4 py-1"
                    >
                      <h3 className={`${theme.subText} text-[13px] font-semibold uppercase tracking-tight`}>{t.channels.sectionPrevious}</h3>
                      <ChevronDown size={16} className={`${theme.subText} transition-transform ${collapsedSections.previous ? '-rotate-90' : ''}`} />
                    </button>
                    {!collapsedSections.previous && (
                      <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                        {myChannels.filter(c => c.id !== currentChannelId).length > 0 ? (
                          myChannels.filter(c => c.id !== currentChannelId).map((chan) => (
                            <div key={chan.id} onClick={() => {setCurrentChannelId(chan.id); setCurrentGroup(chan.name); setActiveTab('radio');}} className={`p-4 flex justify-between items-center transition-all cursor-pointer border-t first:border-t-0 ${theme.divider} ${isSending ? 'active:bg-white/10' : 'active:bg-gray-100 dark:active:bg-white/5'}`}>
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-white/5 text-gray-500">{renderIcon(chan.iconType)}</div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-[16px] block">{chan.name}</span>
                                  <span className="text-[11px] opacity-60">{t.channels.myRoom}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => chan.isOwner ? handleDeleteChannel(chan.id, e) : handleLeaveChannel(chan.id, e)}
                                  className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                                  title={chan.isOwner ? t.channels.delete : t.channels.leave}
                                >
                                  {chan.isOwner ? <Trash2 size={18} /> : <LogOut size={18} />}
                                </button>
                                <button onClick={(e) => {e.stopPropagation(); setCurrentChannelId(chan.id); setCurrentGroup(chan.name); setActiveTab('radio');}} className={`px-4 py-1.5 ${theme.radius} font-bold text-[12px] bg-gray-200 dark:bg-white/10 text-black dark:text-white active:scale-95 transition-transform`}>{t.channels.enter}</button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-6 text-center opacity-30 text-[13px]">기록이 없습니다.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 로컬 대화방 목록 */}
                  <div className="space-y-2 text-left">
                    <button 
                      onClick={() => setCollapsedSections(prev => ({ ...prev, local: !prev.local }))}
                      className="flex items-center justify-between w-full px-4 py-1"
                    >
                      <h3 className={`${theme.subText} text-[13px] font-semibold uppercase tracking-tight`}>{t.channels.sectionLocal}</h3>
                      <ChevronDown size={16} className={`${theme.subText} transition-transform ${collapsedSections.local ? '-rotate-90' : ''}`} />
                    </button>
                    {!collapsedSections.local && (
                      <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                        {publicChannels.filter(c => (c.distance || 0) < 50).length > 0 ? (
                          publicChannels.filter(c => (c.distance || 0) < 50).map((chan) => (
                            <div key={chan.id} onClick={() => {setCurrentChannelId(chan.id); setCurrentGroup(chan.name); setActiveTab('radio');}} className={`p-4 flex justify-between items-center transition-all cursor-pointer border-t first:border-t-0 ${theme.divider} ${isSending ? 'active:bg-white/10' : 'active:bg-gray-100 dark:active:bg-white/5'}`}>
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-green-500/10 text-green-500">{renderIcon(chan.iconType)}</div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-[16px] block">{chan.name}</span>
                                  <span className="text-[11px] text-green-500 font-medium">{chan.distance}km {t.channels.members}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {chan.isOwner && (
                                  <button 
                                    onClick={(e) => handleDeleteChannel(chan.id, e)}
                                    className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                )}
                                <button onClick={(e) => {e.stopPropagation(); setCurrentChannelId(chan.id); setCurrentGroup(chan.name); setActiveTab('radio');}} className={`px-4 py-1.5 ${theme.radius} font-bold text-[12px] bg-[#34C759] text-white active:scale-95 transition-transform`}>{t.channels.enter}</button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-6 text-center opacity-30 text-[13px]">주변에 대화방이 없습니다.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 공개 대화방 목록 */}
                  <div className="space-y-2 text-left">
                    <button 
                      onClick={() => setCollapsedSections(prev => ({ ...prev, public: !prev.public }))}
                      className="flex items-center justify-between w-full px-4 py-1"
                    >
                      <h3 className={`${theme.subText} text-[13px] font-semibold uppercase tracking-tight`}>{t.channels.sectionPublic}</h3>
                      <ChevronDown size={16} className={`${theme.subText} transition-transform ${collapsedSections.public ? '-rotate-90' : ''}`} />
                    </button>
                    {!collapsedSections.public && (
                      <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                        {publicChannels.filter(c => (c.distance || 0) >= 50).length > 0 ? (
                          publicChannels.filter(c => (c.distance || 0) >= 50).map((chan) => (
                            <div key={chan.id} onClick={() => {setCurrentChannelId(chan.id); setCurrentGroup(chan.name); setActiveTab('radio');}} className={`p-4 flex justify-between items-center transition-all cursor-pointer border-t first:border-t-0 ${theme.divider} ${isSending ? 'active:bg-white/10' : 'active:bg-gray-100 dark:active:bg-white/5'}`}>
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">{renderIcon(chan.iconType)}</div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-[16px] block">{chan.name}</span>
                                  <span className="text-[11px] text-blue-500 font-medium">{chan.distance}km {t.channels.members}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {chan.isOwner && (
                                  <button 
                                    onClick={(e) => handleDeleteChannel(chan.id, e)}
                                    className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                )}
                                <button onClick={(e) => {e.stopPropagation(); setCurrentChannelId(chan.id); setCurrentGroup(chan.name); setActiveTab('radio');}} className={`px-4 py-1.5 ${theme.radius} font-bold text-[12px] bg-[#007AFF] text-white active:scale-95 transition-transform`}>{t.channels.enter}</button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-6 text-center opacity-30 text-[13px]">공개된 대화방이 없습니다.</div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {channelView === 'create' && (
                <div className="space-y-6 text-left">
                  <div className="space-y-1">
                    <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase`}>{t.channels.info}</h3>
                    <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                      <div className="p-4">
                        <input 
                          type="text"
                          value={newChannelName} 
                          onChange={(e) => setNewChannelName(e.target.value)} 
                          placeholder={t.channels.name} 
                          className="w-full bg-transparent text-[17px] focus:outline-none" 
                          autoFocus 
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase`}>{t.channels.privacy}</h3>
                    <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                      <div onClick={() => setIsPublic(true)} className="p-4 flex items-center justify-between cursor-pointer active:bg-gray-100 dark:active:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg bg-[#34C759] text-white`}><Eye size={18} /></div>
                          <div>
                            <p className="font-semibold text-[15px]">{t.channels.public}</p>
                            <p className="text-[12px] text-[#8E8E93]">{t.channels.publicDesc}</p>
                          </div>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isPublic ? 'border-[#007AFF] bg-[#007AFF]' : 'border-gray-400'}`}>
                          {isPublic && <div className="w-2 h-2 rounded-full bg-white"></div>}
                        </div>
                      </div>
                      <div onClick={() => setIsPublic(false)} className="p-4 flex items-center justify-between border-t ${theme.divider} cursor-pointer active:bg-gray-100 dark:active:bg-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg bg-[#5856D6] text-white`}><EyeOff size={18} /></div>
                          <div>
                            <p className="font-semibold text-[15px]">{t.channels.private}</p>
                            <p className="text-[12px] text-[#8E8E93]">{t.channels.privateDesc}</p>
                          </div>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${!isPublic ? 'border-[#007AFF] bg-[#007AFF]' : 'border-gray-400'}`}>
                          {!isPublic && <div className="w-2 h-2 rounded-full bg-white"></div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {!isPublic && (
                    <div className="mt-4">
                      <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase`}>{t.channels.setCode}</h3>
                      <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                        <div className="p-4 flex items-center gap-3">
                          <Hash size={18} className="text-[#007AFF]" />
                          <input 
                            type="text"
                            value={newChannelCode} 
                            onChange={(e) => setNewChannelCode(e.target.value.toUpperCase())} 
                            placeholder={t.channels.enterCode}
                            className="w-full bg-transparent text-[17px] font-mono tracking-widest focus:outline-none" 
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <button 
                    disabled={!newChannelName || (!isPublic && !newChannelCode) || isProcessing}
                    onClick={handleCreateChannel}
                    className={`w-full py-4 ${theme.radius} font-bold text-[17px] shadow-sm transition-all active:scale-[0.98] ${newChannelName && (isPublic || newChannelCode) && !isProcessing ? 'bg-[#007AFF] text-white' : 'bg-gray-400/30 text-gray-500 cursor-not-allowed'}`}
                  >
                    {isProcessing ? '처리 중...' : t.channels.done}
                  </button>
                </div>
              )}

              {channelView === 'join' && (
                <div className="space-y-6 text-left">
                  <div className="space-y-1">
                    <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase`}>{t.channels.enterJoinCode}</h3>
                    <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                      <div className="p-4">
                        <input 
                          type="text" 
                          value={joinCode} 
                          onChange={(e) => setJoinCode(e.target.value.toUpperCase())} 
                          placeholder={t.channels.receivedCode} 
                          className="w-full bg-transparent text-[17px] font-mono tracking-widest focus:outline-none" 
                          autoFocus 
                        />
                      </div>
                    </div>
                  </div>
                  <button 
                    disabled={joinCode.length < 4 || isProcessing} 
                    onClick={handleJoinChannel} 
                    className={`w-full py-4 ${theme.radius} font-bold text-[17px] shadow-sm transition-all active:scale-[0.98] ${joinCode.length >= 4 && !isProcessing ? 'bg-[#007AFF] text-white' : 'bg-gray-400/30 text-gray-500 cursor-not-allowed'}`}
                  >
                    {isProcessing ? '처리 중...' : t.channels.joinBtn}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* --- 3. 기록 탭 --- */}
          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 pb-10"
            >
              <div className="flex justify-between items-center px-2">
                <h3 className={`${theme.subText} text-[13px] font-semibold uppercase tracking-tight`}>{t.history.recent}</h3>
                <button 
                  onClick={handleClearHistory}
                  className="text-[12px] font-bold text-[#007AFF] opacity-80 active:opacity-100 hover:bg-[#007AFF]/10 px-2 py-1 rounded-md transition-all"
                >
                  {t.history.clear}
                </button>
              </div>
              <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                {recentLogs.map((log, i) => (
                  <div key={i} className={`p-4 flex items-center gap-4 border-t first:border-t-0 ${theme.divider} ${isSending ? 'active:bg-white/10' : 'active:bg-gray-100 dark:active:bg-white/5'}`}>
                    <div className={`w-12 h-12 rounded-full ${isSending ? 'bg-white/20 text-white' : (darkMode ? 'bg-white/5 text-[#007AFF]' : 'bg-gray-100 text-[#007AFF]')} flex items-center justify-center text-xl transition-colors shadow-sm`}>{log.icon}</div>
                    <div className="flex-1 text-left">
                      <div className="flex justify-between items-center mb-0.5">
                        <h4 className="font-bold text-[16px] flex items-center gap-1.5">
                          {log.sender} 
                          {log.manner && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#007AFF]/10 text-[#007AFF] text-[9px] font-bold uppercase tracking-tight">
                              <BellOff size={10} />
                              {t.history.manner}
                            </span>
                          )}
                        </h4>
                        <span className="text-[11px] opacity-40 font-medium">{log.time}</span>
                      </div>
                      <div className="flex items-center gap-1.5 opacity-60">
                        <span className="text-[12px] font-medium truncate max-w-[180px]">{log.room}</span>
                        <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                        <span className={`text-[11px] font-bold ${log.manner ? 'text-[#007AFF]' : 'text-[#34C759]'}`}>
                          {log.manner ? t.history.missed : t.history.received}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => playLogAudio(log)}
                        disabled={!log.audioData || pttState !== 'idle'}
                        className={`p-2 transition-all ${!log.audioData ? 'opacity-10' : 'opacity-40 hover:opacity-100 active:scale-90'}`}
                      >
                        <Volume2 size={18} className={log.audioData ? 'text-[#007AFF]' : ''} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteLog(log.id); }}
                        className="p-2 text-red-500 opacity-40 hover:opacity-100 hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* --- 4. 설정 탭 --- */}
          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 pb-10 text-left"
            >
              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.profile}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                  <div className="p-4 flex items-center gap-5">
                    <div className="relative group cursor-pointer">
                      <div className={`w-16 h-16 rounded-full border ${theme.divider} flex items-center justify-center ${isSending ? 'text-white' : 'text-[#007AFF]'} transition-colors`}><User size={32} /></div>
                      <div className={`absolute -bottom-1 -right-1 w-7 h-7 ${isSending ? 'bg-white text-[#FF3B30]' : 'bg-[#007AFF] text-white'} rounded-full border-4 ${isSending ? 'border-[#FF3B30]' : (darkMode ? 'border-[#1C1C1E]' : 'border-white')} flex items-center justify-center shadow-sm`}><Camera size={12} fill="currentColor" /></div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <label className="text-[11px] font-bold opacity-40 uppercase block mb-0.5">{t.settings.userId}</label>
                        <div className="text-sm font-mono opacity-60 bg-black/5 dark:bg-white/5 py-1 px-2 rounded inline-block">{userId}</div>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold opacity-40 uppercase block mb-0.5">{t.settings.displayName}</label>
                        <div className="w-full bg-transparent text-xl font-bold py-1">{displayName}</div>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 border-t border-gray-100 dark:border-white/5">
                    <button 
                      onClick={handleLogout}
                      className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm active:scale-95 transition-all"
                    >
                      로그아웃
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.personalization}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider} transition-all`}>
                  <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <Palette size={18} className={isSending ? 'text-white' : 'text-[#007AFF]'} />
                        <span className="font-medium text-[15px]">{t.settings.theme}</span>
                      </div>
                      <span className="text-[10px] opacity-40 font-bold">{t.settings.previewTheme}</span>
                    </div>
                    <div className="flex justify-between items-center px-2">
                      {(Object.keys(themeColors) as Array<keyof typeof themeColors>).map((t) => (
                        <button 
                          key={t} 
                          onPointerDown={() => {
                            setSendingTheme(t);
                            setPttState('sending');
                          }}
                          onPointerUp={() => setPttState('idle')}
                          onPointerLeave={() => {
                            if (pttState === 'sending') setPttState('idle');
                          }}
                          onClick={() => setSendingTheme(t)} 
                          className={`relative w-9 h-9 rounded-full border-2 transition-all active:scale-90 flex items-center justify-center ${sendingTheme === t ? (isSending ? 'border-white' : 'border-[#007AFF]') : 'border-transparent'}`} 
                          style={{ backgroundColor: themeColors[t] }}
                        >
                          {sendingTheme === t && <Check size={18} className="text-white" strokeWidth={3} />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.skin}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                  <div className="grid grid-cols-2 gap-px bg-gray-400/10">
                    {(Object.entries(skins) as [SkinId, typeof skins['general']][]).map(([id, config]) => {
                      const skinName = id === 'general' ? t.skins.general : id === 'kids' ? t.skins.kids : id === 'military' ? t.skins.military : t.skins.lovely;
                      return (
                        <button 
                          key={id}
                          onClick={() => setSkin(id)}
                          className={`p-4 flex flex-col items-center gap-2 ${theme.itemBg} active:opacity-60 transition-all ${skin === id ? 'ring-2 ring-inset ring-[#007AFF]/30' : ''}`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center`} style={{ backgroundColor: `${config.color}20`, color: config.color }}>
                            <config.icon size={24} />
                          </div>
                          <span className={`text-[13px] font-bold ${skin === id ? 'text-[#007AFF]' : ''}`}>{skinName}</span>
                          {skin === id && <div className="w-1.5 h-1.5 rounded-full bg-[#007AFF]"></div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.system}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider} transition-all`}>
                  <div className="p-3 pl-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg ${isSending ? 'bg-white text-[#FF3B30]' : (darkMode ? 'bg-[#5856D6]' : 'bg-[#FF9500]')} text-white`}>
                        {darkMode ? <Moon size={18} /> : <Sun size={18} />}
                      </div>
                      <span className="font-medium text-[15px]">{t.settings.darkMode}</span>
                    </div>
                    <button onClick={() => setDarkMode(!darkMode)} className={`w-12 h-7 rounded-full transition-colors relative ${darkMode || isSending ? 'bg-[#34C759]' : 'bg-gray-300'}`}>
                      <div className={`w-6 h-6 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${darkMode || isSending ? 'translate-x-5.5' : 'translate-x-0.5'}`}></div>
                    </button>
                  </div>
                  <div className={`p-4 pl-4 space-y-3 border-t ${theme.divider}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg ${isSending ? 'bg-white text-[#FF3B30]' : 'bg-[#007AFF]'} text-white`}>
                        <Bell size={18} />
                      </div>
                      <span className="font-medium text-[15px]">{t.settings.volume}</span>
                      <span className="ml-auto text-sm opacity-60 font-bold">{beepVolume}%</span>
                    </div>
                    <input 
                      type="range" 
                      value={beepVolume} 
                      onChange={(e) => setBeepVolume(parseInt(e.target.value))} 
                      className={`w-full h-1 ${isSending ? 'accent-white' : 'accent-[#007AFF]'}`} 
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.language}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg ${isSending ? 'bg-white text-[#FF3B30]' : 'bg-[#5856D6]'} text-white`}>
                        <Languages size={18} />
                      </div>
                      <span className="font-medium text-[15px]">{t.settings.selectLanguage}</span>
                    </div>
                    <select 
                      value={language} 
                      onChange={(e) => setLanguage(e.target.value as Language)}
                      className={`bg-transparent font-bold text-[15px] focus:outline-none cursor-pointer ${isSending ? 'text-white' : 'text-[#007AFF]'}`}
                    >
                      <option value="ko">한국어</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.sound}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                  {['띠리릭', '휘슬', '벨소리', '디지털'].map((sound) => (
                    <button 
                      key={sound}
                      onClick={() => setBeepSound(sound)}
                      className={`w-full p-4 flex items-center justify-between border-t first:border-t-0 ${theme.divider} active:opacity-60 transition-opacity`}
                    >
                      <span className="font-medium text-[15px]">{getTranslatedSound(sound)}</span>
                      {beepSound === sound && <Check size={18} className={isSending ? 'text-white' : 'text-[#007AFF]'} strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <h3 className={`${theme.subText} text-[13px] font-semibold mb-1 ml-4 uppercase tracking-tight`}>{t.settings.help}</h3>
                <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                  <button 
                    onClick={() => setShowGuide(true)}
                    className="w-full p-4 flex items-center justify-between active:opacity-60 transition-opacity"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg ${isSending ? 'bg-white text-[#FF3B30]' : 'bg-[#5856D6]'} text-white`}>
                        <HelpCircle size={18} />
                      </div>
                      <span className="font-medium text-[15px]">{t.settings.guide}</span>
                    </div>
                    <ChevronRight size={18} className="opacity-40" />
                  </button>
                </div>
              </div>

              <div className="py-8 text-center opacity-30">
                <p className="text-[11px] font-bold tracking-widest uppercase">TeamWave v1.0.6</p>
                <p className="text-[9px] mt-1">© 2026 TeamWave. All rights reserved.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 하단 플로팅 메뉴 */}
      <div className="flex-none h-32 relative flex justify-center items-start pt-4 px-4 z-40">
        <div className={`w-full h-20 px-2 flex justify-around items-center backdrop-blur-2xl border ${theme.radius} shadow-[0_8px_32px_rgba(0,0,0,0.15)] transition-all duration-500 ${isSending ? 'bg-white/10 border-white/20' : 'bg-white/70 dark:bg-navy-900/80 border-white/20 dark:border-white/10'}`}>
          <TabButton id="radio" icon={Mic} label={t.tabs.radio} />
          <TabButton id="channels" icon={Globe} label={t.tabs.channels} />
          <TabButton id="history" icon={History} label={t.tabs.history} />
          <TabButton id="settings" icon={Settings} label={t.tabs.settings} />
        </div>
      </div>

      {/* 확인 모달 */}
      <AnimatePresence>
        {confirmModal.show && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-[320px] ${darkMode ? 'bg-[#1C1C1E]' : 'bg-white'} rounded-[24px] shadow-2xl overflow-hidden border ${theme.divider}`}
            >
              <div className="p-6 text-center space-y-3">
                <h3 className="text-lg font-bold tracking-tight">{confirmModal.title}</h3>
                <p className={`text-[14px] leading-relaxed opacity-60 font-medium`}>{confirmModal.message}</p>
              </div>
              <div className="flex border-t border-gray-400/10">
                <button 
                  onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                  className={`flex-1 py-4 text-[16px] font-medium border-r border-gray-400/10 active:bg-gray-100 dark:active:bg-white/5 transition-colors`}
                >
                  취소
                </button>
                <button 
                  onClick={() => {
                    console.log("Confirm button clicked");
                    confirmModal.onConfirm();
                  }}
                  className={`flex-1 py-4 text-[16px] font-bold text-red-500 active:bg-gray-100 dark:active:bg-white/5 transition-colors`}
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 가이드 모달 */}
      <AnimatePresence>
        {showGuide && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowGuide(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-sm ${darkMode ? 'bg-navy-900' : 'bg-[#F2F2F7]'} ${theme.radius} shadow-2xl overflow-hidden border ${theme.divider}`}
            >
              <div className="p-6 border-b border-gray-400/10 flex justify-between items-center">
                <h2 className="text-xl font-extrabold tracking-tight">{t.settings.guide}</h2>
                <button onClick={() => setShowGuide(false)} className="p-2 rounded-full bg-gray-400/10"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                {[
                  { title: t.guide.step1Title, content: t.guide.step1Desc },
                  { title: t.guide.step2Title, content: t.guide.step2Desc },
                  { title: t.guide.step3Title, content: t.guide.step3Desc },
                  { title: t.guide.tipTitle, content: `${t.guide.tip1} ${t.guide.tip2}` },
                ].map((item, i) => (
                  <div key={i} className="space-y-2">
                    <h4 className="font-bold text-[#007AFF] flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#007AFF]/10 flex items-center justify-center text-[11px]">{i + 1}</span>
                      {item.title}
                    </h4>
                    <p className="text-[14px] opacity-70 leading-relaxed font-medium pl-7">{item.content}</p>
                  </div>
                ))}
              </div>
              <div className="p-6 pt-0">
                <button 
                  onClick={() => setShowGuide(false)}
                  className="w-full py-4 bg-[#007AFF] text-white rounded-2xl font-bold active:scale-95 transition-transform"
                >
                  {t.guide.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 멤버 드로어 */}
      <AnimatePresence>
        {showMembersDrawer && (
          <div className="fixed inset-0 z-[100]">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMembersDrawer(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`absolute left-0 top-0 bottom-0 w-[82%] ${isSending ? 'bg-[#FF3B30]' : (darkMode ? 'bg-navy-900' : 'bg-[#F2F2F7]')} flex flex-col shadow-2xl z-[110] overflow-hidden`}
              style={{ backgroundColor: theme.bgInline }}
            >
              <div className={`p-6 pt-14 flex justify-between items-center border-b ${isSending ? 'border-white/20 text-white' : 'border-gray-400/20'}`}>
                <h2 className="text-xl font-extrabold tracking-tight">{t.channels.members}</h2>
                <button onClick={() => setShowMembersDrawer(false)} className={`${isSending ? 'text-white' : 'text-[#007AFF]'} font-bold outline-none`}>{t.guide.close}</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6 text-left no-scrollbar">
                <div className="space-y-2">
                  <h3 className={`${theme.subText} text-[13px] font-semibold mb-2 ml-4 uppercase`}>{t.channels.online} ({roomOnlineMembers.length})</h3>
                  <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider}`}>
                    {roomOnlineMembers.map(member => (
                      <div key={member.id} className={`p-4 flex justify-between items-center border-t first:border-t-0 ${theme.divider}`}>
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{member.icon}</div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold">{getTranslatedMember(member.name)}</p>
                              {member.userId && <span className="text-[10px] font-mono opacity-40">@{member.userId}</span>}
                            </div>
                            <p className={`text-[12px] opacity-60 font-bold ${member.manner ? 'text-[#007AFF]' : 'text-[#34C759]'}`}>{member.manner ? t.radio.mannerMode : t.channels.online}</p>
                          </div>
                        </div>
                        <div className={`w-2.5 h-2.5 rounded-full ${member.manner ? 'bg-[#007AFF]' : (isSending ? 'bg-white' : 'bg-[#34C759]')}`}></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className={`${theme.subText} text-[13px] font-semibold mb-2 ml-4 uppercase`}>{t.channels.offline} ({offlineMembers.length})</h3>
                  <div className={`${theme.itemBg} ${theme.radius} overflow-hidden border ${theme.divider} opacity-60`}>
                    {offlineMembers.map(member => (
                      <div key={member.id} className={`p-4 flex items-center gap-4 border-t first:border-t-0 ${theme.divider}`}>
                        <div className="text-2xl grayscale">{member.icon}</div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-bold">{getTranslatedMember(member.name)}</p>
                            {member.userId && <span className="text-[10px] font-mono opacity-40">@{member.userId}</span>}
                          </div>
                          <p className="text-[12px] opacity-60 font-bold">{t.channels.offline}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
