/**
 * Тесты для utils/phoneFormatter.js
 */

const { formatPhoneNumber, isValidPhoneNumber } = require('../../utils/phoneFormatter');

describe('phoneFormatter', () => {
  describe('formatPhoneNumber', () => {
    test('должен форматировать номер с 8 на +7', () => {
      expect(formatPhoneNumber('89991234567')).toBe('+79991234567');
    });

    test('должен форматировать номер с 7 на +7', () => {
      expect(formatPhoneNumber('79991234567')).toBe('+79991234567');
    });

    test('должен форматировать номер начинающийся с 9 (10 цифр)', () => {
      expect(formatPhoneNumber('9991234567')).toBe('+79991234567');
    });

    test('должен оставлять +7 без изменений', () => {
      expect(formatPhoneNumber('+79991234567')).toBe('+79991234567');
    });

    test('должен убирать нечисловые символы', () => {
      expect(formatPhoneNumber('+7 (999) 123-45-67')).toBe('+79991234567');
      expect(formatPhoneNumber('8 999 123 45 67')).toBe('+79991234567');
    });

    test('должен обрабатывать числовой ввод', () => {
      expect(formatPhoneNumber(89991234567)).toBe('+79991234567');
    });

    test('должен возвращать пустую строку для null/undefined', () => {
      expect(formatPhoneNumber(null)).toBe('');
      expect(formatPhoneNumber(undefined)).toBe('');
      expect(formatPhoneNumber('')).toBe('');
    });

    test('должен обрабатывать некорректные форматы', () => {
      // Просто убирает нечисловые символы
      expect(formatPhoneNumber('abc123')).toBe('123');
    });
  });

  describe('isValidPhoneNumber', () => {
    test('должен валидировать корректные номера', () => {
      expect(isValidPhoneNumber('+79991234567')).toBe(true);
      expect(isValidPhoneNumber('89991234567')).toBe(true);
      expect(isValidPhoneNumber('79991234567')).toBe(true);
      expect(isValidPhoneNumber('9991234567')).toBe(true);
    });

    test('должен отклонять некорректные номера', () => {
      expect(isValidPhoneNumber('')).toBe(false);
      expect(isValidPhoneNumber(null)).toBe(false);
      expect(isValidPhoneNumber('123')).toBe(false);
      expect(isValidPhoneNumber('+1234567890')).toBe(false); // Не российский номер
    });

    test('должен валидировать номера с пробелами и скобками', () => {
      expect(isValidPhoneNumber('+7 (999) 123-45-67')).toBe(true);
    });
  });
});
