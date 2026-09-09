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

const INTENTS: { id: NamingIntent; label: string; icon: string }[] = [
  { id: 'PERSONAL', label: 'Для себя', icon: '👤' },
  { id: 'BRAND', label: 'Для бренда', icon: '💎' },
  { id: 'BUSINESS', label: 'Для бизнеса', icon: '🏢' },
  { id: 'PROJECT', label: 'Для проекта', icon: '🚀' },
  { id: 'CREATIVE', label: 'Красивый username', icon: '✨' },
  { id: 'AUTO', label: 'AI придумает сам', icon: '🤖' },
];

const CATEGORIES = [
  'AI & Tech',
  'Coffee & Food',
  'Fashion & Beauty',
  'Education',
  'Finance & Crypto',
  'Gaming',
  'Personal Blog',
  'Other',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'generate' | 'check' | 'watchlist'>('generate');

  // AI Generator state
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState<NamingIntent>('BRAND');
  const [category, setCategory] = useState<string>('AI & Tech');
  const [oneNameEverywhere, setOneNameEverywhere] = useState(true);
  const [candidateCount, setCandidateCount] = useState(10);
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([]);
  const [expandedCandidates, setExpandedCandidates] = useState<Record<string, boolean>>({});
  const [copiedName, setCopiedName] = useState<string | null>(null);

  // Single-check state
  const [checkUsername, setCheckUsername] = useState('');
  const [singleResults, setSingleResults] = useState<CheckerResult[]>([]);

  // Watchlist state (Phase 1D)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [trackedMap, setTrackedMap] = useState<Record<string, boolean>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Common platform state
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
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
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

        // Update tracking map
        const map: Record<string, boolean> = {};
        for (const it of items) {
          map[`${it.platform}:${it.target}`] = true;
        }
        setTrackedMap(map);
      }
    } catch {
      // Offline fallback
    } finally {
      setWatchlistLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check deep link hash
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
    triggerHaptic();
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
  };

  const toggleTld = (tld: SupportedTld) => {
    triggerHaptic();
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
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setTimeout(() => setCopiedName(null), 2000);
    } catch {
      // Fallback
    }
  };

  // 1. Submit AI Naming Pipeline
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
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

      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err: any) {
      setError(err.message || 'Ошибка генерации и проверки имен');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setLoading(false);
    }
  };

  // 2. Submit Quick Check
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
      if (hasAvailable) {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      } else {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка при проверке имени');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setLoading(false);
    }
  };

  // 3. Watchlist Management Handlers (Phase 1D)
  const handleAddToWatchlist = async (platform: Platform, target: string, tld?: SupportedTld) => {
    triggerHaptic('medium');
    const key = `${platform}:${target}`;

    if (trackedMap[key]) {
      return; // Already tracked
    }

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

      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err: any) {
      setError(err.message);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
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
        delete next[`${platform}:${target}`];
        return next;
      });

      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err: any) {
      setError(err.message);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
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

      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err: any) {
      setError(err.message);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
    } finally {
      setCheckingId(null);
    }
  };

  const getStatusBadge = (status: CheckStatus) => {
    switch (status) {
      case CheckStatus.AVAILABLE:
        return { label: 'СВОБОДЕН', color: '#10b981', bg: '#064e3b' };
      case CheckStatus.TAKEN:
        return { label: 'ЗАНЯТ', color: '#ef4444', bg: '#450a0a' };
      case CheckStatus.RATE_LIMITED:
        return { label: 'ЛИМИТ', color: '#f59e0b', bg: '#78350f' };
      case CheckStatus.UNKNOWN:
        return { label: 'НЕИЗВЕСТНО', color: '#eab308', bg: '#713f12' };
      default:
        return { label: 'ОШИБКА', color: '#94a3b8', bg: '#334155' };
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return { text: '#10b981', bg: '#064e3b', border: '#059669' };
    if (score >= 50) return { text: '#f59e0b', bg: '#78350f', border: '#d97706' };
    return { text: '#94a3b8', bg: '#1e293b', border: '#475569' };
  };

  const getPlatformIcon = (platform: Platform) => {
    switch (platform) {
      case Platform.TELEGRAM:
        return '✈️ Telegram';
      case Platform.YOUTUBE:
        return '▶️ YouTube';
      case Platform.DOMAIN:
        return '🌐 Domains';
      default:
        return platform;
    }
  };

  const formatRelativeTime = (isoString?: string | null) => {
    if (!isoString) return 'еще не проверялось';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return 'только что';
    if (diffMinutes < 60) return `${diffMinutes} мин назад`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} ч назад`;
    return `${Math.floor(diffHours / 24)} дн назад`;
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '20px 16px', color: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <header style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, backgroundColor: '#0284c7', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
          AI BRAND & USERNAME 2.0
        </div>
        <h1 style={{ margin: '0 0 6px 0', fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>
          Username AI
        </h1>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
          AI-подбор, Brand Score и мониторинг доступности
        </p>
        {currentUser && (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
            👤 {currentUser.first_name} {currentUser.username ? `(@${currentUser.username})` : ''}
          </div>
        )}
      </header>

      {/* 3 Main Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, backgroundColor: '#0f172a', padding: 4, borderRadius: 12 }}>
        <button
          type="button"
          onClick={() => { triggerHaptic(); setActiveTab('generate'); }}
          style={{
            flex: 1,
            padding: '9px 8px',
            borderRadius: 10,
            border: 'none',
            backgroundColor: activeTab === 'generate' ? '#0284c7' : 'transparent',
            color: activeTab === 'generate' ? '#ffffff' : '#94a3b8',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          ✨ Генератор
        </button>
        <button
          type="button"
          onClick={() => { triggerHaptic(); setActiveTab('check'); }}
          style={{
            flex: 1,
            padding: '9px 8px',
            borderRadius: 10,
            border: 'none',
            backgroundColor: activeTab === 'check' ? '#0284c7' : 'transparent',
            color: activeTab === 'check' ? '#ffffff' : '#94a3b8',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          🔍 Проверка
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            setActiveTab('watchlist');
            if (authToken) void fetchWatchlist(authToken);
          }}
          style={{
            flex: 1,
            padding: '9px 8px',
            borderRadius: 10,
            border: 'none',
            backgroundColor: activeTab === 'watchlist' ? '#0284c7' : 'transparent',
            color: activeTab === 'watchlist' ? '#ffffff' : '#94a3b8',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          🔔 Отслеживания {watchlist.length > 0 ? `(${watchlist.length})` : ''}
        </button>
      </div>

      {/* Error alert */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            backgroundColor: '#450a0a',
            border: '1px solid #dc2626',
            color: '#fca5a5',
            fontSize: 13,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* TAB 1: AI GENERATOR */}
      {activeTab === 'generate' && (
        <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Intent Selector */}
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, display: 'block', marginBottom: 8 }}>
              1. Выберите цель (Intent):
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {INTENTS.map((item) => {
                const active = intent === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => { triggerHaptic(); setIntent(item.id); }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
                      backgroundColor: active ? '#0369a1' : '#1e293b',
                      color: '#ffffff',
                      fontSize: 12,
                      fontWeight: 600,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category Selector */}
          {intent === 'AUTO' && (
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, display: 'block', marginBottom: 8 }}>
                Категория проекта:
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CATEGORIES.map((cat) => {
                  const active = category === cat;
                  return (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => { triggerHaptic(); setCategory(cat); }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${active ? '#0284c7' : '#334155'}`,
                        backgroundColor: active ? '#0284c7' : '#1e293b',
                        color: active ? '#ffffff' : '#94a3b8',
                        fontSize: 12,
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

          {/* Keyword Query Input */}
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, display: 'block', marginBottom: 8 }}>
              2. Ключевое слово или идея:
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="например, superfast bot, nova, coffee shop"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '13px 14px',
                borderRadius: 10,
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: '#ffffff',
                fontSize: 15,
                outline: 'none',
              }}
            />
          </div>

          {/* Platform Checkboxes */}
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, display: 'block', marginBottom: 8 }}>
              3. Платформы для проверки:
            </span>
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
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
                      backgroundColor: active ? '#0369a1' : '#1e293b',
                      color: '#ffffff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {active ? '✓ ' : ''}{getPlatformIcon(p)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TLD Selection */}
          {selectedPlatforms.includes(Platform.DOMAIN) && (
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, display: 'block', marginBottom: 6 }}>
                Доменные зоны (TLD):
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SUPPORTED_TLDS.map((tld) => {
                  const active = selectedTlds.includes(tld);
                  return (
                    <button
                      type="button"
                      key={tld}
                      onClick={() => toggleTld(tld)}
                      style={{
                        padding: '5px 11px',
                        borderRadius: 8,
                        border: `1px solid ${active ? '#0284c7' : '#334155'}`,
                        backgroundColor: active ? '#0284c7' : '#1e293b',
                        color: '#ffffff',
                        fontSize: 12,
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
            onClick={() => { triggerHaptic(); setOneNameEverywhere(!oneNameEverywhere); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: 10,
              backgroundColor: oneNameEverywhere ? 'rgba(3, 105, 161, 0.25)' : '#1e293b',
              border: `1px solid ${oneNameEverywhere ? '#0284c7' : '#334155'}`,
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: oneNameEverywhere ? '#38bdf8' : '#ffffff' }}>
                🌟 One Name Everywhere
              </div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
                Приоритет именам, свободным во всех выбранных сервисах
              </div>
            </div>
            <div
              style={{
                width: 42,
                height: 24,
                borderRadius: 12,
                backgroundColor: oneNameEverywhere ? '#0284c7' : '#475569',
                position: 'relative',
                transition: 'background-color 0.2s',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  position: 'absolute',
                  top: 3,
                  left: oneNameEverywhere ? 21 : 3,
                  transition: 'left 0.2s',
                }}
              />
            </div>
          </div>

          {/* Candidate Count */}
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, display: 'block', marginBottom: 6 }}>
              Количество вариантов:
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {[5, 10, 15, 20].map((num) => {
                const active = candidateCount === num;
                return (
                  <button
                    type="button"
                    key={num}
                    onClick={() => { triggerHaptic(); setCandidateCount(num); }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: `1px solid ${active ? '#0284c7' : '#334155'}`,
                      backgroundColor: active ? '#0284c7' : '#1e293b',
                      color: '#ffffff',
                      fontSize: 12,
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

          {/* Action Button */}
          <button
            type="submit"
            disabled={loading || !query.trim() || selectedPlatforms.length === 0}
            style={{
              marginTop: 4,
              padding: '14px 20px',
              borderRadius: 12,
              border: 'none',
              backgroundColor: loading ? '#475569' : '#0284c7',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
            }}
          >
            {loading ? '⚡ Генерация и проверка...' : '🚀 СГЕНЕРИРОВАТЬ И ПРОВЕРИТЬ'}
          </button>
        </form>
      )}

      {/* TAB 2: QUICK SINGLE CHECK */}
      {activeTab === 'check' && (
        <form onSubmit={handleQuickCheck} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, display: 'block', marginBottom: 8 }}>
              Проверить конкретный username:
            </span>
            <input
              type="text"
              value={checkUsername}
              onChange={(e) => setCheckUsername(e.target.value)}
              placeholder="например, novexa"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '13px 14px',
                borderRadius: 10,
                border: '1px solid #334155',
                backgroundColor: '#1e293b',
                color: '#ffffff',
                fontSize: 15,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, display: 'block', marginBottom: 8 }}>
              Платформы для проверки:
            </span>
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
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
                      backgroundColor: active ? '#0369a1' : '#1e293b',
                      color: '#ffffff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {active ? '✓ ' : ''}{getPlatformIcon(p)}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !checkUsername.trim() || selectedPlatforms.length === 0}
            style={{
              marginTop: 4,
              padding: '14px 20px',
              borderRadius: 12,
              border: 'none',
              backgroundColor: loading ? '#475569' : '#0284c7',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Проверка...' : '🔍 ПРОВЕРИТЬ СЕЙЧАС'}
          </button>
        </form>
      )}

      {/* TAB 3: WATCHLIST (Phase 1D) */}
      {activeTab === 'watchlist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Мои отслеживания</h2>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                Фоновый мониторинг с оповещением при освобождении
              </div>
            </div>
            {authToken && (
              <button
                type="button"
                onClick={() => fetchWatchlist(authToken)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  backgroundColor: '#1e293b',
                  color: '#94a3b8',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                🔄 Обновить
              </button>
            )}
          </div>

          {watchlistLoading && (
            <div style={{ textAlign: 'center', padding: 30, opacity: 0.6 }}>
              Загрузка списка отслеживания...
            </div>
          )}

          {!watchlistLoading && watchlist.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                borderRadius: 14,
                backgroundColor: '#1e293b',
                border: '1px dashed #334155',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>У вас пока нет отслеживаемых имен</div>
              <div style={{ fontSize: 12, opacity: 0.65, maxWidth: 300, margin: '0 auto 16px auto' }}>
                Найдите желаемое имя во вкладке «Генератор» или «Проверка» и нажмите кнопку «Отслеживать»
              </div>
              <button
                type="button"
                onClick={() => { triggerHaptic(); setActiveTab('generate'); }}
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ✨ Найти имя для отслеживания
              </button>
            </div>
          )}

          {!watchlistLoading && watchlist.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderRadius: 10,
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                }}
              >
                <span style={{ fontSize: 12, opacity: 0.8 }}>Слоты мониторинга:</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: watchlist.length >= 3 ? '#f59e0b' : '#38bdf8' }}>
                  {watchlist.length} / 3 активно (Тариф: FREE)
                </span>
              </div>

              {watchlist.map((item) => {
                const effectiveStatus = item.currentStatus || item.lastStatus || CheckStatus.UNKNOWN;
                const badge = getStatusBadge(effectiveStatus);
                const isChecking = checkingId === item.id;
                const isDomain = item.platform === Platform.DOMAIN;
                const intervalHours = Math.round(
                  (item.checkIntervalMinutes ?? Math.round((item.checkIntervalSeconds || 21600) / 60)) / 60
                );

                return (
                  <div
                    key={item.id}
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' }}>
                          {getPlatformIcon(item.platform)}
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 800 }}>
                          {isDomain ? '' : '@'}{item.target}
                        </div>
                      </div>

                      <span
                        style={{
                          padding: '4px 9px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          backgroundColor: badge.bg,
                          color: badge.color,
                        }}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {item.previousStatus && item.previousStatus !== effectiveStatus && (
                      <div style={{ fontSize: 11, color: '#38bdf8', padding: '2px 6px', backgroundColor: '#0c4a6e', borderRadius: 4 }}>
                        Было: {item.previousStatus} ➔ Стало: {effectiveStatus}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.65 }}>
                      <span>Проверено: {formatRelativeTime(item.lastCheckedAt)}</span>
                      <span>Интервал: ~{intervalHours} ч (мин. 1ч)</span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        type="button"
                        disabled={isChecking}
                        onClick={() => handleCheckNow(item.id)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid #0284c7',
                          backgroundColor: isChecking ? '#334155' : '#0369a1',
                          color: '#ffffff',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: isChecking ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isChecking ? '⏳ Проверка...' : '⚡ Проверить сейчас'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteWatchlist(item.id, item.platform, item.target)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid #ef4444',
                          backgroundColor: '#450a0a',
                          color: '#fca5a5',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🗑️ Удалить
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                padding: 18,
                borderRadius: 14,
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                opacity: 0.6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 140, height: 20, backgroundColor: '#334155', borderRadius: 6 }} />
                <div style={{ width: 50, height: 24, backgroundColor: '#334155', borderRadius: 12 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 70, height: 18, backgroundColor: '#334155', borderRadius: 6 }} />
                <div style={{ width: 70, height: 18, backgroundColor: '#334155', borderRadius: 6 }} />
                <div style={{ width: 70, height: 18, backgroundColor: '#334155', borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Candidate Cards (Phase 1C & 1D Watchlist buttons) */}
      {activeTab === 'generate' && !loading && candidates.length > 0 && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>
              Подобранные варианты ({candidates.length}):
            </span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              Brand Score & ONE
            </span>
          </div>

          {candidates.map((c, index) => {
            const scoreColors = getScoreColor(c.brandScore);
            const isExpanded = !!expandedCandidates[c.name];

            return (
              <div
                key={index}
                style={{
                  padding: 16,
                  borderRadius: 14,
                  backgroundColor: '#1e293b',
                  border: `1px solid ${c.availableEverywhere ? '#0284c7' : '#334155'}`,
                  boxShadow: c.availableEverywhere ? '0 0 12px rgba(2, 132, 199, 0.25)' : 'none',
                }}
              >
                {/* Card Top: Name + Brand Score + Badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    {c.availableEverywhere && (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 8,
                          fontSize: 10,
                          fontWeight: 800,
                          backgroundColor: '#0369a1',
                          color: '#e0f2fe',
                          letterSpacing: 0.5,
                          marginBottom: 4,
                        }}
                      >
                        🌟 ONE NAME EVERYWHERE
                      </span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3 }}>
                        @{c.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(c.name)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          border: '1px solid #475569',
                          backgroundColor: copiedName === c.name ? '#059669' : '#334155',
                          color: '#ffffff',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {copiedName === c.name ? '✓ Скопировано' : '📋 Копировать'}
                      </button>
                    </div>
                  </div>

                  {/* Brand Score Circle / Badge */}
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '4px 10px',
                      borderRadius: 10,
                      backgroundColor: scoreColors.bg,
                      border: `1px solid ${scoreColors.border}`,
                    }}
                  >
                    <div style={{ fontSize: 10, opacity: 0.8, fontWeight: 700, color: scoreColors.text }}>SCORE</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: scoreColors.text }}>{c.brandScore}</div>
                  </div>
                </div>

                {/* Reason and Tags */}
                {c.reason && (
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8, fontStyle: 'italic' }}>
                    💡 {c.reason}
                  </div>
                )}

                {c.tags && c.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                    {c.tags.map((tag, tIdx) => (
                      <span
                        key={tIdx}
                        style={{
                          padding: '2px 6px',
                          borderRadius: 6,
                          fontSize: 10,
                          backgroundColor: '#0f172a',
                          color: '#94a3b8',
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Platform Badges with Watchlist Button (Phase 1D.1 Single Platform Items) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 700 }}>ПРОВЕРКА КАНАЛОВ:</span>
                    <button
                      type="button"
                      onClick={() => handleTrackAllCandidateChecks(c.checks)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        border: '1px solid #0284c7',
                        backgroundColor: '#0369a1',
                        color: '#e0f2fe',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ Отслеживать всё ({c.checks.length})
                    </button>
                  </div>
                  {c.checks.map((chk, chkIdx) => {
                    const badge = getStatusBadge(chk.status);
                    const watchKey = `${chk.platform}:${chk.username}`;
                    const isTracked = !!trackedMap[watchKey];

                    return (
                      <div
                        key={chkIdx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 8px',
                          backgroundColor: '#0f172a',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600 }}>
                            {chk.platform === Platform.DOMAIN ? chk.username : chk.platform}
                          </span>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              backgroundColor: badge.bg,
                              color: badge.color,
                            }}
                          >
                            {badge.label}
                          </span>
                        </div>

                        {/* Watchlist toggle button per platform */}
                        <button
                          type="button"
                          onClick={() => handleAddToWatchlist(chk.platform, chk.username)}
                          disabled={isTracked}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            border: `1px solid ${isTracked ? '#059669' : '#334155'}`,
                            backgroundColor: isTracked ? '#064e3b' : '#1e293b',
                            color: isTracked ? '#a7f3d0' : '#94a3b8',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: isTracked ? 'default' : 'pointer',
                          }}
                        >
                          {isTracked ? '🔔 Отслеживается' : '🔔 Отслеживать'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Expandable Score Breakdown Toggle */}
                <button
                  type="button"
                  onClick={() => toggleBreakdown(c.name)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: '#0f172a',
                    color: '#94a3b8',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>{isExpanded ? '▲ Скрыть детали Brand Score' : '▼ Детали Brand Score (декомпозиция)'}</span>
                </button>

                {/* Score Breakdown Accordion */}
                {isExpanded && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 10,
                      borderRadius: 8,
                      backgroundColor: '#0f172a',
                      fontSize: 11,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: 6,
                    }}
                  >
                    <div>Длина: <strong>{c.scoreBreakdown.length} / 20</strong></div>
                    <div>Читаемость: <strong>{c.scoreBreakdown.readability} / 15</strong></div>
                    <div>Чистота символов: <strong>{c.scoreBreakdown.cleanliness} / 15</strong></div>
                    <div>Сходство/Креатив: <strong>{c.scoreBreakdown.similarity} / 10</strong></div>
                    <div style={{ gridColumn: 'span 2' }}>
                      Доступность платформ: <strong>{c.scoreBreakdown.availability} / 40</strong>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Check Results List */}
      {activeTab === 'check' && !loading && singleResults.length > 0 && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.85 }}>
            Результаты проверки ({singleResults.length}):
          </div>
          {singleResults.map((r, index) => {
            const badge = getStatusBadge(r.status);
            const watchKey = `${r.platform}:${r.username}`;
            const isTracked = !!trackedMap[watchKey];

            return (
              <div
                key={index}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' }}>
                    {getPlatformIcon(r.platform)}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {r.username}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '4px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 700,
                      backgroundColor: badge.bg,
                      color: badge.color,
                    }}
                  >
                    {badge.label}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleAddToWatchlist(r.platform, r.username)}
                    disabled={isTracked}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: `1px solid ${isTracked ? '#059669' : '#334155'}`,
                      backgroundColor: isTracked ? '#064e3b' : '#0f172a',
                      color: isTracked ? '#a7f3d0' : '#94a3b8',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: isTracked ? 'default' : 'pointer',
                    }}
                  >
                    {isTracked ? '🔔 В отслеживании' : '🔔 Отслеживать'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
