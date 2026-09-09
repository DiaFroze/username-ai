# Username AI — Phase 1B: Multi-Platform Checker Engine

SaaS-платформа в формате **Telegram Bot + Telegram Mini App** для подбора, AI-генерации, проверки доступности и фонового мониторинга свободных юзернеймов и брендовых имен.

Данный релиз реализует **PHASE 1B — MULTI-PLATFORM CHECKER ENGINE**: расширенный отказоустойчивый параллельный движок валидации имен на нескольких платформах (Telegram, YouTube, Домены 6 TLD), с многоуровневым кэшированием в Redis, защитой от thundering herd (Single-Flight coalescing) и строгой консервативной логикой определения доступности.

---

## 1. Архитектура Phase 1B

```
[ Telegram Mini App (React 18 + Vite) ]
          │
          │ POST /check { query: "novexa", platforms: ["TELEGRAM", "YOUTUBE", "DOMAIN"], tlds: ["com", "ai", "uz"] }
          ▼
[ Backend Core API (Fastify + TypeScript) ]
          │
          ▼
[ CheckerCoordinator ] ──(Cache-Aside)──► [ Redis 7 CacheStore ]
          │                                  ├── telegram (TTL: 30m)
          │                                  ├── youtube (TTL: 60m)
          │                                  ├── domain (TTL: 60m)
          │                                  └── negative (TTL: 60s)
          ▼
[ Single-Flight RequestCoalescer ] (Дедупликация 20+ параллельных запросов в 1 провайдер)
          │
   ┌──────┴───────────────────────────┬────────────────────────────┐
   ▼                                  ▼                            ▼
[ TelegramChecker ]          [ YouTubeChecker ]          [ DomainChecker ]
 ├── Консервативная логика   ├── YouTube Data API v3     ├── RDAP ICANN (com, net, org, io, ai)
 ├── TAKEN: публичный профиль├── Fallback: public web    └── WHOIS TCP Socket: whois.cctld.uz:43
 └── UNKNOWN: t.me contact   └── Confidence: 0.95-1.0    └── Parallel multi-TLD check
```

---

## 2. Поддерживаемые платформы и источники данных

| Платформа | Источник данных | Логика статусов |
| :--- | :--- | :--- |
| **Telegram** | Публичный DOM парсер `t.me/<name>` | **TAKEN**: Наличие кнопок действий, фото, подписчиков.<br>**UNKNOWN**: Текст «contact @...» (так как публичный веб не гарантирует отсутствие приватного пользователя без MTProto).<br>**ERROR/RATE_LIMITED**: 429/500/Таймаут. Никаких оптимистичных AVAILABLE. |
| **YouTube** | Официальный **YouTube Data API v3** (`forHandle`) + Web fallback (`/@handle`) | **TAKEN**: `items.length > 0` или страница профиля 200 OK.<br>**AVAILABLE**: Официальный API вернул 0 items (уникальный хэндл свободен) или веб 404.<br>**RATE_LIMITED**: HTTP 429 / QuotaExceeded. |
| **Domains (.com, .net, .org, .io, .ai)** | Авторитетные **RDAP реестры** (RFC 7480/7484) | **TAKEN**: HTTP 200.<br>**AVAILABLE**: HTTP 404 авторитетного реестра.<br>**RATE_LIMITED**: HTTP 429. |
| **Domain (.uz)** | Прямой **TCP WHOIS сокет** к `whois.cctld.uz:43` | **TAKEN**: Ответ содержит `"Status: ACTIVE"`, `"Domain Name: "`<br>**AVAILABLE**: Ответ содержит `"No match found"` / `"not found"`. |

---

## 3. Ключевые возможности Phase 1B

1. **Консервативная точность (Zero Optimistic Availability):**
   - Никакой таймаут, сетевой сбой, HTTP 429 или неоднозначный HTML-ответ никогда не мапится в `AVAILABLE`.
2. **Изоляция сбоев (Fault Isolation):**
   - Проверки выполняются параллельно через `Promise.allSettled`. Сбой одного чекера (например, таймаут YouTube API) не прерывает проверку Telegram и доменов.
3. **Single-Flight Coalescing (Дедупликация на лету):**
   - При одновременном поступлении десятков запросов на одно и то же имя выполняется ровно **один** внешний сетевой запрос; остальные ожидают общий Promise.
4. **Централизованный Cache-Aside в Redis:**
   - Настраиваемые TTL: Telegram (30 мин), YouTube (60 мин), Домены (60 мин), Ошибки/UNKNOWN (60 сек).
   - Результат возвращает флаг `cached: true` и `cacheAgeMs`.
5. **Multi-TLD проверка доменов:**
   - Параллельная валидация до 6 доменных зон одновременно (`.com`, `.net`, `.org`, `.io`, `.ai`, `.uz`).
6. **Метрики и Observability:**
   - Эндпоинт `/health` отдает счетчики: `checksTotal`, `cacheHits`, `cacheMisses`, `checkerErrors`.
   - Запись в БД `platform_checks` только для уникальных внешних запросов (кэш-хиты не засоряют БД).

---

## 4. API Эндпоинты

### `POST /check`
**Request:**
```json
{
  "query": "novexa",
  "platforms": ["TELEGRAM", "YOUTUBE", "DOMAIN"],
  "tlds": ["com", "ai", "uz"]
}
```

**Response:**
```json
{
  "query": "novexa",
  "results": [
    {
      "platform": "TELEGRAM",
      "username": "novexa",
      "status": "TAKEN",
      "confidence": 0.95,
      "source": "TELEGRAM_WEB_PUBLIC",
      "responseTimeMs": 142
    },
    {
      "platform": "YOUTUBE",
      "username": "novexa",
      "status": "AVAILABLE",
      "confidence": 0.95,
      "source": "YOUTUBE_DATA_API_V3",
      "responseTimeMs": 210
    },
    {
      "platform": "DOMAIN",
      "username": "novexa.com",
      "status": "TAKEN",
      "confidence": 1.0,
      "source": "RDAP_COM",
      "responseTimeMs": 95,
      "cached": true,
      "cacheAgeMs": 4200
    },
    {
      "platform": "DOMAIN",
      "username": "novexa.uz",
      "status": "AVAILABLE",
      "confidence": 0.95,
      "source": "WHOIS_CCTLD_UZ",
      "responseTimeMs": 320
    }
  ]
}
```

---

## 5. Тестирование

Запуск полного набора из 51 теста (модульные, интеграционные, контрактные, single-flight, кэш):
```bash
npm test
```

Результат:
```
 ✓ packages/checker-engine/test/youtube.checker.test.ts (12 tests)
 ✓ packages/checker-engine/test/domain.checker.test.ts (12 tests)
 ✓ packages/checker-engine/test/telegram.checker.test.ts (12 tests)
 ✓ packages/checker-engine/test/coordinator.test.ts (4 tests)
 ✓ apps/api/test/auth.test.ts (4 tests)
 ✓ apps/api/test/check.test.ts (2 tests)
 ✓ apps/api/test/health.test.ts (1 test)
 ✓ apps/api/test/multi-check.test.ts (4 tests)

 Test Files  8 passed (8)
      Tests  51 passed (51)
```
