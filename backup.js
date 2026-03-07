const fs = require('fs');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS) || 7;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getPool() {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'strahovka',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  });
}

/**
 * Экранирование значения для SQL
 */
function sqlVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * Создаёт резервную копию базы данных через pg (без pg_dump)
 * @returns {Promise<{filename, filepath, size, created_at}>}
 */
async function createBackup() {
  ensureBackupDir();

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `backup_${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  const pool = getPool();
  const lines = [];

  lines.push(`-- Strahovka DB Backup`);
  lines.push(`-- Created: ${now.toISOString()}`);
  lines.push(`-- Database: ${process.env.DB_NAME || 'strahovka'}`);
  lines.push('');
  lines.push('SET client_encoding = \'UTF8\';');
  lines.push('SET standard_conforming_strings = on;');
  lines.push('');

  const tables = ['employees', 'clients', 'daily_reminders', 'expenses', 'users'];

  try {
    for (const table of tables) {
      // Проверяем существует ли таблица
      const exists = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        [table]
      );
      if (exists.rows.length === 0) continue;

      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id`);

      lines.push(`-- Table: ${table}`);
      lines.push(`TRUNCATE TABLE ${table} CASCADE;`);

      if (rows.length > 0) {
        const cols = Object.keys(rows[0]).join(', ');
        for (const row of rows) {
          const vals = Object.values(row).map(sqlVal).join(', ');
          lines.push(`INSERT INTO ${table} (${cols}) VALUES (${vals});`);
        }
      }

      // Сбрасываем sequence
      lines.push(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false);`);
      lines.push('');
    }

    fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
    deleteOldBackups();

    const stats = fs.statSync(filepath);
    return { filename, filepath, size: stats.size, created_at: now.toISOString() };

  } finally {
    await pool.end();
  }
}

/**
 * Возвращает список резервных копий (новые сначала)
 */
function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.sql'))
    .map(filename => {
      const filepath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filepath);
      return { filename, size: stats.size, created_at: stats.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Удаляет резервные копии старше KEEP_DAYS дней
 */
function deleteOldBackups() {
  ensureBackupDir();
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.sql'))
    .forEach(filename => {
      const filepath = path.join(BACKUP_DIR, filename);
      if (fs.statSync(filepath).mtime.getTime() < cutoff) {
        fs.unlinkSync(filepath);
        console.log(`Удалена старая резервная копия: ${filename}`);
      }
    });
}

/**
 * Возвращает путь к файлу если он существует и безопасен
 */
function getBackupPath(filename) {
  const safe = path.basename(filename);
  if (!safe.startsWith('backup_') || !safe.endsWith('.sql')) return null;
  const filepath = path.join(BACKUP_DIR, safe);
  return fs.existsSync(filepath) ? filepath : null;
}

// ==================== YANDEX DISK ====================

const YANDEX_WEBDAV = 'webdav.yandex.ru';
const YANDEX_FOLDER = '/backups';

async function ensureYandexFolder() {
  const res = await webdavRequest('MKCOL', YANDEX_FOLDER);
  if (res.status !== 201 && res.status !== 405) {
    throw new Error(`Не удалось создать папку на Яндекс.Диске: статус ${res.status}`);
  }
}

function webdavRequest(method, remotePath, options = {}) {
  const login = process.env.YANDEX_LOGIN;
  const password = process.env.YANDEX_PASSWORD;
  if (!login || !password) throw new Error('YANDEX_LOGIN и YANDEX_PASSWORD не заданы');

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: YANDEX_WEBDAV,
      path: remotePath,
      method,
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': '*/*', ...options.headers }
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Загружает файл на Яндекс.Диск
 */
async function uploadToYandexDisk(filepath) {
  const filename = path.basename(filepath);
  const remotePath = `${YANDEX_FOLDER}/${filename}`;
  const fileSize = fs.statSync(filepath).size;

  await ensureYandexFolder();

  await new Promise((resolve, reject) => {
    const login = process.env.YANDEX_LOGIN;
    const password = process.env.YANDEX_PASSWORD;
    const auth = Buffer.from(`${login}:${password}`).toString('base64');

    const req = https.request({
      hostname: YANDEX_WEBDAV,
      path: remotePath,
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Length': fileSize,
        'Content-Type': 'application/octet-stream'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 204) resolve();
        else reject(new Error(`Ошибка загрузки на Яндекс.Диск: статус ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    fs.createReadStream(filepath).on('error', reject).pipe(req);
  });

  return { url: `https://disk.yandex.ru/client/disk${YANDEX_FOLDER}/${filename}` };
}

/**
 * Создаёт бэкап и загружает на Яндекс.Диск
 */
async function createBackupAndUpload() {
  const backup = await createBackup();
  console.log(`Загрузка на Яндекс.Диск: ${backup.filename}`);
  const { url } = await uploadToYandexDisk(backup.filepath);
  console.log(`Загружено: ${url}`);
  return { ...backup, yandex_url: url };
}

module.exports = {
  createBackup,
  createBackupAndUpload,
  uploadToYandexDisk,
  listBackups,
  deleteOldBackups,
  getBackupPath,
  BACKUP_DIR
};
