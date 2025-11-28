require('dotenv').config();
const Database = require('./database');

/**
 * Скрипт миграции для генерации ежедневных напоминаний
 * для всех существующих клиентов в базе данных
 */
async function migrateExistingClients() {
  const db = new Database();

  try {
    console.log('🔄 Запуск миграции для генерации ежедневных напоминаний...\n');

    await db.initialize();

    // Получаем всех клиентов
    const clients = await db.getAllClients();
    console.log(`📊 Найдено клиентов: ${clients.length}\n`);

    if (clients.length === 0) {
      console.log('ℹ️  Нет клиентов для миграции');
      await db.close();
      return;
    }

    let processed = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        console.log(`⏳ Обработка: ${client.name} (ID: ${client.id})`);

        // Генерируем ежедневные напоминания
        await db.generateDailyReminders(
          client.id,
          new Date(client.start_date),
          new Date(client.expiration_date)
        );

        processed++;
        console.log(`✅ Готово: ${client.name}\n`);

      } catch (error) {
        errors++;
        console.error(`❌ Ошибка для ${client.name}:`, error.message);
        console.error('   Stack:', error.stack, '\n');
      }
    }

    console.log('\n📊 Результаты миграции:');
    console.log(`   Обработано: ${processed}`);
    console.log(`   Ошибок: ${errors}`);
    console.log('\n✅ Миграция завершена!');

    await db.close();

  } catch (error) {
    console.error('💥 Критическая ошибка миграции:', error);
    console.error('   Stack:', error.stack);
    await db.close();
    process.exit(1);
  }
}

// Запуск миграции
migrateExistingClients();
