import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
  CheckerCoordinator,
  RedisCacheStore,
  ICacheStore,
  CheckerCacheConfig,
} from '@username/checker-engine';
import {
  NamingService,
  createAIProvider,
  AiNamingCache,
  IAIProvider,
  AdvisorService,
} from '@username/ai-engine';
import {
  WatchlistService,
  NotificationService,
  WatchlistQueueManager,
  registerWatchlistRoutes,
} from './modules/watchlist/index.js';
import { checkDatabaseHealth, getDb, users, searches, platformChecks, eq, closeDbPool } from '@username/db';
import { checkRedisHealth, getRedisClient, closeRedisClient } from './modules/redis/redis.client.js';
import { validateTelegramInitData } from './modules/auth/telegram-validator.js';
import {
  TelegramAuthPayload,
  CheckUsernameDto,
  TelegramUser,
  MultiCheckRequest,
  MultiCheckResponse,
  NamingPipelineRequest,
  Platform,
  CheckStatus,
  WatchlistItem,
  AdvisorChatRequest,
  AdvisorChatResponse,
} from '@username/shared';

export interface AppOptions {
  botToken?: string;
  jwtSecret?: string;
  databaseUrl?: string;
  redisUrl?: string;
  customTelegramChecker?: TelegramChecker;
  customYouTubeChecker?: YouTubeChecker;
  customDomainChecker?: DomainChecker;
  customCoordinator?: CheckerCoordinator;
  customCacheStore?: ICacheStore;
  customNamingService?: NamingService;
  customAdvisorService?: AdvisorService;
  customAIProvider?: IAIProvider;
  customWatchlistService?: WatchlistService;
  customNotificationService?: NotificationService;
  customQueueManager?: WatchlistQueueManager;
  enableBackgroundScheduler?: boolean;
  cacheConfig?: Partial<CheckerCacheConfig>;
  logger?: boolean;
  loggerStream?: any;
  rateLimitMax?: number;
  rateLimitTimeWindow?: string | number;
  rateLimitAuthMax?: number;
  rateLimitCheckMax?: number;
  rateLimitNamingMax?: number;
}

export interface AppMetrics {
  checksTotal: number;
  cacheHits: number;
  cacheMisses: number;
  checkerErrors: number;
  aiRequests: number;
  aiFailures: number;
  aiCacheHits: number;
  watchItemsActive: number;
  watchChecksTotal: number;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN || 'MOCK_BOT_TOKEN';
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'dev-secret-jwt-key-minimum-32-chars-long';

  // Internal metrics registry
  const metrics: AppMetrics = {
    checksTotal: 0,
    cacheHits: 0,
    cacheMisses: 0,
    checkerErrors: 0,
    aiRequests: 0,
    aiFailures: 0,
    aiCacheHits: 0,
    watchItemsActive: 0,
    watchChecksTotal: 0,
  };

  // Cache setup
  const cacheStore: ICacheStore =
    options.customCacheStore || new RedisCacheStore(getRedisClient(options.redisUrl));

  // Coordinator setup
  const coordinator =
    options.customCoordinator ||
    new CheckerCoordinator({
      telegramChecker: options.customTelegramChecker,
      youtubeChecker: options.customYouTubeChecker,
      domainChecker: options.customDomainChecker,
      cache: cacheStore,
      cacheConfig: options.cacheConfig,
    });

  // Naming Service setup (Phase 1C)
  const aiProvider = options.customAIProvider || createAIProvider();
  const aiCache = new AiNamingCache(cacheStore);
  const namingService =
    options.customNamingService ||
    new NamingService({
      aiProvider,
      coordinator,
      aiCache,
    });

  const advisorService =
    options.customAdvisorService ||
    new AdvisorService();

  // Notification & Watchlist Engine setup (Phase 1D)
  const notificationService =
    options.customNotificationService ||
    new NotificationService({
      botToken,
      databaseUrl: options.databaseUrl,
    });

  const watchlistService =
    options.customWatchlistService ||
    new WatchlistService({
      coordinator,
      databaseUrl: options.databaseUrl,
      notificationService,
    });

  const queueManager =
    options.customQueueManager ||
    new WatchlistQueueManager({
      watchlistService,
      redisUrl: options.redisUrl,
      databaseUrl: options.databaseUrl,
    });

  if (options.enableBackgroundScheduler) {
    queueManager.start().catch((err) => {
      console.warn('⚠️ [WatchlistQueue] Background scheduler start failed:', err.message);
    });
  }

  const app = Fastify({
    logger: options.logger === false
      ? false
      : {
          level: process.env.LOG_LEVEL || 'info',
          stream: options.loggerStream,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers["x-telegram-user-id"]',
              'req.body.initData',
              'req.body.token',
              'req.body.apiKey',
              'body.initData',
              'body.token',
              'body.apiKey',
              'headers.authorization',
              'apiKey',
              'token',
              'initData',
              'authorization',
              '*.apiKey',
              '*.token',
              '*.initData',
              '*.authorization',
            ],
            censor: '[REDACTED]',
          },
        },
    bodyLimit: 1048576, // 1MB payload limit
    genReqId: () => crypto.randomUUID(),
  });

  // 1. Helmet security headers (Tailored CSP with Telegram Mini App frameAncestors)
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: ["'self'", 'https:', 'wss:'],
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org', 'tg:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // 2. CORS allowlist
  const rawOrigins = process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173,https://web.telegram.org';
  const allowedOriginList = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);

  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const isAllowed = allowedOriginList.some(allowed => {
        if (allowed === '*') return true;
        if (allowed === origin) return true;
        if (origin.endsWith('.telegram.org')) return true;
        if (origin.startsWith('http://localhost:')) return true;
        return false;
      });
      if (isAllowed) return cb(null, true);
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Helper to extract JWT if present and cryptographically verified
  function extractUser(request: FastifyRequest): TelegramUser | null {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    try {
      const token = authHeader.substring(7);
      return jwt.verify(token, jwtSecret) as TelegramUser;
    } catch {
      return null;
    }
  }

  // 3. Rate limiting with verified user-first key generator (never trust client headers)
  app.register(rateLimit, {
    max: options.rateLimitMax ?? 120,
    timeWindow: options.rateLimitTimeWindow ?? '1 minute',
    keyGenerator: (req) => {
      const user = extractUser(req);
      if (user && user.id) {
        return `user:${user.id}`;
      }
      return `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'TooManyRequests',
      message: `Rate limit exceeded. Please try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  // Global Error Handler
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      request.log.error({
        reqId: request.id,
        err: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }, 'Unhandled request error');
    }

    const errorName = error.error || (statusCode === 429 ? 'TooManyRequests' : (error.name && error.name !== 'Error' ? error.name : 'InternalServerError'));

    reply.status(statusCode).send({
      statusCode,
      error: errorName,
      message: statusCode === 500 ? 'Internal Server Error' : error.message,
      requestId: request.id,
    });
  });

  app.register(async (api) => {
    // 1. Health check: Liveness probe
    api.get('/health/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

    // 2. Health check: Readiness probe
    api.get('/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
      const dbHealth = await checkDatabaseHealth(options.databaseUrl);
      const redisHealth = await checkRedisHealth(options.redisUrl);
      const queueHealth = queueManager.getHealthStatus();

      const isProductionOrStaging = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

      let isReady = dbHealth.status === 'UP';
      if (isProductionOrStaging) {
        isReady = isReady && redisHealth.status === 'UP' && queueHealth.status === 'UP';
      } else if (process.env.NODE_ENV !== 'test') {
        isReady = isReady && (redisHealth.status === 'UP' || queueHealth.status !== 'DOWN');
      }

      const payload = {
        status: isReady ? 'ready' : 'degraded',
        checks: {
          database: dbHealth.status,
          redis: redisHealth.status,
          queue: queueHealth.status,
        },
        timestamp: new Date().toISOString(),
      };

      return reply.status(isReady ? 200 : 503).send(payload);
    });

    // 3. Health check: Comprehensive status & metrics (Sanitized for unauthenticated callers)
    api.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      const dbHealth = await checkDatabaseHealth(options.databaseUrl);
      const redisHealth = await checkRedisHealth(options.redisUrl);
      const queueHealth = queueManager.getHealthStatus();

      const isAllHealthy = dbHealth.status === 'UP' && redisHealth.status === 'UP';

      // Verify if caller is authenticated or provides internal admin token
      const authUser = extractUser(request);
      const internalHeader = request.headers['x-internal-token'];
      const isInternal =
        authUser ||
        (internalHeader &&
          internalHeader === (process.env.INTERNAL_ADMIN_TOKEN || 'staging-internal-admin-secret'));

      if (!isInternal) {
        return reply.status(200).send({
          status: isAllHealthy ? 'UP' : 'DEGRADED',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
        });
      }

      const response = {
        status: isAllHealthy ? 'UP' : 'DEGRADED',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        services: {
          api: { status: 'UP' },
          postgres: dbHealth,
          redis: redisHealth,
          queue: queueHealth,
          aiEngine: {
            status: 'UP',
            provider: process.env.AI_PROVIDER || 'mock',
          },
          watchlist: { status: 'UP' },
        },
        metrics,
      };

      return reply.status(200).send(response);
    });

  // 2. Telegram Auth endpoint (Validates Telegram Mini App initData)
  const handleTelegramAuth = async (request: FastifyRequest<{ Body: TelegramAuthPayload }>, reply: FastifyReply) => {
    const { initData } = request.body || {};

    if (!initData) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "initData" is required',
      });
    }

    const validation = validateTelegramInitData(initData, botToken);

    if (!validation.valid || !validation.user) {
      request.log.warn({ reqId: request.id, error: validation.error }, 'Failed initData authentication');
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: validation.error || 'Invalid Telegram authentication data',
      });
    }

    const user = validation.user;

    // Persist or update user in PostgreSQL if available
    let internalUserId: string | null = null;
    try {
      const db = getDb(options.databaseUrl);
      const existing = await db.select().from(users).where(eq(users.telegramId, user.id)).limit(1);

      if (existing.length === 0) {
        const [inserted] = await db.insert(users).values({
          telegramId: user.id,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          languageCode: user.language_code,
        }).returning({ id: users.id });
        internalUserId = inserted?.id ?? null;
      } else {
        internalUserId = existing[0].id;
        await db.update(users).set({
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          languageCode: user.language_code,
          updatedAt: new Date(),
        }).where(eq(users.telegramId, user.id));
      }
    } catch (err: any) {
      request.log.warn({ reqId: request.id, err: err.message }, 'Could not persist user to DB (DB might be offline)');
    }

    // Issue JWT session token
    const token = jwt.sign(
      {
        id: internalUserId || user.id,
        telegram_id: user.id,
        dbId: internalUserId || undefined,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        language_code: user.language_code,
      },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return reply.status(200).send({
      token,
      user,
    });
  };

    const authRateLimitConfig = {
      config: {
        rateLimit: {
          max: options.rateLimitAuthMax ?? options.rateLimitMax ?? (process.env.RATE_LIMIT_AUTH_MAX ? Number(process.env.RATE_LIMIT_AUTH_MAX) : 10),
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => `ip:${req.ip}`,
        },
      },
    };

    api.post('/api/v1/auth/telegram', authRateLimitConfig, handleTelegramAuth);
    api.post('/auth/telegram', authRateLimitConfig, handleTelegramAuth);

  // 3. Multi-platform Check endpoint (Phase 1B & Standardized API v1)
  const handleMultiCheck = async (request: FastifyRequest<{ Body: MultiCheckRequest }>, reply: FastifyReply) => {
    const { query, platforms, tlds } = request.body || {};

    if (!query || typeof query !== 'string' || !query.trim()) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "query" is required and must be a non-empty string',
      });
    }

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "platforms" must be a non-empty array of platforms',
      });
    }

    const authUser = extractUser(request);
    if (!authUser) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required. Please authenticate via /api/v1/auth/telegram',
      });
    }

    const response: MultiCheckResponse = await coordinator.check({
      query: query.trim(),
      platforms,
      tlds,
    });

    // Observability & Metrics update
    for (const r of response.results) {
      metrics.checksTotal++;
      if (r.cached) {
        metrics.cacheHits++;
      } else {
        metrics.cacheMisses++;
      }
      if (r.status === CheckStatus.ERROR) {
        metrics.checkerErrors++;
      }

      request.log.info({
        reqId: request.id,
        platform: r.platform,
        username: r.username,
        status: r.status,
        duration: r.responseTimeMs,
        cacheHit: !!r.cached,
      }, 'Checker execution completed');
    }

    // Asynchronous database persistence only for non-cached items (prevents DB bloat)
    if (authUser) {
      const nonCachedResults = response.results.filter(r => !r.cached);
      if (nonCachedResults.length > 0) {
        void (async () => {
          try {
            const db = getDb(options.databaseUrl);
            const [dbUser] = await db.select().from(users).where(eq(users.telegramId, authUser.id)).limit(1);
            if (dbUser) {
              const [searchRecord] = await db.insert(searches).values({
                userId: dbUser.id,
                query: query.trim(),
              }).returning();

              for (const r of nonCachedResults) {
                await db.insert(platformChecks).values({
                  searchId: searchRecord?.id,
                  platform: r.platform,
                  username: r.username,
                  status: r.status,
                  confidence: r.confidence.toFixed(2),
                  source: r.source,
                  responseTimeMs: r.responseTimeMs,
                });
              }
            }
          } catch (err: any) {
            request.log.debug({ err: err.message }, 'Failed async DB logging of multi-check');
          }
        })();
      }
    }

    return reply.status(200).send(response);
  };

    const checkRateLimitConfig = {
      config: {
        rateLimit: {
          max: options.rateLimitCheckMax ?? options.rateLimitMax ?? (process.env.RATE_LIMIT_CHECK_MAX ? Number(process.env.RATE_LIMIT_CHECK_MAX) : 30),
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const user = extractUser(req);
            return user?.id ? `user:${user.id}` : `ip:${req.ip}`;
          },
        },
      },
    };

    api.post('/api/v1/check', checkRateLimitConfig, handleMultiCheck);
    api.post('/api/v1/check/batch', checkRateLimitConfig, handleMultiCheck);
    api.post('/check', checkRateLimitConfig, handleMultiCheck);

  // 4. Legacy Telegram-only endpoint for backwards compatibility
  const handleTelegramCheck = async (request: FastifyRequest<{ Body: CheckUsernameDto }>, reply: FastifyReply) => {
    const { username } = request.body || {};

    if (!username || typeof username !== 'string') {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "username" is required and must be a string',
      });
    }

    const authUser = extractUser(request);
    if (!authUser) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required. Please authenticate via /api/v1/auth/telegram',
      });
    }
    const result = await coordinator.checkSingle(Platform.TELEGRAM, username);

    metrics.checksTotal++;
    if (result.cached) {
      metrics.cacheHits++;
    } else {
      metrics.cacheMisses++;
    }
    if (result.status === CheckStatus.ERROR) {
      metrics.checkerErrors++;
    }

    request.log.info({
      reqId: request.id,
      platform: result.platform,
      username: result.username,
      status: result.status,
      duration: result.responseTimeMs,
      cacheHit: !!result.cached,
    }, 'Telegram check completed');

    if (authUser && !result.cached) {
      void (async () => {
        try {
          const db = getDb(options.databaseUrl);
          const [dbUser] = await db.select().from(users).where(eq(users.telegramId, authUser.id)).limit(1);
          if (dbUser) {
            const [searchRecord] = await db.insert(searches).values({
              userId: dbUser.id,
              query: username,
            }).returning();

            await db.insert(platformChecks).values({
              searchId: searchRecord?.id,
              platform: result.platform,
              username: result.username,
              status: result.status,
              confidence: result.confidence.toFixed(2),
              source: result.source,
              responseTimeMs: result.responseTimeMs,
            });
          }
        } catch (err: any) {
          request.log.debug({ err: err.message }, 'Failed async DB logging of search');
        }
      })();
    }

    return reply.status(200).send(result);
  };

    api.post('/api/v1/check/telegram', checkRateLimitConfig, handleTelegramCheck);
    api.post('/check/telegram', checkRateLimitConfig, handleTelegramCheck);

  // 5. AI Naming Generation & Verification Pipeline (Phase 1C)
  const handleNamingGenerate = async (
    request: FastifyRequest<{ Body: NamingPipelineRequest }>,
    reply: FastifyReply
  ) => {
    const { query, intent, category, language, platforms, tlds, count, oneNameEverywhere } =
      request.body || {};

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "query" is required and must be at least 2 characters',
      });
    }

    if (query.trim().length > 100) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "query" must not exceed 100 characters',
      });
    }

    const authUser = extractUser(request);
    if (!authUser) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required. Please authenticate via /api/v1/auth/telegram',
      });
    }

    try {
      const response = await namingService.generateAndCheck({
        query: query.trim(),
        intent: intent || 'BRAND',
        category,
        language: language || 'ru',
        platforms: platforms && platforms.length > 0 ? platforms : [Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN],
        tlds: tlds && tlds.length > 0 ? tlds : ['com', 'uz', 'ai'],
        count: count && count > 0 && count <= 50 ? count : 15,
        oneNameEverywhere: oneNameEverywhere !== false,
      });

      metrics.aiRequests = namingService.metrics.aiRequests;
      metrics.aiFailures = namingService.metrics.aiFailures;
      metrics.aiCacheHits = namingService.metrics.aiCacheHits;

      request.log.info({
        reqId: request.id,
        query: response.query,
        totalCandidates: response.totalCandidates,
        aiCacheHit: response.metrics?.aiCacheHit,
        topCandidate: response.candidates[0]?.name,
        topScore: response.candidates[0]?.brandScore,
      }, 'Naming pipeline executed successfully');

      return reply.status(200).send(response);
    } catch (err: any) {
      request.log.error({ reqId: request.id, err: err.message }, 'Naming pipeline error');
      return reply.status(500).send({
        statusCode: 500,
        error: 'InternalServerError',
        message: 'Failed to generate and check candidates',
      });
    }
  };

    const namingRateLimitConfig = {
      config: {
        rateLimit: {
          max: options.rateLimitNamingMax ?? options.rateLimitMax ?? (process.env.RATE_LIMIT_NAMING_MAX ? Number(process.env.RATE_LIMIT_NAMING_MAX) : 10),
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const user = extractUser(req);
            return user?.id ? `user:${user.id}` : `ip:${req.ip}`;
          },
        },
      },
    };

    api.post('/api/v1/naming/generate', namingRateLimitConfig, handleNamingGenerate);
    api.post('/naming/generate', namingRateLimitConfig, handleNamingGenerate);

  // 5B. AI Branding Advisor & Consultant Agent (Interactive Chat)
  const handleAdvisorConsult = async (
    request: FastifyRequest<{ Body: AdvisorChatRequest }>,
    reply: FastifyReply
  ) => {
    const { messages, language, context } = request.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Field "messages" is required and must be a non-empty array',
      });
    }

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || !lastMsg.content || typeof lastMsg.content !== 'string' || !lastMsg.content.trim()) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Last message content must be a non-empty string',
      });
    }

    if (lastMsg.content.length > 2000) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Message must not exceed 2000 characters',
      });
    }

    try {
      const response = await advisorService.consult({
        messages,
        language: language || 'ru',
        context,
      });

      request.log.info({
        reqId: request.id,
        messagesCount: messages.length,
        mode: response.mode,
        suggestionsCount: response.suggestions?.length || 0,
      }, 'AI Advisor consultation completed');

      return reply.status(200).send(response);
    } catch (err: any) {
      request.log.error({ reqId: request.id, err: err.message }, 'AI Advisor consultation failed');
      return reply.status(500).send({
        statusCode: 500,
        error: 'InternalServerError',
        message: 'Failed to process AI Advisor consultation',
      });
    }
  };

  api.post('/api/v1/naming/advisor', namingRateLimitConfig, handleAdvisorConsult);
  api.post('/api/v1/advisor/chat', namingRateLimitConfig, handleAdvisorConsult);
  api.post('/advisor/chat', namingRateLimitConfig, handleAdvisorConsult);


    // 6. Watchlist & Background Monitoring API (Phase 1D)
    registerWatchlistRoutes(api, watchlistService, extractUser);

    // 7. Controlled Staging Notification Test Endpoint (Strictly Non-Production)
    api.post<{
      Body: {
        telegramId?: number;
        chatId?: number;
        target?: string;
        platform?: Platform;
      };
    }>(
      '/api/v1/staging/test-notification',
      async (request, reply) => {
        if (process.env.NODE_ENV === 'production') {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Endpoint /api/v1/staging/test-notification is disabled in production',
          });
        }

        const authUser = extractUser(request);
        const stagingKeyHeader = request.headers['x-staging-key'];
        const internalTokenHeader = request.headers['x-internal-token'];
        const configuredKey = process.env.STAGING_TEST_KEY || 'staging-test-secret-key-12345';
        const isAuthorized =
          authUser !== null ||
          (typeof stagingKeyHeader === 'string' && stagingKeyHeader === configuredKey) ||
          (typeof internalTokenHeader === 'string' && internalTokenHeader === (process.env.INTERNAL_ADMIN_TOKEN || 'staging-internal-admin-secret'));

        if (!isAuthorized) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Staging authentication required. Provide valid x-staging-key or Authorization Bearer token.',
          });
        }

        const { target, platform, chatId, telegramId } = request.body || {};
        if (!target || !platform) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'BadRequest',
            message: 'Fields "target" and "platform" are required for staging notification test',
          });
        }

        const recipientChatId = chatId || telegramId || (authUser ? authUser.id : 999999);

        const dummyItem: WatchlistItem = {
          id: crypto.randomUUID(),
          userId: authUser ? String(authUser.id) : 'staging-test-user',
          platform,
          target,
          currentStatus: CheckStatus.AVAILABLE,
          previousStatus: CheckStatus.TAKEN,
          lastConfidence: 1.0,
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date().toISOString(),
          checkIntervalMinutes: 60,
          consecutiveErrors: 0,
          consecutiveStableCount: 0,
          isActive: true,
          metadata: null,
          statusVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const dispatchResult = await notificationService.sendNotification({
          watchItemId: dummyItem.id,
          userId: dummyItem.userId,
          telegramChatId: recipientChatId,
          platform: dummyItem.platform,
          target: dummyItem.target,
          eventType: 'STATUS_CHANGED_AVAILABLE',
          oldStatus: CheckStatus.TAKEN,
          newStatus: CheckStatus.AVAILABLE,
          confidence: 1.0,
        });

        return reply.status(200).send({
          success: true,
          dispatched: true,
          delivered: dispatchResult.delivered,
          status: dispatchResult.status,
          idempotencyKey: dispatchResult.idempotencyKey,
          telegramId: recipientChatId,
          recipientChatId,
          target,
          platform,
          dispatchedAt: new Date().toISOString(),
        });
      }
    );
  });

  // Graceful shutdown hook
  app.addHook('onClose', async () => {
    try {
      await queueManager.stop();
    } catch (e: any) {
      app.log.error({ err: e.message }, 'Error stopping WatchlistQueueManager');
    }
    try {
      await closeRedisClient();
    } catch (e: any) {
      app.log.error({ err: e.message }, 'Error closing Redis client');
    }
    try {
      await closeDbPool();
    } catch (e: any) {
      app.log.error({ err: e.message }, 'Error closing PostgreSQL pool');
    }
  });

  return app;
}
