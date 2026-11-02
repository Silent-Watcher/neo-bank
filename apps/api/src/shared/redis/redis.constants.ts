// Injection token for the ioredis client provider. Internal to the Redis
// module: consumers never import this symbol directly — they use the
// RedisService or the InjectRedis() decorator.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
