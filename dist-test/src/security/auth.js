import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
function getAuthDir() {
    const base = process.env.SAI_DATA_DIR ? join(process.env.SAI_DATA_DIR, '.s-ai') : join(homedir(), '.s-ai');
    const dir = join(base, 'auth');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function getTokenPath() {
    return join(getAuthDir(), 'server-token.json');
}
function loadOrCreateToken() {
    const tokenPath = getTokenPath();
    if (existsSync(tokenPath)) {
        try {
            const stored = JSON.parse(readFileSync(tokenPath, 'utf8'));
            if (stored.token && stored.token.length >= 32)
                return stored.token;
        }
        catch { }
    }
    const token = `s-ai-${randomBytes(32).toString('hex')}`;
    const data = { token, createdAt: new Date().toISOString() };
    writeFileSync(tokenPath, JSON.stringify(data, null, 2));
    return token;
}
function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export function getAuthConfig() {
    const tokenPath = getTokenPath();
    if (existsSync(tokenPath)) {
        return { mode: 'lan', tokenFile: tokenPath };
    }
    return { mode: 'local' };
}
export function generateAuthToken() {
    return loadOrCreateToken();
}
export function createAuthMiddleware(config) {
    const resolved = config ?? getAuthConfig();
    // Configurable auth via environment variables (useful for serverless/CI where the
    // filesystem token file is ephemeral and a deterministic token is required):
    //   SAI_AUTH_MODE=off           -> disable bearer auth entirely
    //   SAI_API_KEY=<token>         -> require exactly this bearer token (deterministic)
    //   SAI_AUTH_TOKEN=<token>      -> alias for SAI_API_KEY
    const envMode = process.env.SAI_AUTH_MODE;
    const envToken = process.env.SAI_API_KEY || process.env.SAI_AUTH_TOKEN;
    if (envMode === 'off') {
        return (_req, _res, next) => next();
    }
    const token = (envToken && envToken.length >= 1 && envToken) ||
        loadOrCreateToken();
    return (req, res, next) => {
        if (req.path === '/health' || req.path === '/api/status') {
            return next();
        }
        const authHeader = req.headers.authorization;
        const queryToken = req.query.token;
        let providedToken;
        if (authHeader?.startsWith('Bearer ')) {
            providedToken = authHeader.slice(7);
        }
        else if (queryToken) {
            providedToken = queryToken;
        }
        if (!providedToken) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Provide a Bearer token via Authorization header or ?token= query parameter',
                hint: 'Run `s-ai token` to view your server token'
            });
        }
        const providedHash = hashToken(providedToken);
        const expectedHash = hashToken(token);
        if (providedHash !== expectedHash) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        next();
    };
}
export function revokeToken() {
    const tokenPath = getTokenPath();
    if (existsSync(tokenPath)) {
        unlinkSync(tokenPath);
    }
}
export { hashToken };
//# sourceMappingURL=auth.js.map