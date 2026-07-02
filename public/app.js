const API_BASE = window.location.origin;

let currentPage = 1;
let searchDebounce = null;
let authToken = localStorage.getItem('authToken');

// Проверка авторизации
function checkAuth() {
    if (!authToken) {
        window.location.href = '/login';
        return false;
    }
    return true;
}

// Получение headers с токеном
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

// Выход
function logout() {
    fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        headers: getAuthHeaders()
    }).finally(() => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        window.location.href = '/login';
    });
}

// Загрузка при старте
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    // Показать имя пользователя
    const username = localStorage.getItem('username');
    if (username) {
        document.getElementById('username-display').textContent = username;
    }

    loadStats();
    loadClients();
    checkWhatsAppStatus();
    loadNotifications();
    loadTodayQueue();
    loadPausedPhones();

    // Обновление каждые 30 секунд
    setInterval(() => {
        loadStats();
        checkWhatsAppStatus();
        loadNotifications();
        loadTodayQueue();
    }, 30000);
});

// Закрытие меню уведомлений по клику вне него
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('notifMenu');
    const btn = e.target.closest && e.target.closest('[onclick="toggleNotifications()"]');
    if (wrap && !btn && !wrap.contains(e.target)) wrap.classList.add('hidden');
});

// Проверка статуса WhatsApp
async function checkWhatsAppStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/whatsapp/status`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();

        const statusEl = document.getElementById('whatsapp-status');
        if (data.ready) {
            // Полностью авторизован и готов
            statusEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800';
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Подключен';
        } else if (data.browserActive) {
            // Браузер активен, но не авторизован (ждет QR)
            statusEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800';
            statusEl.innerHTML = '<i class="fas fa-qrcode"></i> Ожидание QR';
        } else {
            // Полностью отключен
            statusEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800';
            statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Отключен';
        }
    } catch (error) {
        console.error('Ошибка проверки WhatsApp:', error);
    }
}

// Загрузка статистики
async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/api/stats`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();

        document.getElementById('stat-total').textContent = data.total_clients || 0;
        document.getElementById('stat-upcoming').textContent = data.upcoming_reminders || 0;
        document.getElementById('stat-pending').textContent = data.pending_reminders || 0;
        document.getElementById('stat-sent').textContent = data.sent_reminders || 0;
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        showNotification('Ошибка загрузки статистики', 'error');
    }
}

// Загрузка клиентов
async function loadClients(page = 1) {
    currentPage = page;
    const search = document.getElementById('search').value;
    const sort = document.getElementById('sort').value;
    const filter = document.getElementById('filter').value;

    try {
        const params = new URLSearchParams({
            page,
            limit: 50,
            search,
            sort,
            filter
        });

        const res = await fetch(`${API_BASE}/api/clients?${params}`, {
            headers: getAuthHeaders()
        });

        if (res.status === 401) {
            localStorage.removeItem('authToken');
            window.location.href = '/login';
            return;
        }

        const data = await res.json();

        renderClientsTable(data.clients || []);
        renderPagination(data.page, data.pages, data.total);

        document.getElementById('showing-from').textContent = (data.page - 1) * 50 + 1;
        document.getElementById('showing-to').textContent = Math.min(data.page * 50, data.total);
        document.getElementById('total-count').textContent = data.total;
    } catch (error) {
        console.error('Ошибка загрузки клиентов:', error);
        showNotification('Ошибка загрузки клиентов', 'error');
    }
}

// Отрисовка таблицы клиентов
function renderClientsTable(clients) {
    const tbody = document.getElementById('clients-table');

    if (clients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-12 text-center text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-2"></i>
                    <p>Клиенты не найдены</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = clients.map(client => {
        const reminderDate = new Date(client.reminder_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let statusBadge = '';
        if (client.reminders_paused) {
            statusBadge = '<span class="px-2 py-1 bg-gray-200 text-gray-700 rounded-full text-xs">На паузе</span>';
        } else if (client.last_reminder_sent) {
            statusBadge = '<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">Отправлено</span>';
        } else if (reminderDate <= today) {
            statusBadge = '<span class="px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-xs">Ожидает</span>';
        } else {
            statusBadge = '<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">Запланировано</span>';
        }

        const safeName = escapeHtml(client.name);
        const safePhone = escapeHtml(client.phone_formatted || client.phone);
        const safeInsurance = escapeHtml(client.insurance) || '-';

        const pauseBtn = client.reminders_paused
            ? `<button onclick="toggleClientPause(${client.id}, ${JSON.stringify(client.name)})" class="text-yellow-600 hover:text-yellow-800 mr-3" title="Возобновить рассылку"><i class="fas fa-play"></i></button>`
            : `<button onclick="toggleClientPause(${client.id}, ${JSON.stringify(client.name)})" class="text-gray-500 hover:text-gray-800 mr-3" title="Приостановить рассылку"><i class="fas fa-pause"></i></button>`;

        return `
            <tr class="hover:bg-gray-50${client.reminders_paused ? ' opacity-70' : ''}">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${safeName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${safePhone}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${safeInsurance}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(client.start_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(client.expiration_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(client.reminder_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap">${statusBadge}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onclick="sendManualReminder(${client.id}, ${JSON.stringify(client.name)})" class="text-green-600 hover:text-green-900 mr-3" title="Отправить напоминание">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                    ${pauseBtn}
                    <button onclick="editClient(${client.id})" class="text-blue-600 hover:text-blue-900 mr-3" title="Редактировать">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteClient(${client.id}, ${JSON.stringify(client.name)})" class="text-red-600 hover:text-red-900" title="Удалить">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Отрисовка пагинации
function renderPagination(current, total, totalCount) {
    const pagination = document.getElementById('pagination');

    if (total <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';

    // Предыдущая
    if (current > 1) {
        html += `<button onclick="loadClients(${current - 1})" class="px-3 py-1 border rounded hover:bg-gray-100">
            <i class="fas fa-chevron-left"></i>
        </button>`;
    }

    // Страницы
    const startPage = Math.max(1, current - 2);
    const endPage = Math.min(total, current + 2);

    for (let i = startPage; i <= endPage; i++) {
        if (i === current) {
            html += `<button class="px-3 py-1 bg-blue-600 text-white rounded">${i}</button>`;
        } else {
            html += `<button onclick="loadClients(${i})" class="px-3 py-1 border rounded hover:bg-gray-100">${i}</button>`;
        }
    }

    // Следующая
    if (current < total) {
        html += `<button onclick="loadClients(${current + 1})" class="px-3 py-1 border rounded hover:bg-gray-100">
            <i class="fas fa-chevron-right"></i>
        </button>`;
    }

    pagination.innerHTML = html;
}

// Импорт из Excel
async function importExcel() {
    if (!confirm('Импортировать данные из Excel файла?')) return;

    try {
        showNotification('Импорт данных...', 'info');
        const res = await fetch(`${API_BASE}/api/import`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Импортировано: ${data.imported}, Ошибок: ${data.errors}`, 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка импорта', 'error');
        }
    } catch (error) {
        console.error('Ошибка импорта:', error);
        showNotification('Ошибка импорта данных', 'error');
    }
}

// Отправка напоминаний
async function sendReminders() {
    if (!confirm('Отправить напоминания клиентам?')) return;

    try {
        showNotification('Отправка напоминаний...', 'info');
        const res = await fetch(`${API_BASE}/api/send-reminders`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Отправлено: ${data.sent}, Ошибок: ${data.errors}`, 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка отправки', 'error');
        }
    } catch (error) {
        console.error('Ошибка отправки:', error);
        showNotification('Ошибка отправки напоминаний', 'error');
    }
}

// Модальное окно загрузки
function showUploadModal() {
    document.getElementById('upload-modal').classList.remove('hidden');
}

function hideUploadModal() {
    document.getElementById('upload-modal').classList.add('hidden');
    document.getElementById('file-input').value = '';
}

async function uploadFile() {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

    if (!file) {
        showNotification('Выберите файл', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        showNotification('Загрузка файла...', 'info');
        const res = await fetch(`${API_BASE}/api/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Загружено: ${data.imported}, Ошибок: ${data.errors}`, 'success');
            hideUploadModal();
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка загрузки', 'error');
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        showNotification('Ошибка загрузки файла', 'error');
    }
}

// Модальное окно добавления клиента
async function showAddClientModal() {
    // Загружаем список сотрудников
    try {
        const res = await fetch(`${API_BASE}/api/employees`, {
            headers: getAuthHeaders()
        });
        const employees = await res.json();
        const select = document.getElementById('employee-select');
        select.innerHTML = '<option value="">-- Не выбран --</option>';
        employees.forEach(emp => {
            select.innerHTML += `<option value="${emp.id}">${emp.name}</option>`;
        });
    } catch (error) {
        console.error('Ошибка загрузки сотрудников:', error);
    }
    document.getElementById('add-client-modal').classList.remove('hidden');
}

function hideAddClientModal() {
    document.getElementById('add-client-modal').classList.add('hidden');
    document.getElementById('add-client-form').reset();
}

async function addClient(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);

    try {
        const res = await fetch(`${API_BASE}/api/clients`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (res.ok) {
            showNotification('Клиент добавлен', 'success');
            hideAddClientModal();
            loadStats();
            loadClients();
        } else {
            showNotification(result.error || 'Ошибка добавления', 'error');
        }
    } catch (error) {
        console.error('Ошибка добавления:', error);
        showNotification('Ошибка добавления клиента', 'error');
    }
}

// Удаление клиента
async function deleteClient(id, name) {
    if (!confirm(`Удалить клиента "${name}"?`)) return;

    try {
        const res = await fetch(`${API_BASE}/api/clients/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification('Клиент удален', 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка удаления', 'error');
        }
    } catch (error) {
        console.error('Ошибка удаления:', error);
        showNotification('Ошибка удаления клиента', 'error');
    }
}

// Отправка ручного напоминания клиенту
async function loadPausedPhones() {
    try {
        const res = await fetch(`${API_BASE}/api/paused-phones`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        renderPausedPhones(data);
    } catch (e) {
        console.error('Ошибка загрузки блок-листа:', e);
    }
}

function renderPausedPhones(data) {
    const tbody = document.getElementById('blocklist-table');
    if (!tbody) return;
    if (!data.items || data.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-gray-500">Блок-лист пуст</td></tr>`;
        return;
    }
    tbody.innerHTML = data.items.map(p => {
        const phone = escapeHtml(p.phone);
        const reason = escapeHtml(p.reason || '—');
        const date = p.created_at ? new Date(p.created_at).toLocaleDateString('ru-RU') : '—';
        return `
            <tr>
                <td class="px-4 py-2 whitespace-nowrap text-gray-900 font-mono">${phone}</td>
                <td class="px-4 py-2 text-gray-700">${reason}</td>
                <td class="px-4 py-2 whitespace-nowrap text-gray-500">${date}</td>
                <td class="px-4 py-2 whitespace-nowrap text-right">
                    <button onclick="removePausedPhone(${JSON.stringify(p.phone)})" class="text-red-600 hover:text-red-800" title="Убрать из блок-листа">
                        <i class="fas fa-trash"></i> Убрать
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function addPausedPhone() {
    const phoneEl = document.getElementById('blocklist-phone');
    const reasonEl = document.getElementById('blocklist-reason');
    const phone = (phoneEl.value || '').trim();
    const reason = (reasonEl.value || '').trim();
    if (!phone) { showNotification('Введите номер', 'error'); return; }
    try {
        const res = await fetch(`${API_BASE}/api/paused-phones`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, reason })
        });
        const data = await res.json();
        if (!res.ok) { showNotification(data.error || 'Не удалось добавить', 'error'); return; }
        showNotification(`Номер ${data.phone} в блок-листе`, 'success');
        phoneEl.value = '';
        reasonEl.value = '';
        loadPausedPhones();
        loadTodayQueue();
        loadClients();
    } catch (e) {
        console.error('Ошибка добавления в блок-лист:', e);
        showNotification('Ошибка добавления', 'error');
    }
}

async function removePausedPhone(phone) {
    if (!confirm(`Убрать номер ${phone} из блок-листа?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/paused-phones/${encodeURIComponent(phone)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (!res.ok) { showNotification(data.error || 'Не удалось убрать', 'error'); return; }
        showNotification(`Номер ${phone} убран из блок-листа`, 'success');
        loadPausedPhones();
        loadTodayQueue();
        loadClients();
    } catch (e) {
        console.error('Ошибка удаления из блок-листа:', e);
        showNotification('Ошибка удаления', 'error');
    }
}

async function loadTodayQueue() {
    try {
        const res = await fetch(`${API_BASE}/api/queue/today`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        renderTodayQueue(data);
    } catch (e) {
        console.error('Ошибка загрузки очереди:', e);
    }
}

function renderTodayQueue(data) {
    const tbody = document.getElementById('queue-table');
    const summary = document.getElementById('queue-summary');
    if (!tbody || !summary) return;

    const c = data.counts || {};
    const parts = [];
    if (c.pending) parts.push(`в очереди: ${c.pending}`);
    if (c.sent) parts.push(`отправлено: ${c.sent}`);
    if (c.skipped) parts.push(`пропущено: ${c.skipped}`);
    if (c.cancelled) parts.push(`отменено: ${c.cancelled}`);
    if (c.failed) parts.push(`провалено: ${c.failed}`);
    summary.textContent = `Всего сегодня: ${data.total}${parts.length ? ' — ' + parts.join(', ') : ''}. Окно: ${data.window}`;

    if (!data.items || data.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-gray-500">Очередь пуста</td></tr>`;
        return;
    }

    const fmtEta = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    };
    const fmtDate = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('ru-RU');
    };
    const badge = (status, paused, blocklisted) => {
        if (blocklisted && status === 'pending') return '<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Номер в блок-листе</span>';
        if (paused && status === 'pending') return '<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs">На паузе</span>';
        const map = {
            pending: ['bg-blue-100', 'text-blue-800', 'Ожидает'],
            sent: ['bg-green-100', 'text-green-800', 'Отправлено'],
            skipped: ['bg-yellow-100', 'text-yellow-800', 'Пропущено'],
            cancelled: ['bg-gray-200', 'text-gray-700', 'Отменено'],
            failed: ['bg-red-100', 'text-red-800', 'Провалено']
        };
        const [bg, fg, txt] = map[status] || ['bg-gray-100', 'text-gray-800', status];
        return `<span class="px-2 py-0.5 ${bg} ${fg} rounded-full text-xs">${txt}</span>`;
    };

    tbody.innerHTML = data.items.map(item => {
        const safeName = escapeHtml(item.client_name || '—');
        const safePhone = escapeHtml(item.phone || '—');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const exp = item.expiration_date ? new Date(item.expiration_date) : null;
        const daysLeft = exp ? Math.ceil((exp.setHours(0,0,0,0) - today) / 86400000) : '—';
        const cancelBtn = (item.status === 'pending')
            ? `<button onclick="cancelQueueItem(${item.id}, ${JSON.stringify(item.client_name || '')})" class="text-red-600 hover:text-red-800" title="Убрать из очереди"><i class="fas fa-times-circle"></i> Убрать</button>`
            : (item.error_message ? `<span class="text-xs text-gray-500" title="${escapeHtml(item.error_message)}">${escapeHtml(item.error_message).slice(0, 40)}</span>` : '');
        const rowCls = (item.reminders_paused || item.phone_blocklisted) && item.status === 'pending' ? 'opacity-60' : '';
        return `
            <tr class="${rowCls}">
                <td class="px-4 py-2 whitespace-nowrap text-gray-700">${fmtEta(item.scheduled_at)}</td>
                <td class="px-4 py-2 whitespace-nowrap text-gray-900">${safeName}</td>
                <td class="px-4 py-2 whitespace-nowrap text-gray-700">${safePhone}</td>
                <td class="px-4 py-2 whitespace-nowrap text-gray-700">${fmtDate(item.expiration_date)}</td>
                <td class="px-4 py-2 whitespace-nowrap text-gray-700">${daysLeft}</td>
                <td class="px-4 py-2 whitespace-nowrap text-right">
                    ${badge(item.status, item.reminders_paused, item.phone_blocklisted)}
                    <span class="ml-2">${cancelBtn}</span>
                </td>
            </tr>
        `;
    }).join('');
}

async function cancelQueueItem(id, name) {
    if (!confirm(`Убрать клиента "${name}" из сегодняшней очереди?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/queue/${id}/cancel`, { method: 'POST', headers: getAuthHeaders() });
        const data = await res.json();
        if (!res.ok) {
            showNotification(data.error || 'Не удалось отменить', 'error');
            return;
        }
        showNotification(`"${name}" убран из очереди`, 'success');
        loadTodayQueue();
    } catch (e) {
        console.error('Ошибка отмены:', e);
        showNotification('Ошибка отмены', 'error');
    }
}

async function toggleClientPause(id, name) {
    try {
        const res = await fetch(`${API_BASE}/api/clients/${id}/toggle-pause`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (!res.ok) {
            showNotification(data.error || 'Ошибка переключения паузы', 'error');
            return;
        }
        const verb = data.reminders_paused ? 'приостановлены' : 'возобновлены';
        showNotification(`Напоминания для "${name}" ${verb}`, 'success');
        loadClients();
    } catch (error) {
        console.error('Ошибка переключения паузы:', error);
        showNotification('Ошибка переключения паузы', 'error');
    }
}

async function sendManualReminder(id, name) {
    if (!confirm(`Отправить напоминание клиенту "${name}"?`)) return;

    try {
        showNotification('Отправка напоминания...', 'info');
        const res = await fetch(`${API_BASE}/api/clients/${id}/remind`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
            showNotification(`Напоминание отправлено клиенту "${name}"`, 'success');
            loadStats();
            loadClients();
        } else {
            showNotification(data.error || 'Ошибка отправки', 'error');
        }
    } catch (error) {
        console.error('Ошибка отправки напоминания:', error);
        showNotification('Ошибка отправки напоминания', 'error');
    }
}

// Редактирование клиента
async function editClient(id) {
    try {
        // Загружаем данные клиента
        const res = await fetch(`${API_BASE}/api/clients/${id}`, {
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            showNotification('Ошибка загрузки данных клиента', 'error');
            return;
        }

        const client = await res.json();

        // Загружаем список сотрудников
        const empRes = await fetch(`${API_BASE}/api/employees`, {
            headers: getAuthHeaders()
        });
        const employees = await empRes.json();
        const select = document.getElementById('edit-employee-select');
        select.innerHTML = '<option value="">-- Не выбран --</option>';
        employees.forEach(emp => {
            const selected = emp.id === client.employee_id ? 'selected' : '';
            select.innerHTML += `<option value="${emp.id}" ${selected}>${emp.name}</option>`;
        });

        // Заполняем форму данными клиента
        document.getElementById('edit-client-id').value = client.id;
        document.getElementById('edit-name').value = client.name || '';
        document.getElementById('edit-phone').value = client.phone || '';
        document.getElementById('edit-insurance').value = client.insurance || '';
        document.getElementById('edit-start-date').value = client.start_date ? client.start_date.split('T')[0] : '';
        document.getElementById('edit-expiration-date').value = client.expiration_date ? client.expiration_date.split('T')[0] : '';
        document.getElementById('edit-amount').value = client.amount || '';
        document.getElementById('edit-insurance-expense').value = client.insurance_expense || '';
        document.getElementById('edit-employee-expense').value = client.employee_expense || '';

        // Показываем модальное окно
        document.getElementById('edit-client-modal').classList.remove('hidden');

    } catch (error) {
        console.error('Ошибка загрузки клиента:', error);
        showNotification('Ошибка загрузки данных клиента', 'error');
    }
}

function hideEditClientModal() {
    document.getElementById('edit-client-modal').classList.add('hidden');
    document.getElementById('edit-client-form').reset();
}

async function updateClient(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData);
    const clientId = data.id;
    delete data.id; // Удаляем id из body, т.к. он передается в URL

    try {
        const res = await fetch(`${API_BASE}/api/clients/${clientId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });

        const result = await res.json();

        if (res.ok) {
            showNotification('Клиент обновлен', 'success');
            hideEditClientModal();
            loadStats();
            loadClients();
        } else {
            showNotification(result.error || 'Ошибка обновления', 'error');
        }
    } catch (error) {
        console.error('Ошибка обновления:', error);
        showNotification('Ошибка обновления клиента', 'error');
    }
}

// Поиск с задержкой
function debounceSearch() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        loadClients(1);
    }, 500);
}

// Экранирование HTML для защиты от XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Форматирование даты
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU');
}

// Уведомления
function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const id = Date.now();

    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-orange-500'
    };

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    const notification = document.createElement('div');
    notification.id = `notification-${id}`;
    notification.className = `${colors[type]} text-white px-6 py-4 rounded-lg shadow-lg flex items-center space-x-3 fade-in max-w-md`;
    notification.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span class="flex-1">${message}</span>
        <button onclick="this.parentElement.remove()" class="text-white hover:text-gray-200">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(notification);

    setTimeout(() => {
        const el = document.getElementById(`notification-${id}`);
        if (el) el.remove();
    }, 5000);
}

// Переключение меню пользователя
function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    menu.classList.toggle('hidden');
}

// Закрытие меню при клике вне его
document.addEventListener('click', (e) => {
    const menu = document.getElementById('userMenu');
    const button = e.target.closest('button');

    if (menu && !menu.contains(e.target) && (!button || !button.onclick || button.onclick.toString().indexOf('toggleUserMenu') === -1)) {
        menu.classList.add('hidden');
    }
});


// ==================== Уведомления администратору ====================
let _notifData = { items: [], unread: 0 };

async function loadNotifications() {
    try {
        const res = await fetch(`${API_BASE}/api/notifications`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        _notifData = await res.json();
        renderNotifications();
    } catch (e) {
        console.error('Ошибка загрузки уведомлений:', e);
    }
}

function renderNotifications() {
    const badge = document.getElementById('notif-badge');
    if (badge) {
        if (_notifData.unread > 0) {
            badge.textContent = _notifData.unread > 99 ? '99+' : _notifData.unread;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    const list = document.getElementById('notifList');
    if (!list) return;
    const items = _notifData.items || [];
    if (items.length === 0) {
        list.innerHTML = '<div class="px-4 py-6 text-sm text-gray-500 text-center">Нет уведомлений</div>';
        return;
    }
    list.innerHTML = items.map((n) => {
        const dt = n.created_at ? new Date(n.created_at).toLocaleString('ru-RU') : '';
        const unreadCls = n.is_read ? '' : 'bg-orange-50';
        const name = escapeHtml(n.client_name || 'Без имени');
        const phone = escapeHtml(n.phone || '');
        const msg = escapeHtml(n.message || '');
        const readBtn = n.is_read ? '' : `<button onclick="markNotifRead(${n.id})" class="text-xs text-blue-600 hover:underline whitespace-nowrap">Прочитано</button>`;
        return `<div class="px-4 py-3 ${unreadCls} flex justify-between items-start gap-2">
            <div class="min-w-0">
                <div class="text-sm font-medium text-gray-800">${name} <span class="text-gray-400 font-normal">${phone}</span></div>
                <div class="text-xs text-gray-600 mt-0.5">${msg}</div>
                <div class="text-[11px] text-gray-400 mt-0.5">${dt}</div>
            </div>
            ${readBtn}
        </div>`;
    }).join('');
}

function toggleNotifications() {
    const menu = document.getElementById('notifMenu');
    if (menu) menu.classList.toggle('hidden');
    const um = document.getElementById('userMenu');
    if (um) um.classList.add('hidden');
}

async function markNotifRead(id) {
    try {
        await fetch(`${API_BASE}/api/notifications/${id}/read`, { method: 'POST', headers: getAuthHeaders() });
        await loadNotifications();
    } catch (e) { console.error(e); }
}

async function markAllNotificationsRead() {
    try {
        await fetch(`${API_BASE}/api/notifications/read-all`, { method: 'POST', headers: getAuthHeaders() });
        await loadNotifications();
    } catch (e) { console.error(e); }
}
