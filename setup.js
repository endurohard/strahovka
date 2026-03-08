/**
 * Скрипт первоначальной настройки системы
 *
 * Создает:
 * - Первого администратора
 * - Проверяет подключение к БД
 * - Создает необходимые таблицы
 *
 * Использование:
 *   node setup.js
 */

require('dotenv').config();
const readline = require('readline');
const { Pool } = require('pg');
const { hashPassword, validatePasswordStrength } = require('./utils/passwordHelper');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'strahovka',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function checkDatabaseConnection() {
  console.log('\n🔍 Проверка подключения к базе данных...');
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Подключение к БД успешно');
    return true;
  } catch (error) {
    console.error('❌ Ошибка подключения к БД:', error.message);
    return false;
  }
}

async function createTables() {
  console.log('\n🔨 Создание таблиц...');

  const Database = require('./database');
  const db = new Database();

  try {
    await db.initialize();
    console.log('✅ Таблицы созданы успешно');
    await db.close();
    return true;
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
    return false;
  }
}

async function createFirstAdmin() {
  console.log('\n👤 Создание первого администратора\n');

  // Проверяем, есть ли уже пользователи
  const existingUsers = await pool.query('SELECT COUNT(*) FROM users');
  const userCount = parseInt(existingUsers.rows[0].count);

  if (userCount > 0) {
    console.log(`ℹ️  В системе уже есть ${userCount} пользователей`);
    const overwrite = await question('Создать нового администратора? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('⏭️  Пропускаем создание администратора');
      return;
    }
  }

  let username, password;
  let validPassword = false;

  // Ввод логина
  while (!username || username.length < 3) {
    username = await question('Введите логин администратора (минимум 3 символа): ');
    if (!username || username.length < 3) {
      console.log('❌ Логин должен содержать минимум 3 символа');
    }
  }

  // Ввод пароля с валидацией
  while (!validPassword) {
    password = await question('Введите пароль (минимум 6 символов): ');

    const validation = validatePasswordStrength(password);
    if (validation.valid) {
      validPassword = true;
    } else {
      console.log('❌ Ошибки пароля:');
      validation.errors.forEach(err => console.log(`   - ${err}`));
    }
  }

  try {
    // Хешируем пароль
    const hashedPassword = await hashPassword(password);

    // Создаем пользователя
    const result = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, 'admin']
    );

    const user = result.rows[0];
    console.log('\n✅ Администратор создан успешно!');
    console.log(`   ID: ${user.id}`);
    console.log(`   Логин: ${user.username}`);
    console.log(`   Роль: ${user.role}`);

  } catch (error) {
    if (error.code === '23505') {
      console.error('❌ Пользователь с таким логином уже существует');
    } else {
      console.error('❌ Ошибка создания администратора:', error.message);
    }
  }
}

async function displayConnectionInfo() {
  console.log('\n📋 Информация о подключении:');
  console.log(`   База данных: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.log(`   API сервер:  http://localhost:${process.env.API_PORT || 10804}`);
  console.log(`   Excel файл:  ${process.env.EXCEL_FILE_PATH || '/data/clients.xlsx'}`);
}

async function setup() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Первоначальная настройка системы     ║');
  console.log('║        STRAHOVKA WhatsApp Bot          ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    // 1. Проверка подключения к БД
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      console.log('\n❌ Невозможно продолжить без подключения к БД');
      console.log('   Проверьте настройки в .env файле');
      process.exit(1);
    }

    // 2. Создание таблиц
    const tablesCreated = await createTables();
    if (!tablesCreated) {
      console.log('\n⚠️  Не удалось создать таблицы, но продолжаем...');
    }

    // 3. Создание первого администратора
    await createFirstAdmin();

    // 4. Показываем информацию
    await displayConnectionInfo();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║      Настройка завершена успешно!      ║');
    console.log('╚════════════════════════════════════════╝');

    console.log('\n📚 Следующие шаги:');
    console.log('   1. Запустите сервер: npm start');
    console.log('   2. Откройте http://localhost:10804');
    console.log('   3. Войдите с созданными учетными данными');
    console.log('   4. Отсканируйте QR-код WhatsApp в настройках');

  } catch (error) {
    console.error('\n❌ Критическая ошибка setup:', error.message);
    throw error;
  } finally {
    rl.close();
    await pool.end();
  }
}

// Запуск setup
(async () => {
  try {
    await setup();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Setup провалился:', error);
    process.exit(1);
  }
})();
