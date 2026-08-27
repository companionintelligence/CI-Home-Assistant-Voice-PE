// API key auth is enforced in every environment (it is not gated on NODE_ENV),
// so the suite has to configure a master key the way a real deployment does.
// This runs before src/config.ts is imported, which reads the env once.
process.env.MASTER_API_KEY = 'test-key';
