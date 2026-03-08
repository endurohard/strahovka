/**
 * Тесты для utils/passwordHelper.js
 */

const { hashPassword, comparePassword, validatePasswordStrength } = require('../../utils/passwordHelper');

describe('passwordHelper', () => {
  describe('hashPassword', () => {
    test('должен хешировать пароль', async () => {
      const password = 'mySecurePassword123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(30); // bcrypt hash длиннее 30 символов
    });

    test('должен создавать разные хеши для одного пароля', async () => {
      const password = 'samePassword';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2); // Разные соли
    });

    test('должен выбрасывать ошибку для пустого пароля', async () => {
      await expect(hashPassword('')).rejects.toThrow();
      await expect(hashPassword(null)).rejects.toThrow();
    });
  });

  describe('comparePassword', () => {
    test('должен корректно сравнивать пароль и хеш', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
    });

    test('должен возвращать false для неправильного пароля', async () => {
      const password = 'correctPassword';
      const hash = await hashPassword(password);

      const isMatch = await comparePassword('wrongPassword', hash);
      expect(isMatch).toBe(false);
    });

    test('должен возвращать false для пустых значений', async () => {
      expect(await comparePassword('', 'somehash')).toBe(false);
      expect(await comparePassword('password', '')).toBe(false);
      expect(await comparePassword(null, 'hash')).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    test('должен принимать валидные пароли', () => {
      const result = validatePasswordStrength('password123');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('должен отклонять короткие пароли', () => {
      const result = validatePasswordStrength('12345');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Пароль должен содержать минимум 6 символов');
    });

    test('должен отклонять слишком длинные пароли', () => {
      const longPassword = 'a'.repeat(130);
      const result = validatePasswordStrength(longPassword);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Пароль слишком длинный (максимум 128 символов)');
    });

    test('должен отклонять пустые пароли', () => {
      const result = validatePasswordStrength('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Пароль обязателен');
    });

    test('должен принимать пароль минимальной длины', () => {
      const result = validatePasswordStrength('123456');
      expect(result.valid).toBe(true);
    });
  });
});
