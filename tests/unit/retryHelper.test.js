/**
 * Тесты для utils/retryHelper.js
 */

const { retry, sleep } = require('../../utils/retryHelper');

describe('retryHelper', () => {
  describe('retry', () => {
    test('должен вернуть результат при успешном выполнении с первой попытки', async () => {
      const successFn = jest.fn().mockResolvedValue('success');

      const result = await retry(successFn, { maxAttempts: 3, delay: 100 });

      expect(result).toBe('success');
      expect(successFn).toHaveBeenCalledTimes(1);
    });

    test('должен повторить попытку при ошибке', async () => {
      const failThenSuccessFn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await retry(failThenSuccessFn, { maxAttempts: 3, delay: 10 });

      expect(result).toBe('success');
      expect(failThenSuccessFn).toHaveBeenCalledTimes(3);
    });

    test('должен выбросить ошибку после исчерпания попыток', async () => {
      const alwaysFailFn = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        retry(alwaysFailFn, { maxAttempts: 3, delay: 10 })
      ).rejects.toThrow('Always fails');

      expect(alwaysFailFn).toHaveBeenCalledTimes(3);
    });

    test('должен вызывать onRetry callback', async () => {
      const onRetry = jest.fn();
      const failThenSuccessFn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      await retry(failThenSuccessFn, { maxAttempts: 3, delay: 10, onRetry });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 10);
    });

    test('должен использовать экспоненциальный backoff', async () => {
      const delays = [];
      const onRetry = jest.fn((error, attempt, delay) => {
        delays.push(delay);
      });

      const alwaysFailFn = jest.fn().mockRejectedValue(new Error('Fail'));

      await expect(
        retry(alwaysFailFn, { maxAttempts: 3, delay: 100, backoffMultiplier: 2, onRetry })
      ).rejects.toThrow();

      expect(delays).toEqual([100, 200]); // 100, 100*2
    });
  });

  describe('sleep', () => {
    test('должен задержать выполнение', async () => {
      const start = Date.now();
      await sleep(50);
      const end = Date.now();

      expect(end - start).toBeGreaterThanOrEqual(45); // Небольшая погрешность
    });
  });
});
