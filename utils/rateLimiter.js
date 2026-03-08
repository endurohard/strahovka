/**
 * Simple in-memory rate limiter
 * Tracks request counts per IP address with sliding window
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 минут по умолчанию
    this.maxRequests = options.max || 100; // 100 запросов по умолчанию
    this.message = options.message || 'Слишком много запросов, попробуйте позже';
    this.statusCode = options.statusCode || 429;
    this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
    this.skipFailedRequests = options.skipFailedRequests || false;

    // Хранилище: { ip: [{ timestamp, success }] }
    this.requests = new Map();

    // Очистка старых записей каждые 5 минут
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const ip = this.getClientIp(req);
      const now = Date.now();

      // Получаем записи для этого IP
      if (!this.requests.has(ip)) {
        this.requests.set(ip, []);
      }

      const userRequests = this.requests.get(ip);

      // Удаляем устаревшие записи (за пределами окна)
      const validRequests = userRequests.filter(r => now - r.timestamp < this.windowMs);
      this.requests.set(ip, validRequests);

      // Проверяем лимит
      if (validRequests.length >= this.maxRequests) {
        const oldestRequest = validRequests[0];
        const retryAfter = Math.ceil((this.windowMs - (now - oldestRequest.timestamp)) / 1000);

        res.set('Retry-After', retryAfter);
        res.set('X-RateLimit-Limit', this.maxRequests);
        res.set('X-RateLimit-Remaining', 0);
        res.set('X-RateLimit-Reset', new Date(oldestRequest.timestamp + this.windowMs).toISOString());

        return res.status(this.statusCode).json({
          error: this.message,
          retryAfter: `${retryAfter} секунд`
        });
      }

      // Добавляем текущий запрос (отметим успех позже)
      const requestEntry = { timestamp: now, success: null };
      validRequests.push(requestEntry);

      // Устанавливаем заголовки rate limit
      res.set('X-RateLimit-Limit', this.maxRequests);
      res.set('X-RateLimit-Remaining', this.maxRequests - validRequests.length);
      res.set('X-RateLimit-Reset', new Date(now + this.windowMs).toISOString());

      // Отслеживаем успешность запроса для опций skipSuccessfulRequests/skipFailedRequests
      if (this.skipSuccessfulRequests || this.skipFailedRequests) {
        const originalSend = res.send;
        res.send = function(data) {
          requestEntry.success = res.statusCode < 400;

          // Удаляем запрос из счетчика если нужно
          if ((requestEntry.success && this.skipSuccessfulRequests) ||
              (!requestEntry.success && this.skipFailedRequests)) {
            const index = validRequests.indexOf(requestEntry);
            if (index > -1) {
              validRequests.splice(index, 1);
            }
          }

          return originalSend.call(this, data);
        }.bind(this);
      }

      next();
    };
  }

  /**
   * Получить IP клиента
   */
  getClientIp(req) {
    return req.ip ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           'unknown';
  }

  /**
   * Очистка старых записей
   */
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
      console.log(`[RateLimiter] Очищено ${cleaned} устаревших записей`);
    }
  }

  /**
   * Получить статистику
   */
  getStats() {
    return {
      totalIPs: this.requests.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      activeRequests: Array.from(this.requests.values()).reduce((sum, reqs) => sum + reqs.length, 0)
    };
  }

  /**
   * Очистить все записи для IP
   */
  resetIp(ip) {
    return this.requests.delete(ip);
  }

  /**
   * Очистить все записи
   */
  resetAll() {
    this.requests.clear();
  }

  /**
   * Завершить работу (остановить cleanup)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Создать rate limiter с настройками
 */
function createRateLimiter(options) {
  return new RateLimiter(options);
}

/**
 * Preset: строгий лимит для авторизации
 */
function createAuthLimiter() {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // 5 попыток
    message: 'Слишком много попыток входа, попробуйте через 15 минут',
    skipSuccessfulRequests: true // Не учитываем успешные попытки
  });
}

/**
 * Preset: средний лимит для API
 */
function createApiLimiter() {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // 100 запросов
    message: 'Слишком много запросов к API, попробуйте позже'
  });
}

/**
 * Preset: жесткий лимит для создания ресурсов
 */
function createStrictLimiter() {
  return createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 час
    max: 10, // 10 запросов
    message: 'Достигнут лимит создания ресурсов, попробуйте через час'
  });
}

module.exports = {
  RateLimiter,
  createRateLimiter,
  createAuthLimiter,
  createApiLimiter,
  createStrictLimiter
};
