import { appConfig } from './config/env.js';
import { buildApp } from './app.js';
import { runMigrations } from '@username/db';

const PORT = appConfig.PORT;
const HOST = appConfig.HOST;

async function bootstrap() {
  if (appConfig.DATABASE_URL) {
    try {
      console.log('🔄 Checking and applying database migrations...');
      await runMigrations({ databaseUrl: appConfig.DATABASE_URL });
      console.log('✅ Database migrations verified and applied.');
    } catch (err: any) {
      console.error('❌ Failed to apply database migrations:', err.message);
      process.exit(1);
    }
  }

  const app = buildApp({
    logger: true,
    databaseUrl: appConfig.DATABASE_URL,
    redisUrl: appConfig.REDIS_URL,
    botToken: appConfig.TELEGRAM_BOT_TOKEN,
    jwtSecret: appConfig.JWT_SECRET,
    enableBackgroundScheduler: true,
  });

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.log.info({ signal }, 'Received shutdown signal, draining in-flight requests and stopping services...');

    const forceExitTimer = setTimeout(() => {
      app.log.error('Graceful shutdown timeout exceeded (10s), forcing immediate process exit');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      await app.close();
      app.log.info('All server connections and background workers stopped cleanly. Process exiting.');
      process.exit(0);
    } catch (err: any) {
      app.log.error({ err: err.message }, 'Error occurred during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`🚀 Username AI Backend API is listening on http://${HOST}:${PORT}`);
  } catch (err: any) {
    app.log.error(err, 'Failed to start API server');
    process.exit(1);
  }
}

void bootstrap();
