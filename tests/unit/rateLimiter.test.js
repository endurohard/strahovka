const { RateLimiter, createRateLimiter, createAuthLimiter, createApiLimiter, createStrictLimiter } = require('../../utils/rateLimiter');

describe('RateLimiter', () => {
  let limiter;

  afterEach(() => {
    if (limiter) {
      limiter.destroy();
    }
  });

  describe('Constructor', () => {
    test('должен создаться с настройками по умолчанию', () => {
      limiter = new RateLimiter();

      expect(limiter.windowMs).toBe(15 * 60 * 1000);
      expect(limiter.maxRequests).toBe(100);
      expect(limiter.message).toBe('Слишком много запросов, попробуйте позже');
      expect(limiter.statusCode).toBe(429);
    });

    test('должен принимать пользовательские настройки', () => {
      limiter = new RateLimiter({
        windowMs: 60000,
        max: 10,
        message: 'Custom message',
        statusCode: 503
      });

      expect(limiter.windowMs).toBe(60000);
      expect(limiter.maxRequests).toBe(10);
      expect(limiter.message).toBe('Custom message');
      expect(limiter.statusCode).toBe(503);
    });
  });

  describe('getClientIp', () => {
    test('должен извлекать IP из req.ip', () => {
      limiter = new RateLimiter();
      const req = { ip: '192.168.1.1' };

      expect(limiter.getClientIp(req)).toBe('192.168.1.1');
    });

    test('должен извлекать IP из x-forwarded-for', () => {
      limiter = new RateLimiter();
      const req = {
        headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' }
      };

      expect(limiter.getClientIp(req)).toBe('10.0.0.1');
    });

    test('должен извлекать IP из x-real-ip', () => {
      limiter = new RateLimiter();
      const req = {
        headers: { 'x-real-ip': '10.0.0.2' }
      };

      expect(limiter.getClientIp(req)).toBe('10.0.0.2');
    });

    test('должен возвращать "unknown" если IP не найден', () => {
      limiter = new RateLimiter();
      const req = { headers: {} };

      expect(limiter.getClientIp(req)).toBe('unknown');
    });
  });

  describe('middleware', () => {
    test('должен пропускать запросы в пределах лимита', () => {
      limiter = new RateLimiter({ max: 3, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req = { ip: '127.0.0.1' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Первый запрос
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
      expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 2);

      // Второй запрос
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 1);

      // Третий запрос
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    test('должен блокировать запросы после превышения лимита', () => {
      limiter = new RateLimiter({ max: 2, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req = { ip: '127.0.0.1' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Первые 2 запроса проходят
      middleware(req, res, next);
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Третий запрос блокируется
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(2); // Не увеличилось
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Слишком много запросов, попробуйте позже'
        })
      );
    });

    test('должен устанавливать заголовки Retry-After при блокировке', () => {
      limiter = new RateLimiter({ max: 1, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req = { ip: '127.0.0.1' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Первый запрос
      middleware(req, res, next);

      // Второй запрос блокируется
      middleware(req, res, next);
      expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(Number));
      expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    test('должен различать разные IP адреса', () => {
      limiter = new RateLimiter({ max: 1, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req1 = { ip: '192.168.1.1' };
      const req2 = { ip: '192.168.1.2' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Оба запроса должны пройти (разные IP)
      middleware(req1, res, next);
      middleware(req2, res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStats', () => {
    test('должен возвращать статистику', () => {
      limiter = new RateLimiter({ max: 10, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req1 = { ip: '192.168.1.1' };
      const req2 = { ip: '192.168.1.2' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req1, res, next);
      middleware(req1, res, next);
      middleware(req2, res, next);

      const stats = limiter.getStats();
      expect(stats.totalIPs).toBe(2);
      expect(stats.maxRequests).toBe(10);
      expect(stats.activeRequests).toBe(3);
    });
  });

  describe('resetIp', () => {
    test('должен сбрасывать записи для конкретного IP', () => {
      limiter = new RateLimiter({ max: 2, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req = { ip: '127.0.0.1' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      // Делаем 2 запроса
      middleware(req, res, next);
      middleware(req, res, next);

      // Сбрасываем
      const result = limiter.resetIp('127.0.0.1');
      expect(result).toBe(true);

      // Теперь запросы снова должны проходить
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(3);
    });
  });

  describe('resetAll', () => {
    test('должен сбрасывать все записи', () => {
      limiter = new RateLimiter({ max: 1, windowMs: 60000 });
      const middleware = limiter.middleware();

      const req1 = { ip: '192.168.1.1' };
      const req2 = { ip: '192.168.1.2' };
      const res = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req1, res, next);
      middleware(req2, res, next);

      expect(limiter.getStats().totalIPs).toBe(2);

      limiter.resetAll();

      expect(limiter.getStats().totalIPs).toBe(0);
      expect(limiter.getStats().activeRequests).toBe(0);
    });
  });

  describe('Preset функции', () => {
    test('createAuthLimiter должен создавать строгий лимитер', () => {
      limiter = createAuthLimiter();
      expect(limiter.maxRequests).toBe(5);
      expect(limiter.windowMs).toBe(15 * 60 * 1000);
    });

    test('createApiLimiter должен создавать средний лимитер', () => {
      limiter = createApiLimiter();
      expect(limiter.maxRequests).toBe(100);
      expect(limiter.windowMs).toBe(15 * 60 * 1000);
    });

    test('createStrictLimiter должен создавать жесткий лимитер', () => {
      limiter = createStrictLimiter();
      expect(limiter.maxRequests).toBe(10);
      expect(limiter.windowMs).toBe(60 * 60 * 1000);
    });
  });

  describe('destroy', () => {
    test('должен останавливать cleanup interval', () => {
      limiter = new RateLimiter();
      const intervalId = limiter.cleanupInterval;

      expect(intervalId).toBeDefined();

      limiter.destroy();

      expect(limiter.cleanupInterval).toBeNull();
    });
  });
});
