import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';

// Fail closed: without a master key every /v1 request is refused with 503.
// Say so loudly at boot rather than letting the operator discover it request
// by request.
if (!config.masterApiKey) {
  logger.error(
    'MASTER_API_KEY is not set – all /v1 endpoints will refuse requests. Set MASTER_API_KEY (see .env.example) before serving traffic.'
  );
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`ci-server listening on port ${config.port}`, {
    env: config.nodeEnv,
    ollamaBaseUrl: config.ollamaBaseUrl,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

export { app };
