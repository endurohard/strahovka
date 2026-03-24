const Database = require('./database');

/**
 * Скрипт для обновления схемы базы данных
 * Добавляет новое поле issue_date и обновляет существующие таблицы
 */

async function updateSchema() {
  const db = new Database();

  try {
    console.log('🔄 Обновление схемы базы данных...\n');

    // Запускаем инициализацию, которая добавит новые поля если их нет
    await db.initialize();

    console.log('\n✅ Схема базы данных обновлена успешно!\n');

  } catch (error) {
    console.error('❌ Ошибка при обновлении схемы:', error.message);
    throw error;
  } finally {
    await db.close();
  }
}

// Запуск обновления
updateSchema()
  .then(() => {
    console.log('✅ Готово!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });
