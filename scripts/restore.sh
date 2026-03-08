#!/bin/bash

#######################################
# Database Restore Script
# Восстанавливает БД из бэкапа
#
# Использование:
#   ./scripts/restore.sh backup_file.sql.gz
#######################################

set -e

if [ $# -eq 0 ]; then
  echo "❌ Использование: $0 <backup_file.sql.gz>"
  echo ""
  echo "Доступные бэкапы:"
  ls -lh /backups/backup_*.sql.gz 2>/dev/null || echo "  Нет бэкапов"
  exit 1
fi

BACKUP_FILE=$1
DB_NAME="${PGDATABASE:-strahovka}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "❌ Файл не найден: ${BACKUP_FILE}"
  exit 1
fi

echo "⚠️  ВНИМАНИЕ: Восстановление БД удалит все текущие данные!"
echo "   База данных: ${DB_NAME}"
echo "   Файл: ${BACKUP_FILE}"
echo ""
read -p "Продолжить? (yes/no): " -r
echo

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "❌ Отменено"
  exit 0
fi

echo "🔄 Начало восстановления..."

# Распаковываем если это .gz
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  echo "📦 Распаковка бэкапа..."
  gunzip -c "${BACKUP_FILE}" > /tmp/restore.sql
  SQL_FILE="/tmp/restore.sql"
else
  SQL_FILE="${BACKUP_FILE}"
fi

# Удаляем существующую БД и создаем заново
echo "🗑️  Пересоздание БД..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres <<EOF
DROP DATABASE IF EXISTS ${DB_NAME};
CREATE DATABASE ${DB_NAME};
EOF

# Восстанавливаем
echo "📥 Восстановление данных..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${DB_NAME}" < "${SQL_FILE}"

# Удаляем временный файл
if [ "${SQL_FILE}" = "/tmp/restore.sql" ]; then
  rm -f /tmp/restore.sql
fi

echo "✅ Восстановление завершено успешно!"
echo ""
echo "🔐 Не забудьте выполнить миграцию паролей если требуется:"
echo "   npm run migrate:passwords"
