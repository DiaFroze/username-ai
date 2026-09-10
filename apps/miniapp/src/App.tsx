import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckerResult,
  CheckStatus,
  TelegramUser,
  Platform,
  SupportedTld,
  SUPPORTED_TLDS,
  MultiCheckResponse,
  NamingIntent,
  ScoredCandidate,
  NamingPipelineResponse,
  WatchlistItem,
} from '@username/shared';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: TelegramUser;
        };
        ready: () => void;
        expand: () => void;
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
        };
      };
    };
  }
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:4000';

/* --- Minimalist SVG Icons --- */
const Icons = {
  Sparkles: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
    </svg>
  ),
  Search: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  ),
  Bell: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
    </svg>
  ),
  Telegram: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  ),
  YouTube: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  ),
  Globe: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
    </svg>
  ),
  Copy: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
    </svg>
  ),
  Check: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  Trash: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>
  ),
  Refresh: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  ),
  ChevronUp: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6"/>
    </svg>
  ),
  Sliders: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>
    </svg>
  ),
};

const INTENTS: { id: NamingIntent; label: string }[] = [
  { id: 'BRAND', label: 'Бренд' },
  { id: 'BUSINESS', label: 'Бизнес' },
  { id: 'PROJECT', label: 'Проект' },
  { id: 'PERSONAL', label: 'Личный' },
  { id: 'CREATIVE', label: 'Креативный' },
  { id: 'AUTO', label: 'AI Свободный' },
];

const CATEGORIES = [
  'Tech & AI',
  'Fintech & Web3',
  'Coffee & Food',
  'Design & Creative',
  'Fashion & Beauty',
  'Education',
  'Gaming',
  'Media & Blog',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'generate' | 'check' | 'watchlist'>('generate');

  // AI Generator state
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState<NamingIntent>('BRAND');
  const [category, setCategory] = useState<string>('Tech & AI');
  const [oneNameEverywhere, setOneNameEverywhere] = useState(true);
  const [candidateCount, setCandidateCount] = useState(10);
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([]);
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({});
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Single-check state
  const [checkUsername, setCheckUsername] = useState('');
  const [singleResults, setSingleResults] = useState<CheckerResult[]>([]);

  // Watchlist state
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [trackedMap, setTrackedMap] = useState<Record<string, boolean>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Platforms state
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    Platform.TELEGRAM,
    Platform.YOUTUBE,
    Platform.DOMAIN,
  ]);
  const [selectedTlds, setSelectedTlds] = useState<SupportedTld[]>(['com', 'uz', 'ai']);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<TelegramUser | null>(null);

  const triggerHaptic = (style: 'light' | 'medium' | 'heavy' = 'light') => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
    } catch {
      // Ignored outside TG
    }
  };

  const triggerNotificationHaptic = (type: 'error' | 'success' | 'warning') => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
    } catch {
      // Ignored outside TG
    }
  };

  const fetchWatchlist = useCallback(async (token: string) => {
    setWatchlistLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const items: WatchlistItem[] = data.items || [];
        setWatchlist(items);

        const map: Record<string, boolean> = {};
        for (const it of items) {
          map[`${it.platform}:${it.target.toLowerCase()}`] = true;
        }
        setTrackedMap(map);
      }
    } catch {
      // Network fallback
    } finally {
      setWatchlistLoading(false);
    }
  }, []);

  useEffect(() => {
    if (window.location.hash === '#watchlist') {
      setActiveTab('watchlist');
    }

    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();

      if (tg.initData) {
        fetch(`${API_BASE}/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg.initData }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.token) {
              setAuthToken(data.token);
              setCurrentUser(data.user);
              void fetchWatchlist(data.token);
            }
          })
          .catch((err) => {
            console.warn('Auth error:', err);
          });
      } else if (tg.initDataUnsafe?.user) {
        setCurrentUser(tg.initDataUnsafe.user);
      }
    }
  }, [fetchWatchlist]);

  const togglePlatform = (p: Platform) => {
    triggerHaptic('light');
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
  };

  const toggleTld = (tld: SupportedTld) => {
    triggerHaptic('light');
    setSelectedTlds((prev) =>
      prev.includes(tld) ? prev.filter((item) => item !== tld) : [...prev, tld]
    );
  };

  const toggleBreakdown = (name: string) => {
    triggerHaptic('light');
    setExpandedCandidates((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const copyToClipboard = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopiedName(name);
      triggerNotificationHaptic('success');
      setTimeout(() => setCopiedName(null), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    if (selectedPlatforms.length === 0) {
      setError('Выберите хотя бы одну платформу');
      return;
    }

    setLoading(true);
    setError(null);
    setCandidates([]);
    triggerHaptic('medium');

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`${API_BASE}/api/v1/naming/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: cleanQuery,
          intent,
          category: intent === 'AUTO' ? category : undefined,
          language: 'ru',
          platforms: selectedPlatforms,
          tlds: selectedPlatforms.includes(Platform.DOMAIN) ? selectedTlds : undefined,
          count: candidateCount,
          oneNameEverywhere,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || `Ошибка сервера: ${res.status}`);
      }

      const data: NamingPipelineResponse = await res.json();
      setCandidates(data.candidates || []);
      triggerNotificationHaptic('success');
    } catch (err: any) {
      setError(err.message || 'Ошибка генерации и проверки имен');
      triggerNotificationHaptic('error');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQuery = checkUsername.trim();
    if (!cleanQuery) return;

    if (selectedPlatforms.length === 0) {
      setError('Выберите хотя бы одну платформу');
      return;
    }

    setLoading(true);
    setError(null);
    setSingleResults([]);
    triggerHaptic('medium');

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`${API_BASE}/check`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: cleanQuery,
          platforms: selectedPlatforms,
          tlds: selectedPlatforms.includes(Platform.DOMAIN) ? selectedTlds : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || `Ошибка сервера: ${res.status}`);
      }

      const data: MultiCheckResponse = await res.json();
      setSingleResults(data.results || []);

      const hasAvailable = data.results.some((r) => r.status === CheckStatus.AVAILABLE);
      triggerNotificationHaptic(hasAvailable ? 'success' : 'warning');
    } catch (err: any) {
      setError(err.message || 'Ошибка при проверке имени');
      triggerNotificationHaptic('error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToWatchlist = async (platform: Platform, target: string, tld?: SupportedTld) => {
    triggerHaptic('medium');
    const key = `${platform}:${target.toLowerCase()}`;

    if (trackedMap[key]) return;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${API_BASE}/api/v1/watchlist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ platform, target, tld }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Не удалось добавить в отслеживание');
      }

      const created: WatchlistItem = await res.json();
      setWatchlist((prev) => [created, ...prev]);
      setTrackedMap((prev) => ({ ...prev, [key]: true }));
      triggerNotificationHaptic('success');
    } catch (err: any) {
      setError(err.message);
      triggerNotificationHaptic('error');
    }
  };

  const handleTrackAllCandidateChecks = async (checks: Array<{ platform: Platform; username: string }>) => {
    triggerHaptic('medium');
    for (const chk of checks) {
      const key = `${chk.platform}:${chk.username.toLowerCase()}`;
      if (!trackedMap[key]) {
        await handleAddToWatchlist(chk.platform, chk.username);
      }
    }
  };

  const handleDeleteWatchlist = async (id: string, platform: Platform, target: string) => {
    triggerHaptic('medium');
    try {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${API_BASE}/api/v1/watchlist/${id}`, {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) {
        throw new Error('Не удалось удалить из отслеживания');
      }

      setWatchlist((prev) => prev.filter((item) => item.id !== id));
      setTrackedMap((prev) => {
        const next = { ...prev };
        delete next[`${platform}:${target.toLowerCase()}`];
        return next;
      });
      triggerNotificationHaptic('success');
    } catch (err: any) {
      setError(err.message);
      triggerNotificationHaptic('error');
    }
  };

  const handleCheckNow = async (id: string) => {
    triggerHaptic('heavy');
    setCheckingId(id);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch(`${API_BASE}/api/v1/watchlist/${id}/check-now`, {
        method: 'POST',
        headers,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Ошибка проверки');
      }

      const data = await res.json();
      setWatchlist((prev) => prev.map((item) => (item.id === id ? data.item : item)));
      triggerNotificationHaptic('success');
    } catch (err: any) {
      setError(err.message);
      triggerNotificationHaptic('warning');
    } finally {
      setCheckingId(null);
    }
  };

  const getStatusDot = (status: CheckStatus) => {
    switch (status) {
      case CheckStatus.AVAILABLE:
        return { color: '#10b981', label: 'Свободен', bg: 'rgba(16, 185, 129, 0.14)', text: '#34d399' };
      case CheckStatus.TAKEN:
        return { color: '#71717a', label: 'Занят', bg: 'rgba(113, 113, 122, 0.16)', text: '#a1a1aa' };
      case CheckStatus.RATE_LIMITED:
        return { color: '#f59e0b', label: 'Лимит', bg: 'rgba(245, 158, 11, 0.14)', text: '#fbbf24' };
      case CheckStatus.UNKNOWN:
        return { color: '#eab308', label: 'Проверка', bg: 'rgba(234, 179, 8, 0.14)', text: '#fde047' };
      default:
        return { color: '#71717a', label: 'Ошибка', bg: 'rgba(113, 113, 122, 0.16)', text: '#a1a1aa' };
    }
  };

  const getScoreMeta = (score: number) => {
    if (score >= 80) return { color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)' };
    if (score >= 50) return { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)' };
    return { color: '#71717a', bg: 'rgba(113, 113, 122, 0.1)', border: 'rgba(113, 113, 122, 0.25)' };
  };

  const getPlatformIcon = (platform: Platform) => {
    switch (platform) {
      case Platform.TELEGRAM:
        return <Icons.Telegram />;
      case Platform.YOUTUBE:
        return <Icons.YouTube />;
      case Platform.DOMAIN:
        return <Icons.Globe />;
      default:
        return null;
    }
  };

  const getPlatformLabel = (platform: Platform) => {
    switch (platform) {
      case Platform.TELEGRAM:
        return 'Telegram';
      case Platform.YOUTUBE:
        return 'YouTube';
      case Platform.DOMAIN:
        return 'Domain';
      default:
        return platform;
    }
  };

  const formatRelativeTime = (isoString?: string | null) => {
    if (!isoString) return 'не проверялось';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'только что';
    if (diffMinutes < 60) return `${diffMinutes}м назад`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}ч назад`;
    return `${Math.floor(diffHours / 24)}д назад`;
  };

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '16px 14px 40px 14px',
        color: '#f4f4f6',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Sleek Minimal Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 14,
          marginBottom: 14,
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              backgroundColor: '#18181b',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <Icons.Sparkles />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3, color: '#ffffff' }}>
                username
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 5,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: '#a1a1aa',
                  letterSpacing: 0.4,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                AI 2.0
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#71717a' }}>
              brand naming & availability
            </div>
          </div>
        </div>

        {currentUser ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px 4px 6px',
              borderRadius: 20,
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: 12,
              color: '#a1a1aa',
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                backgroundColor: '#27272a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: '#ffffff',
              }}
            >
              {currentUser.first_name?.[0] || 'U'}
            </div>
            <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentUser.first_name}
            </span>
          </div>
        ) : (
          <div
            style={{
              fontSize: 11,
              color: '#71717a',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
            Staging
          </div>
        )}
      </header>

      {/* Segmented Control / Tabs */}
      <nav
        style={{
          display: 'flex',
          gap: 4,
          padding: 3,
          borderRadius: 12,
          backgroundColor: '#121215',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            setActiveTab('generate');
          }}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 9,
            border: 'none',
            backgroundColor: activeTab === 'generate' ? '#27272a' : 'transparent',
            color: activeTab === 'generate' ? '#ffffff' : '#71717a',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
            boxShadow: activeTab === 'generate' ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
          }}
        >
          <Icons.Sparkles />
          <span>Генератор</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            setActiveTab('check');
          }}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 9,
            border: 'none',
            backgroundColor: activeTab === 'check' ? '#27272a' : 'transparent',
            color: activeTab === 'check' ? '#ffffff' : '#71717a',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
            boxShadow: activeTab === 'check' ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
          }}
        >
          <Icons.Search />
          <span>Проверка</span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            setActiveTab('watchlist');
            if (authToken) void fetchWatchlist(authToken);
          }}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 9,
            border: 'none',
            backgroundColor: activeTab === 'watchlist' ? '#27272a' : 'transparent',
            color: activeTab === 'watchlist' ? '#ffffff' : '#71717a',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
            boxShadow: activeTab === 'watchlist' ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
          }}
        >
          <Icons.Bell />
          <span>Монитор</span>
          {watchlist.length > 0 && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 5px',
                borderRadius: 10,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {watchlist.length}
            </span>
          )}
        </button>
      </nav>

      {/* Floating Error Notification */}
      {error && (
        <div
          className="animate-fade-in"
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            backgroundColor: 'rgba(244, 63, 94, 0.1)',
            border: '1px solid rgba(244, 63, 94, 0.25)',
            color: '#fda4af',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#fda4af',
              cursor: 'pointer',
              fontSize: 14,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: AI GENERATOR */}
      {activeTab === 'generate' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Main Search Input */}
          <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#121215',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 14,
                padding: '4px 6px 4px 14px',
                transition: 'border-color 0.2s',
              }}
            >
              <div style={{ color: '#71717a', marginRight: 10, display: 'flex', alignItems: 'center' }}>
                <Icons.Search />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Идея, проект, ключевые слова..."
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  fontSize: 14,
                  padding: '10px 0',
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#71717a',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    fontSize: 14,
                  }}
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !query.trim()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: loading || !query.trim() ? '#27272a' : '#ffffff',
                  color: loading || !query.trim() ? '#52525b' : '#000000',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {loading ? 'AI...' : 'Создать'}
              </button>
            </div>

            {/* Quick Intent Pills (Horizontal Scroll) */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                paddingBottom: 2,
                msOverflowStyle: 'none',
                scrollbarWidth: 'none',
              }}
            >
              {INTENTS.map((item) => {
                const active = intent === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      triggerHaptic('light');
                      setIntent(item.id);
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 20,
                      border: `1px solid ${active ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                      backgroundColor: active ? 'rgba(255, 255, 255, 0.1)' : '#121215',
                      color: active ? '#ffffff' : '#71717a',
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* Filters & Options Trigger */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setShowFilters(!showFilters);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: 10,
                backgroundColor: '#121215',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#a1a1aa',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icons.Sliders />
                <span>Параметры генерации</span>
                <span style={{ color: '#52525b', fontSize: 11 }}>
                  ({selectedPlatforms.length} пл., {candidateCount} шт.)
                </span>
              </div>
              <div style={{ color: '#71717a' }}>
                {showFilters ? <Icons.ChevronUp /> : <Icons.ChevronDown />}
              </div>
            </button>

            {/* Collapsible Options Drawer */}
            {showFilters && (
              <div
                className="animate-fade-in"
                style={{
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: '#121215',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                {/* Intent == AUTO Category */}
                {intent === 'AUTO' && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Тематика
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {CATEGORIES.map((cat) => {
                        const active = category === cat;
                        return (
                          <button
                            type="button"
                            key={cat}
                            onClick={() => {
                              triggerHaptic('light');
                              setCategory(cat);
                            }}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 8,
                              border: `1px solid ${active ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                              backgroundColor: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                              color: active ? '#ffffff' : '#71717a',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Platforms selection */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Платформы
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN].map((p) => {
                      const active = selectedPlatforms.includes(p);
                      return (
                        <button
                          type="button"
                          key={p}
                          onClick={() => togglePlatform(p)}
                          style={{
                            flex: 1,
                            padding: '8px 10px',
                            borderRadius: 10,
                            border: `1px solid ${active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                            backgroundColor: active ? 'rgba(255, 255, 255, 0.07)' : 'transparent',
                            color: active ? '#ffffff' : '#71717a',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                          }}
                        >
                          {getPlatformIcon(p)}
                          <span>{getPlatformLabel(p)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* TLD Selection */}
                {selectedPlatforms.includes(Platform.DOMAIN) && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      Доменные зоны
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {SUPPORTED_TLDS.map((tld) => {
                        const active = selectedTlds.includes(tld);
                        return (
                          <button
                            type="button"
                            key={tld}
                            onClick={() => toggleTld(tld)}
                            style={{
                              padding: '4px 9px',
                              borderRadius: 6,
                              border: `1px solid ${active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                              backgroundColor: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                              color: active ? '#ffffff' : '#71717a',
                              fontSize: 11,
                              fontFamily: 'JetBrains Mono, monospace',
                              cursor: 'pointer',
                            }}
                          >
                            .{tld}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* One Name Everywhere Toggle */}
                <div
                  onClick={() => {
                    triggerHaptic('light');
                    setOneNameEverywhere(!oneNameEverywhere);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    padding: '8px 0',
                    borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f4f6' }}>
                      One Name Everywhere
                    </div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>
                      Приоритет именам, доступным сразу во всех сервисах
                    </div>
                  </div>
                  <div
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: oneNameEverywhere ? '#ffffff' : '#27272a',
                      position: 'relative',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        backgroundColor: oneNameEverywhere ? '#000000' : '#71717a',
                        position: 'absolute',
                        top: 3,
                        left: oneNameEverywhere ? 19 : 3,
                        transition: 'left 0.2s',
                      }}
                    />
                  </div>
                </div>

                {/* Candidate Count */}
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Количество вариантов
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[5, 10, 15, 20].map((num) => {
                      const active = candidateCount === num;
                      return (
                        <button
                          type="button"
                          key={num}
                          onClick={() => {
                            triggerHaptic('light');
                            setCandidateCount(num);
                          }}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            borderRadius: 8,
                            border: `1px solid ${active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                            backgroundColor: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                            color: active ? '#ffffff' : '#71717a',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {num}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </form>

          {/* Loading Skeleton */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="shimmer"
                  style={{
                    height: 110,
                    borderRadius: 14,
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                />
              ))}
            </div>
          )}

          {/* Candidates Result Cards */}
          {!loading && candidates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Результаты ({candidates.length})
                </span>
                <span style={{ fontSize: 11, color: '#52525b', fontFamily: 'JetBrains Mono, monospace' }}>
                  Brand Score
                </span>
              </div>

              {candidates.map((c, idx) => {
                const scoreMeta = getScoreMeta(c.brandScore);
                const isExpanded = !!expandedCandidates[c.name];

                return (
                  <div
                    key={idx}
                    className="animate-fade-in"
                    style={{
                      padding: '14px 16px',
                      borderRadius: 14,
                      backgroundColor: '#121215',
                      border: `1px solid ${c.availableEverywhere ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 255, 255, 0.07)'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      transition: 'border-color 0.2s',
                    }}
                  >
                    {/* Card Top: Username + Copy + Brand Score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            letterSpacing: -0.3,
                            color: '#ffffff',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          @{c.name}
                        </span>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(c.name)}
                          title="Скопировать"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            backgroundColor: copiedName === c.name ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                            color: copiedName === c.name ? '#34d399' : '#a1a1aa',
                            fontSize: 11,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {copiedName === c.name ? <Icons.Check /> : <Icons.Copy />}
                          <span>{copiedName === c.name ? 'Скопировано' : 'Копия'}</span>
                        </button>
                      </div>

                      {/* Brand Score Pill */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 9px',
                          borderRadius: 20,
                          backgroundColor: scoreMeta.bg,
                          border: `1px solid ${scoreMeta.border}`,
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: scoreMeta.color }} />
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: scoreMeta.color,
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {c.brandScore}
                        </span>
                      </div>
                    </div>

                    {/* One Name Everywhere Badge */}
                    {c.availableEverywhere && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#34d399',
                          backgroundColor: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.2)',
                          borderRadius: 8,
                          padding: '4px 8px',
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
                        Свободно на всех выбранных платформах
                      </div>
                    )}

                    {/* Rationale & Tags */}
                    {c.reason && (
                      <div style={{ fontSize: 12, color: '#8e8e99', lineHeight: 1.4 }}>
                        {c.reason}
                      </div>
                    )}

                    {c.tags && c.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {c.tags.map((tag, tIdx) => (
                          <span
                            key={tIdx}
                            style={{
                              fontSize: 10,
                              color: '#71717a',
                              backgroundColor: 'rgba(255, 255, 255, 0.04)',
                              padding: '2px 6px',
                              borderRadius: 4,
                            }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Platform Checks Row */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#71717a', fontWeight: 600, textTransform: 'uppercase' }}>
                          Доступность
                        </span>
                        <button
                          type="button"
                          onClick={() => handleTrackAllCandidateChecks(c.checks)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#a1a1aa',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Icons.Bell />
                          <span>Отслеживать все ({c.checks.length})</span>
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {c.checks.map((chk, chkIdx) => {
                          const statusDot = getStatusDot(chk.status);
                          const watchKey = `${chk.platform}:${chk.username.toLowerCase()}`;
                          const isTracked = !!trackedMap[watchKey];

                          return (
                            <div
                              key={chkIdx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 10px',
                                borderRadius: 8,
                                backgroundColor: '#18181b',
                                border: '1px solid rgba(255, 255, 255, 0.04)',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ color: '#71717a' }}>{getPlatformIcon(chk.platform)}</div>
                                <span style={{ fontSize: 12, color: '#f4f4f6', fontWeight: 500 }}>
                                  {chk.platform === Platform.DOMAIN ? chk.username : `@${chk.username}`}
                                </span>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '2px 7px',
                                    borderRadius: 12,
                                    backgroundColor: statusDot.bg,
                                  }}
                                >
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: statusDot.color }} />
                                  <span style={{ fontSize: 10, fontWeight: 600, color: statusDot.text }}>
                                    {statusDot.label}
                                  </span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleAddToWatchlist(chk.platform, chk.username)}
                                disabled={isTracked}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 8px',
                                  borderRadius: 6,
                                  border: `1px solid ${isTracked ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
                                  backgroundColor: isTracked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                                  color: isTracked ? '#34d399' : '#8e8e99',
                                  fontSize: 11,
                                  cursor: isTracked ? 'default' : 'pointer',
                                }}
                              >
                                {isTracked ? <Icons.Check /> : <Icons.Bell />}
                                <span>{isTracked ? 'В мониторе' : 'Следить'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Expandable Score Breakdown */}
                    <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => toggleBreakdown(c.name)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: 'none',
                          border: 'none',
                          color: '#71717a',
                          fontSize: 11,
                          cursor: 'pointer',
                          padding: '4px 0',
                        }}
                      >
                        <span>Декомпозиция скоринга</span>
                        {isExpanded ? <Icons.ChevronUp /> : <Icons.ChevronDown />}
                      </button>

                      {isExpanded && (
                        <div
                          className="animate-fade-in"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            marginTop: 8,
                            padding: '8px 10px',
                            borderRadius: 8,
                            backgroundColor: '#18181b',
                            fontSize: 11,
                          }}
                        >
                          {[
                            { label: 'Длина', val: c.scoreBreakdown.length, max: 20 },
                            { label: 'Читаемость', val: c.scoreBreakdown.readability, max: 15 },
                            { label: 'Символы', val: c.scoreBreakdown.cleanliness, max: 15 },
                            { label: 'Креатив', val: c.scoreBreakdown.similarity, max: 10 },
                            { label: 'Доступность', val: c.scoreBreakdown.availability, max: 40 },
                          ].map((item, bIdx) => (
                            <div key={bIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ color: '#8e8e99' }}>{item.label}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div
                                  style={{
                                    width: 70,
                                    height: 4,
                                    borderRadius: 2,
                                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                    overflow: 'hidden',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${(item.val / item.max) * 100}%`,
                                      height: '100%',
                                      backgroundColor: '#ffffff',
                                      borderRadius: 2,
                                    }}
                                  />
                                </div>
                                <span style={{ color: '#ffffff', fontFamily: 'JetBrains Mono, monospace', minWidth: 35, textAlign: 'right' }}>
                                  {item.val}/{item.max}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SINGLE QUICK CHECK */}
      {activeTab === 'check' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <form onSubmit={handleQuickCheck} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#121215',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 14,
                padding: '4px 6px 4px 14px',
              }}
            >
              <div style={{ color: '#71717a', marginRight: 10, display: 'flex', alignItems: 'center' }}>
                <Icons.Search />
              </div>
              <input
                type="text"
                value={checkUsername}
                onChange={(e) => setCheckUsername(e.target.value)}
                placeholder="Юзернейм для проверки (напр. novexa)..."
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  fontSize: 14,
                  padding: '10px 0',
                }}
              />
              <button
                type="submit"
                disabled={loading || !checkUsername.trim()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: loading || !checkUsername.trim() ? '#27272a' : '#ffffff',
                  color: loading || !checkUsername.trim() ? '#52525b' : '#000000',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: loading || !checkUsername.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {loading ? '...' : 'Проверить'}
              </button>
            </div>

            {/* Platform toggles */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN].map((p) => {
                const active = selectedPlatforms.includes(p);
                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => togglePlatform(p)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: `1px solid ${active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                      backgroundColor: active ? 'rgba(255, 255, 255, 0.07)' : '#121215',
                      color: active ? '#ffffff' : '#71717a',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {getPlatformIcon(p)}
                    <span>{getPlatformLabel(p)}</span>
                  </button>
                );
              })}
            </div>
          </form>

          {/* Quick Check Results */}
          {!loading && singleResults.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Результаты проверки ({singleResults.length})
              </div>

              {singleResults.map((r, rIdx) => {
                const statusDot = getStatusDot(r.status);
                const watchKey = `${r.platform}:${r.username.toLowerCase()}`;
                const isTracked = !!trackedMap[watchKey];

                return (
                  <div
                    key={rIdx}
                    className="animate-fade-in"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      backgroundColor: '#121215',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ color: '#71717a' }}>{getPlatformIcon(r.platform)}</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', fontFamily: 'JetBrains Mono, monospace' }}>
                          {r.platform === Platform.DOMAIN ? r.username : `@${r.username}`}
                        </div>
                        <div style={{ fontSize: 11, color: '#71717a' }}>
                          {getPlatformLabel(r.platform)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '3px 8px',
                          borderRadius: 12,
                          backgroundColor: statusDot.bg,
                        }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: statusDot.color }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: statusDot.text }}>
                          {statusDot.label}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToWatchlist(r.platform, r.username)}
                        disabled={isTracked}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 9px',
                          borderRadius: 8,
                          border: `1px solid ${isTracked ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
                          backgroundColor: isTracked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                          color: isTracked ? '#34d399' : '#a1a1aa',
                          fontSize: 11,
                          cursor: isTracked ? 'default' : 'pointer',
                        }}
                      >
                        {isTracked ? <Icons.Check /> : <Icons.Bell />}
                        <span>{isTracked ? 'В мониторе' : 'Следить'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: WATCHLIST MONITOR */}
      {activeTab === 'watchlist' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Header with Slot Bar */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              backgroundColor: '#121215',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>
                  Слоты фонового мониторинга
                </div>
                <div style={{ fontSize: 11, color: '#71717a' }}>
                  Оповещение в Telegram при освобождении
                </div>
              </div>

              {authToken && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    fetchWatchlist(authToken);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    color: '#a1a1aa',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <Icons.Refresh />
                  <span>Обновить</span>
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: '#8e8e99' }}>Использовано слотов:</span>
              <span style={{ color: watchlist.length >= 3 ? '#fbbf24' : '#34d399', fontWeight: 600 }}>
                {watchlist.length} / 3 активных (Тариф FREE)
              </span>
            </div>

            <div
              style={{
                width: '100%',
                height: 3,
                borderRadius: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, (watchlist.length / 3) * 100)}%`,
                  height: '100%',
                  backgroundColor: watchlist.length >= 3 ? '#f59e0b' : '#ffffff',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Loading state */}
          {watchlistLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map((i) => (
                <div key={i} className="shimmer" style={{ height: 80, borderRadius: 12 }} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!watchlistLoading && watchlist.length === 0 && (
            <div
              style={{
                padding: '36px 20px',
                textAlign: 'center',
                borderRadius: 14,
                backgroundColor: '#121215',
                border: '1px dashed rgba(255, 255, 255, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#71717a',
                }}
              >
                <Icons.Bell />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>
                Список отслеживания пуст
              </div>
              <div style={{ fontSize: 12, color: '#71717a', maxWidth: 280, lineHeight: 1.4 }}>
                Найдите занятый юзернейм во вкладке «Генератор» или «Проверка» и нажмите «Следить».
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setActiveTab('generate');
                }}
                style={{
                  marginTop: 4,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Найти имя
              </button>
            </div>
          )}

          {/* Watchlist items */}
          {!watchlistLoading && watchlist.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {watchlist.map((item) => {
                const effectiveStatus = item.currentStatus || item.lastStatus || CheckStatus.UNKNOWN;
                const statusDot = getStatusDot(effectiveStatus);
                const isChecking = checkingId === item.id;
                const isDomain = item.platform === Platform.DOMAIN;

                return (
                  <div
                    key={item.id}
                    className="animate-fade-in"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      backgroundColor: '#121215',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ color: '#71717a' }}>{getPlatformIcon(item.platform)}</div>
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: '#ffffff',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {isDomain ? item.target : `@${item.target}`}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '2px 7px',
                          borderRadius: 10,
                          backgroundColor: statusDot.bg,
                        }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: statusDot.color }} />
                        <span style={{ fontSize: 10, fontWeight: 600, color: statusDot.text }}>
                          {statusDot.label}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#52525b' }}>
                      <span>Проверено: {formatRelativeTime(item.lastCheckedAt)}</span>
                      <span>Фон: каждые 6 ч.</span>
                    </div>

                    <div style={{ display: 'flex', gap: 6, paddingTop: 2 }}>
                      <button
                        type="button"
                        disabled={isChecking}
                        onClick={() => handleCheckNow(item.id)}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(255, 255, 255, 0.04)',
                          color: '#ffffff',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: isChecking ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                        }}
                      >
                        <Icons.Refresh />
                        <span>{isChecking ? 'Проверка...' : 'Проверить'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteWatchlist(item.id, item.platform, item.target)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(244, 63, 94, 0.2)',
                          backgroundColor: 'rgba(244, 63, 94, 0.08)',
                          color: '#f87171',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Icons.Trash />
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
