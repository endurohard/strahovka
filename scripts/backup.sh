#!/bin/bash

#######################################
# Database Backup Script
# Создает бэкап PostgreSQL БД
#
# Использование:
#   ./scripts/backup.sh
#   или через docker-compose:
#   docker-compose --profile backup run --rm backup
#######################################

set -e

# Конфигурация
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DB_NAME="${PGDATABASE:-strahovka}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${DB_NAME}_${TIMESTAMP}.sql"

echo "🔄 Начало резервного копирования БД..."
echo "   База данных: ${DB_NAME}"
echo "   Файл: ${BACKUP_FILE}"

# Создаем директорию для бэкапов если её нет
mkdir -p "${BACKUP_DIR}"

# Создаем бэкап
echo "📦 Создание дампа БД..."
pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${DB_NAME}" \
  --format=plain \
  --no-owner \
  --no-acl \
  --verbose \
  > "${BACKUP_FILE}" 2>&1

# Проверяем успешность
if [ $? -eq 0 ]; then
  echo "✅ Бэкап создан успешно: ${BACKUP_FILE}"

  # Сжимаем бэкап
  echo "📦 Сжатие бэкапа..."
  gzip "${BACKUP_FILE}"
  BACKUP_FILE="${BACKUP_FILE}.gz"

  # Показываем размер
  SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "   Размер: ${SIZE}"
else
  echo "❌ Ошибка создания бэкапа"
  exit 1
fi

# Удаляем старые бэкапы
echo "🗑️  Удаление бэкапов старше ${RETENTION_DAYS} дней..."
find "${BACKUP_DIR}" -name "backup_${DB_NAME}_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete

# Показываем список бэкапов
echo ""
echo "📋 Список бэкапов:"
ls -lh "${BACKUP_DIR}"/backup_${DB_NAME}_*.sql.gz 2>/dev/null || echo "   Нет бэкапов"

echo ""
echo "✅ Резервное копирование завершено!"
