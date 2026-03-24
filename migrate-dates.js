const Database = require('./database');

/**
 * Скрипт для обновления дат существующих клиентов
 *
 * Логика:
 * - issue_date = start_date - 4 дня (вычисляем дату оформления)
 * - start_date остаётся без изменений (дата начала действия)
 * - expiration_date = start_date + 1 год - 1 день
 * - reminder_date = expiration_date - 7 дней
 *
 * Пример:
 * - Дата оформления: 2024-03-06
 * - Дата начала: 2024-03-10
 * - Дата окончания: 2025-03-09
 * - Напоминание: 2025-03-02
 */

async function migrateDates() {
  const db = new Database();

  try {
    console.log('🔄 Начинаем обновление дат для всех клиентов...\n');

    // Обновляем все даты для клиентов
    const updateQuery = `
      UPDATE clients
      SET
        issue_date = start_date - INTERVAL '4 days',
        expiration_date = start_date + INTERVAL '1 year' - INTERVAL '1 day',
        reminder_date = start_date + INTERVAL '1 year' - INTERVAL '8 days'
      WHERE issue_date IS NULL OR expiration_date != start_date + INTERVAL '1 year' - INTERVAL '1 day';
    `;

    const result = await db.pool.query(updateQuery);
    console.log(`✅ Обновлено ${result.rowCount} записей клиентов`);

    // Удаляем старые напоминания
    console.log('\n🗑️  Удаляем старые напоминания...');
    await db.pool.query('DELETE FROM daily_reminders;');
    console.log('✅ Старые напоминания удалены');

    // Получаем всех клиентов для регенерации напоминаний
    console.log('\n🔄 Регенерируем напоминания для всех клиентов...');
    const clients = await db.getAllClients();

    let regenerated = 0;
    for (const client of clients) {
      try {
        await db.generateDailyReminders(
          client.id,
          client.start_date,
          client.expiration_date
        );
        regenerated++;
      } catch (error) {
        console.error(`❌ Ошибка регенерации напоминаний для клиента ${client.id}:`, error.message);
      }
    }

    console.log(`✅ Регенерировано напоминаний для ${regenerated} клиентов`);

    // Показываем примеры обновлённых данных
    console.log('\n📊 Примеры обновлённых данных:');
    const examples = await db.pool.query(`
      SELECT
        name,
        issue_date,
        start_date,
        expiration_date,
        reminder_date
      FROM clients
      ORDER BY start_date DESC
      LIMIT 5;
    `);

    examples.rows.forEach(row => {
      console.log(`\n📝 ${row.name}:`);
      console.log(`   Дата оформления:    ${row.issue_date?.toISOString().split('T')[0]}`);
      console.log(`   Дата начала:        ${row.start_date?.toISOString().split('T')[0]}`);
      console.log(`   Дата окончания:     ${row.expiration_date?.toISOString().split('T')[0]}`);
      console.log(`   Дата напоминания:   ${row.reminder_date?.toISOString().split('T')[0]}`);
    });

    console.log('\n✅ Миграция завершена успешно!\n');

  } catch (error) {
    console.error('❌ Ошибка при обновлении дат:', error.message);
    throw error;
  } finally {
    await db.close();
  }
}

// Запуск миграции
migrateDates()
  .then(() => {
    console.log('✅ Готово!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });
