/**
 * Скрипт миграции паролей из plain text в bcrypt
 *
 * ВАЖНО: Запускать ОДИН РАЗ после обновления на bcrypt!
 *
 * Использование:
 *   node migrate-passwords.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const { hashPassword } = require('./utils/passwordHelper');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'strahovka',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

async function migratePasswords() {
  console.log('🔐 Начало миграции паролей...\n');

  try {
    // Получаем всех пользователей
    const result = await pool.query('SELECT id, username, password FROM users');
    const users = result.rows;

    if (users.length === 0) {
      console.log('ℹ️  Пользователей в БД нет, миграция не требуется');
      return;
    }

    console.log(`📊 Найдено пользователей: ${users.length}\n`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        // Проверяем, не является ли пароль уже хешированным
        // Bcrypt хеши начинаются с $2a$, $2b$ или $2y$ и имеют длину 60 символов
        const isBcryptHash = /^\$2[aby]\$\d{2}\$.{53}$/.test(user.password);

        if (isBcryptHash) {
          console.log(`⏭️  ${user.username} - уже хеширован, пропускаем`);
          skipped++;
          continue;
        }

        // Хешируем plaintext пароль
        const hashedPassword = await hashPassword(user.password);

        // Обновляем в БД
        await pool.query(
          'UPDATE users SET password = $1 WHERE id = $2',
          [hashedPassword, user.id]
        );

        console.log(`✅ ${user.username} - пароль успешно хеширован`);
        migrated++;

      } catch (error) {
        console.error(`❌ ${user.username} - ошибка: ${error.message}`);
        errors++;
      }
    }

    console.log('\n📊 Результаты миграции:');
    console.log(`   Мигрировано: ${migrated}`);
    console.log(`   Пропущено (уже хешированы): ${skipped}`);
    console.log(`   Ошибок: ${errors}`);

    if (migrated > 0) {
      console.log('\n✅ Миграция завершена успешно!');
      console.log('⚠️  ВАЖНО: Пользователи должны использовать свои старые пароли для входа');
    }

  } catch (error) {
    console.error('\n❌ Критическая ошибка миграции:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// Запуск миграции
(async () => {
  try {
    await migratePasswords();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Миграция провалилась:', error);
    process.exit(1);
  }
})();
