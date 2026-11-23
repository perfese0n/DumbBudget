/* ==========================================================================
   Dumb Budget — runs entirely in the browser.
   Expenses are saved on this device (localStorage). No server, no login.

   Quick map of this file:
     1. Settings & helpers
     2. Saving / loading data
     3. Selected month (month button, picker, arrows)
     4. "Dumb Budget" page: totals + expense list
     5. Add / edit expense pop-up
     6. "Overview" page: ring chart
     7. CSV export, backup & restore
     8. Start-up
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. Settings & helpers
   -------------------------------------------------------------------------- */

const CURRENCY = 'EUR';
const LOCALE = 'de-DE';                 // gives "1.234,56 €"
const DEFAULT_CATEGORIES = ['Bills', 'Food', 'Transport', 'Other'];
const PURCHASE_LABELS = { good: 'Good', dumb: 'Dumb' };

// Keys used to store things on this device
const STORE_EXPENSES = 'dumbbudget-expenses';
const STORE_CATEGORIES = 'dumbbudget-categories';
const STORE_THEME = 'dumbbudget-theme';

const $ = (id) => document.getElementById(id);

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });
function formatCurrency(amount) {
    return money.format(amount || 0);
}

// Format a Date as YYYY-MM-DD in local time
function toLocalISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Accepts "12,50", "12.50", "1.234,56" or "1,234.56" and returns a number
function parseAmount(text) {
    let s = String(text).trim().replace(/\s|€/g, '');
    if (s.includes(',') && s.includes('.')) {
        // Whichever comes last is the decimal separator
        s = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? s.replace(/\./g, '').replace(',', '.')
            : s.replace(/,/g, '');
    } else {
        s = s.replace(',', '.');
    }
    return Number(s);
}

function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const toast = (() => {
    const container = $('toast-container');
    return function show(message, type = 'success') {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => el.classList.add('show'), 10);
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 2000);
    };
})();

/* --------------------------------------------------------------------------
   2. Saving / loading data
   Each expense looks like:
   { id, amount, category, purchaseType: 'good' | 'dumb', date: 'YYYY-MM-DD', notes }
   -------------------------------------------------------------------------- */

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        toast('Could not save on this device!', 'error');
        return false;
    }
}

let expenses = readJSON(STORE_EXPENSES, []);
let customCategories = readJSON(STORE_CATEGORIES, []);

function saveExpenses() {
    return writeJSON(STORE_EXPENSES, expenses);
}

function allCategories() {
    return [...new Set([...DEFAULT_CATEGORIES, ...customCategories])];
}

function expensesInMonth(month) {
    const prefix = toLocalISODate(month).slice(0, 7); // "YYYY-MM"
    return expenses.filter(e => e.date.startsWith(prefix));
}

/* --------------------------------------------------------------------------
   3. Selected month (shared by both pages)
   -------------------------------------------------------------------------- */

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

let selectedMonth = firstOfMonth(new Date());
let pickerYear = selectedMonth.getFullYear();

function setSelectedMonth(date) {
    selectedMonth = firstOfMonth(date);
    const label = selectedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    document.querySelectorAll('.selected-month-label').forEach(el => { el.textContent = label; });
    renderAll();
}

function stepMonth(step) {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + step, 1));
}

function renderMonthPicker() {
    const today = new Date();
    $('pickerYear').textContent = pickerYear;
    $('pickerMonths').innerHTML = MONTH_NAMES_SHORT.map((name, i) => {
        const isSelected = pickerYear === selectedMonth.getFullYear() && i === selectedMonth.getMonth();
        const isToday = pickerYear === today.getFullYear() && i === today.getMonth();
        return `<button type="button" class="picker-month ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}" data-month="${i}">${name}</button>`;
    }).join('');
}

function openMonthPicker(open) {
    $('monthPicker').hidden = !open;
    $('monthPickerBtn').setAttribute('aria-expanded', String(open));
    if (open) {
        pickerYear = selectedMonth.getFullYear();
        renderMonthPicker();
    }
}

function initMonthNavigation() {
    $('monthPickerBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        openMonthPicker($('monthPicker').hidden);
    });
    $('pickerPrevYear').addEventListener('click', () => { pickerYear--; renderMonthPicker(); });
    $('pickerNextYear').addEventListener('click', () => { pickerYear++; renderMonthPicker(); });
    $('pickerMonths').addEventListener('click', (e) => {
        const btn = e.target.closest('.picker-month');
        if (!btn) return;
        setSelectedMonth(new Date(pickerYear, Number(btn.dataset.month), 1));
        openMonthPicker(false);
    });
    $('pickerThisMonth').addEventListener('click', () => {
        setSelectedMonth(new Date());
        openMonthPicker(false);
    });

    // Close the picker when tapping elsewhere or pressing Escape
    $('monthPicker').addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => openMonthPicker(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openMonthPicker(false); });

    // ‹ › arrows (on both pages)
    document.querySelectorAll('.month-step').forEach(btn =>
        btn.addEventListener('click', () => stepMonth(Number(btn.dataset.step))));

    // When a new month starts, move along with it — but only if you were
    // looking at the month that just ended (so it never yanks you away while browsing).
    let lastKnownMonth = firstOfMonth(new Date());
    const followCalendar = () => {
        const now = firstOfMonth(new Date());
        if (!sameMonth(now, lastKnownMonth)) {
            if (sameMonth(selectedMonth, lastKnownMonth)) setSelectedMonth(now);
            lastKnownMonth = now;
        }
    };
    setInterval(followCalendar, 60 * 1000);
    document.addEventListener('visibilitychange', followCalendar); // e.g. reopening the app
}

/* --------------------------------------------------------------------------
   4. "Dumb Budget" page: totals + expense list
   -------------------------------------------------------------------------- */

let sortField = 'date';      // 'date' or 'amount'
let sortDirection = 'desc';  // 'asc' or 'desc'

function renderBudgetPage() {
    const monthExpenses = expensesInMonth(selectedMonth);

    // Totals
    const sum = (list) => list.reduce((s, e) => s + e.amount, 0);
    $('totalSpent').textContent = formatCurrency(sum(monthExpenses));
    $('totalGood').textContent = formatCurrency(sum(monthExpenses.filter(e => e.purchaseType === 'good')));
    $('totalDumb').textContent = formatCurrency(sum(monthExpenses.filter(e => e.purchaseType === 'dumb')));

    // Sorted list
    const sorted = [...monthExpenses].sort((a, b) => {
        const diff = sortField === 'date'
            ? a.date.localeCompare(b.date)
            : a.amount - b.amount;
        return sortDirection === 'asc' ? diff : -diff;
    });

    $('transactionsList').innerHTML = sorted.length
        ? sorted.map(e => {
            const [y, m, d] = e.date.split('-');
            const purchase = e.purchaseType;
            return `
            <div class="transaction-item" data-id="${escapeHtml(e.id)}">
                <div class="transaction-content">
                    <div class="details">
                        <div class="description">
                            ${escapeHtml(e.category || 'Other')}
                            ${purchase ? `<span class="purchase-badge ${purchase}">${PURCHASE_LABELS[purchase]}</span>` : ''}
                        </div>
                        ${e.notes ? `<div class="notes">${escapeHtml(e.notes)}</div>` : ''}
                        <div class="metadata"><span class="date">${d}/${m}/${y}</span></div>
                    </div>
                    <div class="transaction-amount ${purchase || 'unrated'}">${formatCurrency(e.amount)}</div>
                </div>
                <button class="delete-transaction" aria-label="Delete expense">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>`;
        }).join('')
        : '<p class="empty-state">No expenses this month yet.</p>';
}

function initExpenseList() {
    // One click handler for the whole list: edit or delete
    $('transactionsList').addEventListener('click', (e) => {
        const item = e.target.closest('.transaction-item');
        if (!item) return;
        const expense = expenses.find(x => x.id === item.dataset.id);
        if (!expense) return;

        if (e.target.closest('.delete-transaction')) {
            if (confirm(`Delete ${expense.category} (${formatCurrency(expense.amount)})?`)) {
                expenses = expenses.filter(x => x.id !== expense.id);
                saveExpenses();
                renderAll();
                toast('Expense deleted', 'error');
            }
        } else {
            openExpenseModal(expense);
        }
    });

    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
        sortField = btn.dataset.sort;
        renderBudgetPage();
    }));
    $('sortDirection').addEventListener('click', () => {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        $('sortDirection').classList.toggle('descending', sortDirection === 'desc');
        renderBudgetPage();
    });
}

/* --------------------------------------------------------------------------
   5. Add / edit expense pop-up
   -------------------------------------------------------------------------- */

let editingId = null; // null = adding a new expense

function fillCategoryDropdown(selected) {
    const select = $('category');
    select.innerHTML = allCategories()
        .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join('') + '<option value="add_new">+ Add Category</option>';
    if (selected) {
        // Keep a category that was deleted from the list but is still used
        if (!allCategories().includes(selected)) {
            select.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>`);
        }
        select.value = selected;
    }
}

function showCustomCategoryInput(show) {
    $('customCategoryField').style.display = show ? 'block' : 'none';
    $('category').style.display = show ? 'none' : 'block';
    if (show) $('customCategory').focus();
}

function openExpenseModal(expense = null) {
    editingId = expense ? expense.id : null;
    $('expenseForm').reset();
    showCustomCategoryInput(false);
    fillCategoryDropdown(expense ? expense.category : DEFAULT_CATEGORIES[0]);

    $('modalTitle').textContent = expense ? 'Edit expense' : 'Add expense';
    $('submitBtn').textContent = expense ? 'Save' : 'Add';
    $('amount').value = expense ? String(expense.amount).replace('.', ',') : '';
    $('purchaseType').value = expense ? (expense.purchaseType || '') : '';
    $('notes').value = expense ? (expense.notes || '') : '';

    // New expense: today if you're on the current month, else the 1st of the month you're viewing
    $('expenseDate').value = expense
        ? expense.date
        : (sameMonth(selectedMonth, new Date()) ? toLocalISODate(new Date()) : toLocalISODate(selectedMonth));

    $('expenseModal').classList.add('active');
}

function closeExpenseModal() {
    $('expenseModal').classList.remove('active');
    editingId = null;
}

function initExpenseModal() {
    $('addExpenseBtn').addEventListener('click', () => openExpenseModal());
    document.querySelector('.close-modal').addEventListener('click', closeExpenseModal);
    $('expenseModal').addEventListener('click', (e) => { if (e.target === $('expenseModal')) closeExpenseModal(); });

    // Custom categories
    $('category').addEventListener('change', (e) => {
        if (e.target.value === 'add_new') showCustomCategoryInput(true);
    });
    $('saveCategory').addEventListener('click', () => {
        const name = $('customCategory').value.trim();
        if (!name) return;
        if (!allCategories().includes(name)) {
            customCategories.push(name);
            writeJSON(STORE_CATEGORIES, customCategories);
            toast(`Category "${name}" added`);
        }
        fillCategoryDropdown(name);
        $('customCategory').value = '';
        showCustomCategoryInput(false);
    });
    $('cancelCategory').addEventListener('click', () => {
        fillCategoryDropdown(DEFAULT_CATEGORIES[0]);
        $('customCategory').value = '';
        showCustomCategoryInput(false);
    });
    $('customCategory').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); $('saveCategory').click(); }
    });

    // Save
    $('expenseForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = parseAmount($('amount').value);
        if (!(amount > 0)) {
            toast('Please enter a valid amount', 'error');
            $('amount').focus();
            return;
        }
        if ($('category').value === 'add_new') {
            toast('Please pick a category', 'error');
            return;
        }

        const data = {
            amount: Math.round(amount * 100) / 100,
            category: $('category').value,
            purchaseType: $('purchaseType').value,
            date: $('expenseDate').value,
            notes: $('notes').value.trim()
        };

        if (editingId) {
            expenses = expenses.map(x => x.id === editingId ? { ...x, ...data } : x);
        } else {
            expenses.push({ id: newId(), ...data });
        }
        if (!saveExpenses()) return;

        closeExpenseModal();
        // Jump to the month of the expense, so you can see it
        if (!sameMonth(new Date(data.date + 'T00:00'), selectedMonth)) {
            setSelectedMonth(new Date(data.date + 'T00:00'));
        } else {
            renderAll();
        }
        toast('Expense saved!');
    });
}

/* --------------------------------------------------------------------------
   6. "Overview" page: ring chart of the month's spending
   -------------------------------------------------------------------------- */

// Colours that read well on the dark background
const CATEGORY_COLORS = [
    '#5B8DEF', '#F2A65A', '#56C596', '#E86A92', '#B48CF2', '#4FC1E9',
    '#F6D365', '#FF7F6E', '#8BD3A0', '#C9A0DC', '#7AA6C2', '#E5B181'
];

// Simple line icons (24x24)
const ICONS = {
    food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    groceries: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    drinks: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    transport: '<rect x="4" y="3" width="16" height="13" rx="3"/><path d="M4 10h16"/><path d="M8 16l-2 5M16 16l2 5"/>',
    bills: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    shopping: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    health: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    sport: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    travel: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    fun: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    subscriptions: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    other: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'
};

// Which icon a category gets, based on words in its name (first match wins).
// Add your own words here to change the icons.
const ICON_KEYWORDS = [
    ['groceries', ['grocer', 'supermarket', 'delhaize', 'colruyt', 'carrefour', 'aldi', 'lidl']],
    ['drinks', ['drink', 'coffee', 'bar', 'beer', 'going out', 'night']],
    ['food', ['food', 'restaurant', 'eat', 'lunch', 'dinner', 'takeaway', 'delivery']],
    ['transport', ['transport', 'taxi', 'uber', 'train', 'bus', 'metro', 'stib', 'car', 'fuel', 'parking']],
    ['home', ['rent', 'home', 'house', 'apartment', 'mortgage']],
    ['bills', ['bill', 'utilit', 'electric', 'gas', 'water', 'insurance', 'tax']],
    ['shopping', ['cloth', 'shop', 'fashion', 'amazon']],
    ['health', ['health', 'doctor', 'pharma', 'medic', 'dentist']],
    ['sport', ['sport', 'gym', 'fitness', 'tennis', 'climb', 'boulder', 'swim', 'run']],
    ['phone', ['phone', 'mobile', 'internet']],
    ['travel', ['travel', 'trip', 'flight', 'hotel', 'holiday', 'vacation']],
    ['fun', ['fun', 'entertain', 'movie', 'cinema', 'game', 'concert']],
    ['subscriptions', ['subscri', 'netflix', 'spotify', 'streaming']],
    ['gift', ['gift', 'present']]
];

function iconFor(category) {
    const name = (category || '').toLowerCase();
    for (const [icon, words] of ICON_KEYWORDS) {
        if (words.some(w => name.includes(w))) return ICONS[icon];
    }
    return ICONS.other;
}

function renderOverview() {
    const monthExpenses = expensesInMonth(selectedMonth);

    // Add up spending per category, and good vs dumb
    const byCategory = {};
    let total = 0, good = 0, dumb = 0;
    for (const e of monthExpenses) {
        const cat = e.category || 'Other';
        byCategory[cat] = (byCategory[cat] || 0) + e.amount;
        total += e.amount;
        if (e.purchaseType === 'good') good += e.amount;
        if (e.purchaseType === 'dumb') dumb += e.amount;
    }

    // Fixed colour per category (dropdown order), so colours stay the same month to month
    const allCats = [...new Set([...allCategories(), ...Object.keys(byCategory)])];
    const colorOf = {};
    allCats.forEach((c, i) => { colorOf[c] = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });

    // Icons around the ring: categories with spending first, then the rest (max 12)
    const ringCats = [...allCats]
        .sort((a, b) => (byCategory[b] || 0) - (byCategory[a] || 0))
        .slice(0, 12);

    // Donut ring: one dashed circle per category
    const radius = 38;
    const circumference = 2 * Math.PI * radius;
    const spent = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    let offset = 0;
    let segments = `<circle class="ring-track" cx="50" cy="50" r="${radius}"/>`;
    for (const [cat, amount] of spent) {
        const length = (amount / total) * circumference;
        const gap = spent.length > 1 ? 0.8 : 0;
        segments += `<circle class="ring-segment" cx="50" cy="50" r="${radius}"
            stroke="${colorOf[cat]}"
            stroke-dasharray="${Math.max(length - gap, 0)} ${circumference}"
            stroke-dashoffset="${-offset}"></circle>`;
        offset += length;
    }
    $('ringSvg').innerHTML = segments;

    // Centre text
    $('ringTotal').textContent = formatCurrency(total);
    $('ringGood').textContent = `Good ${formatCurrency(good)}`;
    $('ringDumb').textContent = `Dumb ${formatCurrency(dumb)}`;

    // Category icons in a circle around the ring
    $('ringIcons').innerHTML = ringCats.map((cat, i) => {
        const angle = (i / ringCats.length) * 2 * Math.PI - Math.PI / 2; // start at the top
        const x = 50 + 43 * Math.cos(angle);
        const y = 50 + 43 * Math.sin(angle);
        const amount = byCategory[cat] || 0;
        const pct = total ? Math.round((amount / total) * 100) : 0;
        return `
            <div class="ring-icon ${amount ? '' : 'empty'}" style="left:${x}%; top:${y}%; color:${colorOf[cat]}" title="${escapeHtml(cat)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconFor(cat)}</svg>
                <span class="ring-pct">${amount ? pct + '%' : ''}</span>
            </div>`;
    }).join('');

    // Good vs dumb bar
    const rated = good + dumb;
    const goodPct = rated ? Math.round((good / rated) * 100) : 0;
    const dumbPct = rated ? 100 - goodPct : 0;
    $('goodPct').textContent = `Good ${goodPct}%`;
    $('dumbPct').textContent = `Dumb ${dumbPct}%`;
    $('splitBarGood').style.width = `${goodPct}%`;
    $('splitBarDumb').style.width = `${dumbPct}%`;

    // Category list
    $('categoryList').innerHTML = spent.length
        ? spent.map(([cat, amount]) => `
            <div class="category-row">
                <span class="category-icon" style="color:${colorOf[cat]}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconFor(cat)}</svg>
                </span>
                <span class="category-name">${escapeHtml(cat)}</span>
                <span class="category-pct">${Math.round((amount / total) * 100)}%</span>
                <span class="category-amount">${formatCurrency(amount)}</span>
            </div>`).join('')
        : '<p class="empty-state">No expenses this month yet.</p>';
}

/* Page tabs */
function showView(view) {
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $('budgetView').hidden = view !== 'budget';
    $('overviewView').hidden = view !== 'overview';
    history.replaceState(null, '', view === 'overview' ? '#overview' : window.location.pathname);
    renderAll();
}

function renderAll() {
    if (!$('budgetView').hidden) renderBudgetPage();
    if (!$('overviewView').hidden) renderOverview();
}

/* --------------------------------------------------------------------------
   7. CSV export, backup & restore
   -------------------------------------------------------------------------- */

// Hand a file to the user: share sheet on phones (save to Files, send, ...), download otherwise
async function deliverFile(filename, text, mimeType) {
    const file = new File([text], filename, { type: mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // user closed the share sheet
        }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
    const csvCell = (v) => {
        const s = String(v ?? '').replace(/"/g, '""');
        return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const rows = expensesInMonth(selectedMonth)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(e => [e.date, csvCell(e.category), e.purchaseType || '', csvCell(e.notes), e.amount].join(','));
    const month = toLocalISODate(selectedMonth).slice(0, 7);
    deliverFile(`dumb-budget-${month}.csv`, ['Date,Category,Purchase,Notes,Amount', ...rows].join('\n'), 'text/csv');
}

function backup() {
    const data = {
        app: 'dumb-budget',
        version: 1,
        exportedAt: new Date().toISOString(),
        categories: customCategories,
        expenses
    };
    deliverFile(`dumb-budget-backup-${toLocalISODate(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
}

// Turn a backup file into a list of expenses. Also understands the
// data/transactions.json file from the laptop (server) version of the app.
function readBackup(data) {
    if (data && Array.isArray(data.expenses)) {
        return { expenses: data.expenses, categories: data.categories || [] };
    }
    const list = [];
    for (const month of Object.values(data || {})) {
        for (const e of (month && month.expenses) || []) {
            list.push({
                id: e.id, amount: e.amount, category: e.category, purchaseType: e.purchaseType || '',
                date: e.date, notes: e.notes || ''
            });
        }
    }
    return { expenses: list, categories: [] };
}

function restore(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const { expenses: incoming, categories } = readBackup(JSON.parse(reader.result));
            const valid = incoming.filter(e =>
                e && typeof e.amount === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''));
            if (!valid.length) throw new Error('No expenses found');

            // Add what isn't there yet (matching on id), so restoring twice is harmless
            const known = new Set(expenses.map(e => e.id));
            let added = 0;
            for (const e of valid) {
                const id = e.id || newId();
                if (known.has(id)) continue;
                expenses.push({
                    id, amount: e.amount, category: String(e.category || 'Other'),
                    purchaseType: e.purchaseType === 'good' || e.purchaseType === 'dumb' ? e.purchaseType : '',
                    date: e.date, notes: String(e.notes || '')
                });
                known.add(id);
                added++;
            }
            for (const c of categories) {
                if (typeof c === 'string' && !allCategories().includes(c)) customCategories.push(c);
            }
            // Categories used by restored expenses become pickable too
            for (const e of expenses) {
                if (e.category && !allCategories().includes(e.category)) customCategories.push(e.category);
            }
            writeJSON(STORE_CATEGORIES, customCategories);
            saveExpenses();
            renderAll();
            toast(added ? `Restored ${added} expense${added === 1 ? '' : 's'}` : 'Nothing new to restore');
        } catch (e) {
            toast("That file doesn't look like a Dumb Budget backup", 'error');
        }
    };
    reader.readAsText(file);
}

function initExportButtons() {
    $('exportCsvBtn').addEventListener('click', exportCsv);
    $('backupBtn').addEventListener('click', backup);
    $('restoreBtn').addEventListener('click', () => $('restoreFile').click());
    $('restoreFile').addEventListener('change', (e) => {
        if (e.target.files[0]) restore(e.target.files[0]);
        e.target.value = '';
    });
}

/* --------------------------------------------------------------------------
   8. Start-up
   -------------------------------------------------------------------------- */

function initThemeToggle() {
    $('themeToggle').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem(STORE_THEME, next); } catch (e) {}
    });
}

function start() {
    initThemeToggle();
    initMonthNavigation();
    initExpenseList();
    initExpenseModal();
    initExportButtons();
    document.querySelectorAll('.view-tab').forEach(tab =>
        tab.addEventListener('click', () => showView(tab.dataset.view)));

    setSelectedMonth(new Date());
    showView(window.location.hash === '#overview' ? 'overview' : 'budget');

    // Ask the browser to never auto-delete this app's data
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

    // Offline support + "install" as an app
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

start();
