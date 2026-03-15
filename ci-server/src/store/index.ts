/**
 * Conversation store – wraps PostgreSQL and Redis for persistence and caching.
 *
 * In production use, ensure DATABASE_URL and REDIS_URL are set.
 * If the DB is unavailable the store degrades gracefully (in-memory fallback).
 */

import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { logger } from '../logger';

let pool: Pool | null = null;
let redisClient: RedisClientType | null = null;

export async function initStore(): Promise<void> {
  try {
    pool = new Pool({ connectionString: config.databaseUrl });
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.warn('PostgreSQL unavailable, store degraded', { error: (err as Error).message });
    pool = null;
  }

  try {
    redisClient = createClient({ url: config.redisUrl }) as RedisClientType;
    redisClient.on('error', (err: Error) => {
      logger.warn('Redis error', { error: err.message });
    });
    await redisClient.connect();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis unavailable, store degraded', { error: (err as Error).message });
    redisClient = null;
  }
}

export async function closeStore(): Promise<void> {
  if (pool) await pool.end();
  if (redisClient) await redisClient.quit();
}

export interface ConversationMessage {
  id?: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt?: Date;
  provider?: string;
}

/** Persist a message to the store. No-ops if DB is unavailable. */
export async function saveMessage(msg: ConversationMessage): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content_json, provider, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [msg.conversationId, msg.role, JSON.stringify({ text: msg.content }), msg.provider || null]
    );
  } catch (err) {
    logger.warn('Failed to save message', { error: (err as Error).message });
  }
}

/** Retrieve conversation history from the store. */
export async function getConversationMessages(
  conversationId: string
): Promise<ConversationMessage[]> {
  if (!pool) return [];
  try {
    const result = await pool.query<{
      id: string;
      conversation_id: string;
      role: string;
      content_json: { text: string };
      created_at: Date;
      provider: string;
    }>(
      `SELECT id, conversation_id, role, content_json, created_at, provider
       FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content_json?.text || '',
      createdAt: row.created_at,
      provider: row.provider,
    }));
  } catch (err) {
    logger.warn('Failed to get messages', { error: (err as Error).message });
    return [];
  }
}

/** Cache a short-lived value in Redis (for SSE stream mapping, quotas, etc.). */
export async function cacheSet(key: string, value: string, ttlSeconds = 3600): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.set(key, value, { EX: ttlSeconds });
  } catch (err) {
    logger.warn('Redis set failed', { key, error: (err as Error).message });
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    logger.warn('Redis get failed', { key, error: (err as Error).message });
    return null;
  }
}
