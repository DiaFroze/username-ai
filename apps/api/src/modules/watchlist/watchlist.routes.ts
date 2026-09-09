import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WatchlistService } from './watchlist.service.js';
import { CreateWatchlistDto, UpdateWatchlistDto, TelegramUser } from '@username/shared';

export function registerWatchlistRoutes(
  app: FastifyInstance,
  watchlistService: WatchlistService,
  extractUser: (request: FastifyRequest) => TelegramUser | null
) {
  // Authentication middleware guard
  const requireAuth = (request: FastifyRequest, reply: FastifyReply): TelegramUser | null => {
    const user = extractUser(request);
    if (!user) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required to manage watchlist',
      });
      return null;
    }
    return user;
  };

  // 1. POST /api/v1/watchlist
  app.post(
    '/api/v1/watchlist',
    async (request: FastifyRequest<{ Body: CreateWatchlistDto }>, reply: FastifyReply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const body = request.body || ({} as CreateWatchlistDto);
      try {
        const item = await watchlistService.create(String(user.id), body);
        return reply.status(201).send(item);
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'WatchlistError',
          message: err.message,
        });
      }
    }
  );

  // 1b. POST /api/v1/watchlist/batch (Atomic quota preflight)
  app.post(
    '/api/v1/watchlist/batch',
    async (
      request: FastifyRequest<{
        Body: {
          items: Array<{ target?: string; username?: string; platform: any; tld?: any }>;
        };
      }>,
      reply: FastifyReply
    ) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const { items } = request.body || {};
      if (!items || !Array.isArray(items) || items.length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'BadRequest',
          message: 'Field "items" must be a non-empty array of watchlist items',
        });
      }

      try {
        const result = await watchlistService.createBatch(String(user.id), items);
        return reply.status(201).send(result);
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'WatchlistError',
          message: err.message,
        });
      }
    }
  );

  // 2. GET /api/v1/watchlist
  app.get('/api/v1/watchlist', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    try {
      const items = await watchlistService.list(String(user.id));
      return reply.status(200).send({ items, total: items.length });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: 'WatchlistError',
        message: err.message,
      });
    }
  });

  // 3. DELETE /api/v1/watchlist/:id
  app.delete(
    '/api/v1/watchlist/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const { id } = request.params;
      try {
        const result = await watchlistService.delete(String(user.id), id);
        return reply.status(200).send(result);
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: 'WatchlistError',
          message: err.message,
        });
      }
    }
  );

  // 4. PATCH /api/v1/watchlist/:id
  app.patch(
    '/api/v1/watchlist/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateWatchlistDto }>,
      reply: FastifyReply
    ) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const { id } = request.params;
      const body = request.body || {};
      try {
        const item = await watchlistService.update(String(user.id), id, body);
        return reply.status(200).send(item);
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: 'WatchlistError',
          message: err.message,
        });
      }
    }
  );

  // 5. POST /api/v1/watchlist/:id/check-now
  app.post(
    '/api/v1/watchlist/:id/check-now',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = requireAuth(request, reply);
      if (!user) return;

      const { id } = request.params;
      try {
        const result = await watchlistService.checkNow(String(user.id), id);
        return reply.status(200).send(result);
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: 'WatchlistError',
          message: err.message,
        });
      }
    }
  );
}
