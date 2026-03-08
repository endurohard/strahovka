/**
 * Утилиты для работы с паролями (bcrypt)
 */

const bcrypt = require('bcryptjs');
const { BCRYPT } = require('./constants');

/**
 * Хеширует пароль с использованием bcrypt
 * @param {string} password - Пароль в открытом виде
 * @returns {Promise<string>} Хешированный пароль
 */
async function hashPassword(password) {
  if (!password) {
    throw new Error('Password is required');
  }

  return await bcrypt.hash(password, BCRYPT.SALT_ROUNDS);
}

/**
 * Сравнивает пароль с хешем
 * @param {string} password - Пароль в открытом виде
 * @param {string} hash - Хешированный пароль
 * @returns {Promise<boolean>} true если пароль совпадает
 */
async function comparePassword(password, hash) {
  if (!password || !hash) {
    return false;
  }

  return await bcrypt.compare(password, hash);
}

/**
 * Проверяет сложность пароля
 * @param {string} password - Пароль для проверки
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validatePasswordStrength(password) {
  const errors = [];

  if (!password) {
    errors.push('Пароль обязателен');
    return { valid: false, errors };
  }

  if (password.length < 6) {
    errors.push('Пароль должен содержать минимум 6 символов');
  }

  if (password.length > 128) {
    errors.push('Пароль слишком длинный (максимум 128 символов)');
  }

  // Опционально: можно добавить проверку на сложность
  // if (!/[A-Z]/.test(password)) {
  //   errors.push('Пароль должен содержать хотя бы одну заглавную букву');
  // }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
};
