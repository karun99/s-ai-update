# S-AI v6.1 — Server Security Integration Guide

## Overview

This document shows how to integrate the security modules into `src/server.ts`.

## Changes Required

### 1. Add Security Imports

```typescript
import { createAuthMiddleware, generateAuthToken } from './security/auth.js';
import { safeFetch, isPrivateUrl } from './security/ssrf.js';
import { SecureExecutionEngine } from './security/registry-executor.js';
```

### 2. Apply Auth Middleware

After the CORS middleware and before route handlers:

```typescript
// After existing CORS middleware:
app.use((req: Request, res: Response, next: () => void) => {
  // ... existing CORS code ...
});

// Add authentication:
const authMiddleware = createAuthMiddleware();
app.use(authMiddleware);
```

### 3. Replace Crawl SSRF Check

Replace the existing `isPrivateUrl` function with the hardened version:

```typescript
// Remove the old isPrivateUrl function
// Import the new one from security/ssrf.ts
import { isPrivateUrl } from './security/ssrf.js';
```

### 4. Add Rate Limiting

```typescript
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function rateLimitMiddleware(maxRequests = 100, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimits.get(ip);

    if (entry && entry.resetAt > now) {
      if (entry.count >= maxRequests) {
        return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: Math.ceil((entry.resetAt - now) / 1000) });
      }
      entry.count++;
    } else {
      rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    }
    next();
  };
}

app.use(rateLimitMiddleware());
```

### 5. Add Token Endpoint

```typescript
app.get('/api/token', (req: Request, res: Response) => {
  const token = generateAuthToken();
  res.json({
    token,
    usage: 'Add as Authorization: Bearer <token> header or ?token=<token> query parameter',
    note: 'This token is stored at ~/.s-ai/auth/server-token.json'
  });
});
```

### 6. Replace AI Call with Safe Fetch

In the `/api/ai/call` endpoint, replace bare `fetch` calls with `safeFetch`:

```typescript
// Before:
const resp = await fetch('https://api.anthropic.com/v1/messages', { ... });

// After:
const resp = await safeFetch('https://api.anthropic.com/v1/messages', { ... });
```

### 7. Update Crawl Endpoint

```typescript
app.post('/api/crawl', async (req: Request, res: Response) => {
  try {
    const { urls, query } = req.body;
    const urlList = Array.isArray(urls) ? urls : [];

    // Use hardened SSRF validation
    for (const u of urlList) {
      const validation = await isPrivateUrl(u);
      if (validation) return res.status(400).json({ error: `Blocked URL: ${u}` });
    }

    // Use safeFetch for the crawl engine
    const { getCrawlEngine } = await import('./tools/crawl.js');
    const engine = getCrawlEngine();
    const results = query
      ? await engine.search(query, { maxResults: 5 })
      : await engine.crawl(urlList);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

### 8. Add Security Headers

```typescript
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'");
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
```

## Configuration

Set `SAI_AUTH_MODE` environment variable:
- `local` (default): Token auto-generated, for localhost use
- `lan`: Token required for all API calls (for LAN/remote access)
- `off`: No authentication (development only)

## Token Management

```bash
# View current token
s-ai token

# Generate new token
s-ai token --rotate

# Revoke token
s-ai token --revoke
```
