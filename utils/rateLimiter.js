/**
 * Simple in-memory rate limiter
 * Tracks request counts per IP address with sliding window
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000;
    this.maxRequests = options.max || 100;
    this.message = options.message || "Слишком много запросов, попробуйте позже";
    this.statusCode = options.statusCode || 429;
    this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
    this.skipFailedRequests = options.skipFailedRequests || false;
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  middleware() {
    const limiter = this;
    return (req, res, next) => {
      const ip = limiter.getClientIp(req);
      const now = Date.now();

      if (!limiter.requests.has(ip)) {
        limiter.requests.set(ip, []);
      }

      const userRequests = limiter.requests.get(ip);
      const validRequests = userRequests.filter(r => now - r.timestamp < limiter.windowMs);
      limiter.requests.set(ip, validRequests);

      if (validRequests.length >= limiter.maxRequests) {
        const oldestRequest = validRequests[0];
        const retryAfter = Math.ceil((limiter.windowMs - (now - oldestRequest.timestamp)) / 1000);

        res.set("Retry-After", retryAfter);
        res.set("X-RateLimit-Limit", limiter.maxRequests);
        res.set("X-RateLimit-Remaining", 0);
        res.set("X-RateLimit-Reset", new Date(oldestRequest.timestamp + limiter.windowMs).toISOString());

        return res.status(limiter.statusCode).json({
          error: limiter.message,
          retryAfter: retryAfter + " секунд"
        });
      }

      const requestEntry = { timestamp: now, success: null };
      validRequests.push(requestEntry);

      res.set("X-RateLimit-Limit", limiter.maxRequests);
      res.set("X-RateLimit-Remaining", limiter.maxRequests - validRequests.length);
      res.set("X-RateLimit-Reset", new Date(now + limiter.windowMs).toISOString());

      if (limiter.skipSuccessfulRequests || limiter.skipFailedRequests) {
        const originalSend = res.send;
        res.send = function(data) {
          requestEntry.success = res.statusCode < 400;

          if ((requestEntry.success && limiter.skipSuccessfulRequests) ||
              (!requestEntry.success && limiter.skipFailedRequests)) {
            const index = validRequests.indexOf(requestEntry);
            if (index > -1) {
              validRequests.splice(index, 1);
            }
          }

          return originalSend.call(res, data);
        };
      }

      next();
    };
  }

  getClientIp(req) {
    return req.ip ||
           req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
           req.headers["x-real-ip"] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           "unknown";
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [ip, requests] of this.requests.entries()) {
      const validRequests = requests.filter(r => now - r.timestamp < this.windowMs);

      if (validRequests.length === 0) {
        this.requests.delete(ip);
        cleaned++;
      } else {
        this.requests.set(ip, validRequests);
      }
    }

    if (cleaned > 0) {
      console.log("[RateLimiter] Очищено " + cleaned + " устаревших записей");
    }
  }

  getStats() {
    return {
      totalIPs: this.requests.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      activeRequests: Array.from(this.requests.values()).reduce((sum, reqs) => sum + reqs.length, 0)
    };
  }

  resetIp(ip) {
    return this.requests.delete(ip);
  }

  resetAll() {
    this.requests.clear();
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

function createRateLimiter(options) {
  return new RateLimiter(options);
}

function createAuthLimiter() {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Слишком много попыток входа, попробуйте через 15 минут",
    skipSuccessfulRequests: true
  });
}

function createApiLimiter() {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Слишком много запросов к API, попробуйте позже"
  });
}

function createStrictLimiter() {
  return createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: "Достигнут лимит создания ресурсов, попробуйте через час"
  });
}

module.exports = {
  RateLimiter,
  createRateLimiter,
  createAuthLimiter,
  createApiLimiter,
  createStrictLimiter
};
