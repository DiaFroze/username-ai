import { Redis } from 'ioredis';

let redisInstance: Redis | null = null;

export function getRedisClient(url?: string): Redis {
  if (!redisInstance) {
    const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
  }
  return redisInstance;
}

export interface RedisHealth {
  status: 'UP' | 'DOWN';
  latencyMs?: number;
  error?: string;
}

export async function checkRedisHealth(url?: string): Promise<RedisHealth> {
  const start = Date.now();
  try {
    const redis = getRedisClient(url);
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const pong = await redis.ping();
    if (pong === 'PONG') {
      return {
        status: 'UP',
        latencyMs: Date.now() - start,
      };
    }
    return {
      status: 'DOWN',
      latencyMs: Date.now() - start,
      error: `Unexpected response: ${pong}`,
    };
  } catch (err: any) {
    return {
      status: 'DOWN',
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

export async function closeRedisClient(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
