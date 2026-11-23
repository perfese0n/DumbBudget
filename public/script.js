import { ToastManager } from "./managers/toast";
const toastManager = new ToastManager(document.getElementById('toast-container'));

// Global variables
let currentTransactionType = 'expense'; // This app only tracks expenses
let currentFilter = null; // null = show all, 'income' = only income, 'expense' = only expenses
let editingTransactionId = null;
let currentSortField = 'date';
let currentSortDirection = 'desc';

// Theme toggle functionality
function getBaseUrl() {
    // First try to get it from the server-provided meta tag
    const metaBaseUrl = document.querySelector('meta[name="base-url"]')?.content;
    if (metaBaseUrl) return metaBaseUrl;
    
    // Fallback to window.location.origin
    return window.location.origin;
}

function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Set initial theme based on system preference
    if (localStorage.getItem('theme') === null) {
        document.documentElement.setAttribute('data-theme', prefersDark.matches ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', localStorage.getItem('theme'));
    }

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        document.documentElement.style.setProperty('--is-dark', newTheme === 'dark' ? '1' : '0');
        localStorage.setItem('theme', newTheme);
    });
}

// Debug logging
function debugLog(...args) {
    if (window.appConfig?.debug) {
        console.log('[DEBUG]', ...args);
    }
}

// HTML escaping function to prevent XSS attacks
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper function to join paths with base path
function joinPath(path) {
    const basePath = window.appConfig?.basePath || '';
    debugLog('joinPath input:', path);
    debugLog('basePath:', basePath);
    
    // If path starts with http(s), return as is
    if (path.match(/^https?:\/\//)) {
        debugLog('Absolute URL detected, returning as is:', path);
        return path;
    }
    
    // Remove any leading slash from path and trailing slash from basePath
    const cleanPath = path.replace(/^\/+/, '');
    const cleanBase = basePath.replace(/\/+$/, '');
    
    // Join with single slash
    const result = cleanBase ? `${cleanBase}/${cleanPath}` : cleanPath;
    debugLog('joinPath result:', result);
    return result;
}

// Fetch config with instance name
async function updateInstanceName() {
    try {
        const res = await fetch(joinPath('api/config'), fetchConfig);
        const data = await res.json();
        document.title = data.instanceName;
        document.getElementById('instance-name').textContent = data.instanceName;
    } catch (error) {
        console.error('Error fetching instance name, falling back to default. Error: ', error);
        document.title = 'DumbBudget';
        document.getElementById('instance-name').textContent = 'DumbBudget';
    }
}

// PIN input functionality
function setupPinInputs() {
    const form = document.getElementById('pinForm');
    if (!form) return; // Only run on login page

    debugLog('Setting up PIN inputs');
    // Fetch PIN length from server

    fetch(joinPath('pin-length'))

        .then(response => response.json())
        .then(data => {
            const pinLength = data.length;
            debugLog('PIN length:', pinLength);
            const container = document.querySelector('.pin-input-container');
            
            // Create PIN input fields
            for (let i = 0; i < pinLength; i++) {
                const input = document.createElement('input');
                input.type = 'password';
                input.maxLength = 1;
                input.className = 'pin-input';
                input.setAttribute('inputmode', 'numeric');
                input.pattern = '[0-9]*';
                input.setAttribute('autocomplete', 'off');
                container.appendChild(input);
            }

            // Handle input behavior
            const inputs = container.querySelectorAll('.pin-input');
            
            // Focus first input immediately
            if (inputs.length > 0) {
                inputs[0].focus();
            }

            inputs.forEach((input, index) => {
                input.addEventListener('input', (e) => {
                    // Only allow numbers
                    e.target.value = e.target.value.replace(/[^0-9]/g, '');
                    
                    if (e.target.value) {
                        e.target.classList.add('has-value');
                        if (index < inputs.length - 1) {
                            inputs[index + 1].focus();
                        } else {
                            // Last digit entered, submit the form
                            const pin = Array.from(inputs).map(input => input.value).join('');
                            submitPin(pin, inputs);
                        }
                    } else {
                        e.target.classList.remove('has-value');
                    }
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && !e.target.value && index > 0) {
                        inputs[index - 1].focus();
                    }
                });

                // Prevent paste of multiple characters
                input.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pastedData = e.clipboardData.getData('text');
                    const numbers = pastedData.match(/\d/g);
                    
                    if (numbers) {
                        numbers.forEach((num, i) => {
                            if (inputs[index + i]) {
                                inputs[index + i].value = num;
                                inputs[index + i].classList.add('has-value');
                                if (index + i + 1 < inputs.length) {
                                    inputs[index + i + 1].focus();
                                } else {
                                    // If paste fills all inputs, submit the form
                                    const pin = Array.from(inputs).map(input => input.value).join('');
                                    submitPin(pin, inputs);
                                }
                            }
                        });
                    }
                });
            });
        });
}

// Handle PIN submission with debug logging
function submitPin(pin, inputs) {
    debugLog('Submitting PIN');
    const errorElement = document.querySelector('.pin-error');
    

    fetch(joinPath('verify-pin'), {

        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin })
    })
    .then(async response => {
        const data = await response.json();
        debugLog('PIN verification response:', response.status);
        
        if (response.ok) {
            debugLog('PIN verified, redirecting to home');
            window.location.pathname = joinPath('/');
        } else if (response.status === 429) {
            debugLog('Account locked out');
            // Handle lockout
            errorElement.textContent = data.error;
            errorElement.setAttribute('aria-hidden', 'false');
            inputs.forEach(input => {
                input.value = '';
                input.classList.remove('has-value');
                input.disabled = true;
            });
        } else {
            // Handle invalid PIN
            const message = data.attemptsLeft > 0 
                ? `Incorrect PIN. ${data.attemptsLeft} attempts remaining.` 
                : 'Incorrect PIN. Last attempt before lockout.';
            
            errorElement.textContent = message;
            errorElement.setAttribute('aria-hidden', 'false');
            inputs.forEach(input => {
                input.value = '';
                input.classList.remove('has-value');
            });
            inputs[0].focus();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        debugLog('PIN verification error:', error);
        errorElement.textContent = 'An error occurred. Please try again.';
        errorElement.setAttribute('aria-hidden', 'false');
    });
}

// Supported currencies list
const SUPPORTED_CURRENCIES = {
    USD: { locale: 'en-US', symbol: '$' },
    EUR: { locale: 'de-DE', symbol: '€' },
    GBP: { locale: 'en-GB', symbol: '£' },
    JPY: { locale: 'ja-JP', symbol: '¥' },
    AUD: { locale: 'en-AU', symbol: 'A$' },
    CAD: { locale: 'en-CA', symbol: 'C$' },
    CHF: { locale: 'de-CH', symbol: 'CHF' },
    CNY: { locale: 'zh-CN', symbol: '¥' },
    HKD: { locale: 'zh-HK', symbol: 'HK$' },
    NZD: { locale: 'en-NZ', symbol: 'NZ$' },
    MXN: { locale: 'es-MX', symbol: '$' },
    RUB: { locale: 'ru-RU', symbol: '₽' },
    SGD: { locale: 'en-SG', symbol: 'S$' },
    KRW: { locale: 'ko-KR', symbol: '₩' },
    INR: { locale: 'en-IN', symbol: '₹' },
    BRL: { locale: 'pt-BR', symbol: 'R$' },
    ZAR: { locale: 'en-ZA', symbol: 'R' },
    TRY: { locale: 'tr-TR', symbol: '₺' },
    PLN: { locale: 'pl-PL', symbol: 'zł' },
    SEK: { locale: 'sv-SE', symbol: 'kr' },
    NOK: { locale: 'nb-NO', symbol: 'kr' },
    DKK: { locale: 'da-DK', symbol: 'kr' },
    IDR: { locale: 'id-ID', symbol: 'Rp' },
    PHP: { locale: 'fil-PH', symbol: '₱' },
    PKR: { locale: 'en-PK', symbol: 'Rs' }
};

let currentCurrency = 'USD'; // Default currency

// Fetch current currency from server
async function fetchCurrentCurrency() {
    try {
        debugLog('Fetching current currency');
        const response = await fetch(joinPath('api/settings/currency'), fetchConfig);
        await handleFetchResponse(response);
        const data = await response.json();
        currentCurrency = data.currency;
        debugLog('Current currency set to:', currentCurrency);
    } catch (error) {
        console.error('Error fetching currency:', error);
        debugLog('Falling back to USD');
        // Fallback to USD if there's an error
        currentCurrency = 'USD';
    }
}

// Update the formatCurrency function to use the current currency
const formatCurrency = (amount) => {
    const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
    return new Intl.NumberFormat(currencyInfo.locale, {
        style: 'currency',
        currency: currentCurrency
    }).format(amount);
};

let currentDate = new Date();

// Format a Date as YYYY-MM-DD in *local* time.
// (toISOString() uses UTC, which shifts dates by a day in Belgium.)
function toLocalISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const PURCHASE_LABELS = { good: 'Good', dumb: 'Dumb' };

// Shared fetch configuration with debug logging
const fetchConfig = {
    credentials: 'include',
    headers: {
        'Content-Type': 'application/json'
    }
};

// Handle session errors - only for main app, not login
async function handleFetchResponse(response) {
    debugLog('Fetch response:', response.status, response.url);
    
    // If we're already on the login page, don't redirect
    if (window.location.pathname.includes('login')) {
        return response;
    }

    // Handle unauthorized responses
    if (response.status === 401) {
        debugLog('Unauthorized, redirecting to login');
        window.location.href = joinPath('login');
        return null;
    }

    // Handle other error responses
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType || (!contentType.includes('application/json') && contentType.split(';')[0].trim() !== 'text/csv')) {
        debugLog('Response is not JSON or CSV, session likely expired');
        window.location.href = joinPath('login');
        return null;
    }

    return response;
}

// Update loadTransactions function
async function loadTransactions() {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const response = await fetch(joinPath(`api/transactions/range?start=${startDate}&end=${endDate}`), fetchConfig);
        await handleFetchResponse(response);
        const transactions = await response.json();
        
        const transactionsList = document.getElementById('transactionsList');
        // Only expenses are shown in this version of the app
        let filteredTransactions = transactions.filter(t => t.type === 'expense');
            
        // Sort transactions
        filteredTransactions.sort((a, b) => {
            if (currentSortField === 'date') {
                // Use string comparison for dates to avoid timezone issues
                return currentSortDirection === 'asc' 
                    ? a.date.localeCompare(b.date) 
                    : b.date.localeCompare(a.date);
            } else {
                return currentSortDirection === 'asc' ? a.amount - b.amount : b.amount - a.amount;
            }
        });
            
        transactionsList.innerHTML = filteredTransactions.map(transaction => {
            // Show the date as DD/MM/YYYY (no timezone conversion)
            const [year, month, day] = transaction.date.split('-');
            const formattedDate = `${day}/${month}/${year}`;

            const isRecurring = transaction.isRecurringInstance || transaction.recurring;
            const purchase = transaction.purchaseType; // 'good', 'dumb' or undefined

            return `
            <div class="transaction-item ${isRecurring ? 'recurring-instance' : ''}" data-id="${transaction.id}" data-type="${transaction.type}">
                <div class="transaction-content">
                    <div class="details">
                        <div class="description">
                            ${escapeHtml(transaction.category || 'Other')}
                            ${purchase ? `<span class="purchase-badge ${purchase}">${PURCHASE_LABELS[purchase]}</span>` : ''}
                        </div>
                        ${transaction.notes ? `<div class="notes">${escapeHtml(transaction.notes)}</div>` : ''}
                        <div class="metadata">
                            <span class="date">${formattedDate}</span>
                            ${isRecurring ? `<span class="recurring-info">(Recurring)</span>` : ''}
                        </div>
                    </div>
                    <div class="transaction-amount ${purchase || 'unrated'}">
                        ${formatCurrency(transaction.amount)}
                    </div>
                </div>
                <button class="delete-transaction" aria-label="Delete transaction">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `}).join('');

        // Add click handlers for editing and deleting
        transactionsList.querySelectorAll('.transaction-item').forEach(item => {
            const deleteBtn = item.querySelector('.delete-transaction');
            const content = item.querySelector('.transaction-content');
            const isRecurring = item.classList.contains('recurring-instance');

            // Edit handler for all transactions
            content.addEventListener('click', () => {
                const id = item.dataset.id;
                const type = item.dataset.type;
                const isRecurring = item.classList.contains('recurring-instance');
                
                // For recurring instances, get the parent transaction
                let transaction = filteredTransactions.find(t => t.id === id);
                if (isRecurring) {
                    const parentId = id.match(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+/)[0];
                    transaction = filteredTransactions.find(t => t.id === parentId) || transaction;
                }
                
                editTransaction(id, transaction, isRecurring);
            });

            // Delete handler
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = item.dataset.id;
                const isRecurring = item.classList.contains('recurring-instance');
                
                // For recurring instances, get the parent ID (the UUID part before the timestamp)
                const transactionId = isRecurring ? id.match(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+/)[0] : id;
                
                const message = isRecurring ? 
                    'Are you sure you want to delete this recurring transaction? This will delete ALL instances of this transaction.' :
                    'Are you sure you want to delete this transaction?';
                
                if (confirm(message)) {
                    try {
                        debugLog('Deleting transaction with ID:', transactionId);
                        const response = await fetch(joinPath(`api/transactions/${transactionId}`), {
                            ...fetchConfig,
                            method: 'DELETE'
                        });
                        await handleFetchResponse(response);
                        await loadTransactions();
                        await updateTotals();
                        toastManager.show('Expense deleted', 'error');
                    } catch (error) {
                        console.error('Error deleting transaction:', error);
                        toastManager.show('Failed to delete transaction. Please try again.', 'error');
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

// Update editTransaction function
function editTransaction(id, transaction, isRecurringInstance) {
    // For recurring instances, always use the base transaction ID
    if (isRecurringInstance) {
        // Extract the base transaction ID (everything before the date)
        editingTransactionId = id.split('-202')[0]; // This will get the UUID part before the date
        
        // Find the original transaction to get its start date
        const startDate = transaction.recurring?.startDate || transaction.date;
        transaction = { ...transaction, date: startDate };
    } else {
        editingTransactionId = id;
    }

    const modal = document.getElementById('transactionModal');
    const form = document.getElementById('transactionForm');
    const recurringCheckbox = document.getElementById('recurring-checkbox');
    const recurringOptions = document.getElementById('recurring-options');
    const recurringWeekday = document.getElementById('recurring-weekday');
    const recurringInterval = document.getElementById('recurring-interval');
    const recurringUnit = document.getElementById('recurring-unit');
    const dayOfMonthSelect = document.getElementById('day-of-month-select');

    // Set form values
    document.getElementById('amount').value = transaction.amount;
    document.getElementById('purchaseType').value = transaction.purchaseType || '';
    document.getElementById('modalTitle').textContent = 'Edit expense';
    document.getElementById('transactionDate').value = transaction.date;
    document.getElementById('notes').value = transaction.notes || '';
    
    currentTransactionType = 'expense';
    document.getElementById('category').value = transaction.category || 'Other';

    // Set recurring options if this is a recurring transaction
    if (transaction.recurring) {
        recurringCheckbox.checked = true;
        recurringOptions.style.display = 'block';
        
        // Parse the recurring pattern
        const pattern = transaction.recurring.pattern;
        const monthlyDayMatch = pattern.match(/every (\d+)(?:st|nd|rd|th) of the month/);
        const regularMatch = pattern.match(/every (\d+) (day|week|month|year)(?:\s+on\s+(\w+))?/);
        
        if (monthlyDayMatch) {
            recurringUnit.value = 'day of month';
            dayOfMonthSelect.value = monthlyDayMatch[1];
            dayOfMonthSelect.style.display = 'inline-block';
            recurringInterval.style.display = 'none';
            recurringWeekday.style.display = 'none';
        } else if (regularMatch) {
            const [, interval, unit, weekday] = regularMatch;
            recurringInterval.value = interval;
            recurringUnit.value = unit;
            recurringInterval.style.display = 'inline-block';
            dayOfMonthSelect.style.display = 'none';
            
            if (unit === 'week' && weekday) {
                recurringWeekday.style.display = 'inline-block';
                recurringWeekday.value = weekday;
            } else {
                recurringWeekday.style.display = 'none';
            }
        }
    } else {
        recurringCheckbox.checked = false;
        recurringOptions.style.display = 'none';
        recurringWeekday.style.display = 'none';
        recurringInterval.style.display = 'inline-block';
        dayOfMonthSelect.style.display = 'none';
    }

    // Update form submit button text
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Update';

    // Show modal
    modal.classList.add('active');
}

async function updateTotals() {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        const response = await fetch(joinPath(`api/totals/range?start=${startDate}&end=${endDate}`), fetchConfig);
        await handleFetchResponse(response);
        const totals = await response.json();
        document.getElementById('totalSpent').textContent = formatCurrency(totals.expenses);
        document.getElementById('totalGood').textContent = formatCurrency(totals.good || 0);
        document.getElementById('totalDumb').textContent = formatCurrency(totals.dumb || 0);
    } catch (error) {
        console.error('Error updating totals:', error);
    }
}

// Custom Categories Management
function loadCustomCategories() {
    const customCategories = JSON.parse(localStorage.getItem('customCategories') || '[]');
    const categorySelect = document.getElementById('category');
    const addNewOption = categorySelect.querySelector('option[value="add_new"]');
    
    // Remove existing custom categories
    Array.from(categorySelect.options).forEach(option => {
        if (option.dataset.custom === 'true') {
            categorySelect.removeChild(option);
        }
    });
    
    // Add custom categories before the "Add Category" option
    customCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        option.dataset.custom = 'true';
        categorySelect.insertBefore(option, addNewOption);
    });
}

function saveCustomCategory(category) {
    try {
        const customCategories = JSON.parse(localStorage.getItem('customCategories') || '[]');
        if (!customCategories.includes(category)) {
            customCategories.push(category);
            localStorage.setItem('customCategories', JSON.stringify(customCategories));
            toastManager.show(`New category (${category}) added!`, 'success');
        }
        loadCustomCategories();
    }
    catch (error) {
        console.error('Error saving custom category:', error);
        toastManager.show('Failed to save custom category. Please try again.', 'error');
    }
}

function initCategoryHandling() {
    const categorySelect = document.getElementById('category');
    const customCategoryField = document.getElementById('customCategoryField');
    const customCategoryInput = document.getElementById('customCategory');
    const saveCategoryBtn = document.getElementById('saveCategory');
    const cancelCategoryBtn = document.getElementById('cancelCategory');

    // Load custom categories on page load
    loadCustomCategories();

    categorySelect.addEventListener('change', (e) => {
        if (e.target.value === 'add_new') {
            customCategoryField.style.display = 'block';
            categorySelect.style.display = 'none';
            customCategoryInput.focus();
        }
    });

    saveCategoryBtn.addEventListener('click', () => {
        const newCategory = customCategoryInput.value.trim();
        if (newCategory) {
            saveCustomCategory(newCategory);
            customCategoryField.style.display = 'none';
            categorySelect.style.display = 'block';
            categorySelect.value = newCategory;
            customCategoryInput.value = '';
        }
    });

    cancelCategoryBtn.addEventListener('click', () => {
        customCategoryField.style.display = 'none';
        categorySelect.style.display = 'block';
        categorySelect.value = 'Other';
        customCategoryInput.value = '';
    });

    // Handle Enter key in custom category input
    customCategoryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveCategoryBtn.click();
        }
    });
}

// Update the initModalHandling function to include category handling
function initModalHandling() {
    const modal = document.getElementById('transactionModal');
    // Only initialize if we're on the main page
    if (!modal) return;

    const addTransactionBtn = document.getElementById('addTransactionBtn');
    const closeModalBtn = document.querySelector('.close-modal');
    const transactionForm = document.getElementById('transactionForm');
    const amountInput = document.getElementById('amount');

    // Initialize category handling
    initCategoryHandling();

    // Create and add recurring controls
    const recurringControls = createRecurringControls();
    // Put the "Recurring" option just above the submit button
    transactionForm.insertBefore(recurringControls, transactionForm.querySelector('button[type="submit"]'));
    recurringControls.style.display = 'block';

    // Update amount input placeholder with current currency symbol
    function updateAmountPlaceholder() {
        const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
        amountInput.placeholder = `Amount (${currencyInfo.symbol})`;
    }

    // Open modal
    addTransactionBtn.addEventListener('click', () => {
        modal.classList.add('active');
        // Reset form
        transactionForm.reset();
        document.getElementById('modalTitle').textContent = 'Add expense';
        document.getElementById('purchaseType').value = '';
        currentTransactionType = 'expense';

        // Reset recurring options
        document.getElementById('recurring-checkbox').checked = false;
        document.getElementById('recurring-options').style.display = 'none';
        document.getElementById('recurring-weekday').style.display = 'none';
        
        // Set today's date as default
        document.getElementById('transactionDate').value = toLocalISODate(new Date());

        // Update amount placeholder with current currency
        updateAmountPlaceholder();
    });

    // Close modal
    const closeModal = () => {
        modal.classList.remove('active');
        editingTransactionId = null;
        const submitBtn = transactionForm.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Add';
    };

    closeModalBtn.addEventListener('click', closeModal);

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Update form submission
    transactionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            type: currentTransactionType,
            amount: parseFloat(document.getElementById('amount').value),
            description: '',
            category: document.getElementById('category').value,
            purchaseType: document.getElementById('purchaseType').value,
            date: document.getElementById('transactionDate').value,
            recurring: buildRecurringPattern(),
            notes: document.getElementById('notes').value
        };

        try {
            const url = editingTransactionId 
                ? joinPath(`api/transactions/${editingTransactionId}`)
                : joinPath('api/transactions');
                
            const method = editingTransactionId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                ...fetchConfig,
                method,
                body: JSON.stringify(formData)
            });

            await handleFetchResponse(response);
            
            // Reset editing state
            editingTransactionId = null;
            
            // Update submit button text
            const submitBtn = transactionForm.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Add';
            
            // Close modal and reset form
            closeModal();
            transactionForm.reset();
            
            // Refresh transactions list and totals
            await loadTransactions();
            await updateTotals();

            toastManager.show('Expense saved!', 'success');
        } catch (error) {
            console.error('Error saving transaction:', error);
            toastManager.show('Failed to save transaction. Please try again.', 'error');
        }
    });
}

// Add recurring transaction UI elements
function createRecurringControls() {
    const container = document.createElement('div');
    container.className = 'recurring-controls';

    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'recurring-checkbox-wrapper';
    checkboxWrapper.style.display = 'flex';
    checkboxWrapper.style.alignItems = 'center';
    checkboxWrapper.style.gap = '0.5rem';
    checkboxWrapper.style.marginBottom = '1rem';
    checkboxWrapper.style.width = 'fit-content';
    checkboxWrapper.style.minWidth = '100px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'recurring-checkbox';
    checkbox.style.margin = '0';

    const label = document.createElement('label');
    label.htmlFor = 'recurring-checkbox';
    label.textContent = 'Recurring';
    label.style.margin = '0';
    label.style.padding = '0';
    label.style.cursor = 'pointer';
    label.style.userSelect = 'none';

    checkboxWrapper.appendChild(checkbox);
    checkboxWrapper.appendChild(label);

    const optionsDiv = document.createElement('div');
    optionsDiv.id = 'recurring-options';
    optionsDiv.style.display = 'none';
    optionsDiv.className = 'recurring-options';

    // Interval and unit wrapper
    const intervalWrapper = document.createElement('div');
    intervalWrapper.className = 'interval-wrapper';

    // Interval input
    const intervalInput = document.createElement('input');
    intervalInput.type = 'number';
    intervalInput.id = 'recurring-interval';
    intervalInput.min = '1';
    intervalInput.defaultValue = '1';
    intervalInput.value = '1';

    // Day of month select
    const dayOfMonthSelect = document.createElement('select');
    dayOfMonthSelect.id = 'day-of-month-select';
    dayOfMonthSelect.style.display = 'none';
    // Add options for days 1-31
    for (let i = 1; i <= 31; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${i}${getDaySuffix(i)}`;
        dayOfMonthSelect.appendChild(option);
    }

    // Unit select
    const unitSelect = document.createElement('select');
    unitSelect.id = 'recurring-unit';
    const units = ['day', 'week', 'month', 'year', 'day of month'];
    units.forEach(unit => {
        const option = document.createElement('option');
        option.value = unit;
        option.textContent = unit === 'day of month' ? 'day of month' : unit + (unit === 'day' ? '' : 's');
        unitSelect.appendChild(option);
    });

    intervalWrapper.appendChild(intervalInput);
    intervalWrapper.appendChild(dayOfMonthSelect);
    intervalWrapper.appendChild(unitSelect);

    // Weekday select (for weekly recurrence)
    const weekdaySelect = document.createElement('select');
    weekdaySelect.id = 'recurring-weekday';
    weekdaySelect.style.display = 'none';
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    weekdays.forEach(day => {
        const option = document.createElement('option');
        option.value = day;
        option.textContent = day.charAt(0).toUpperCase() + day.slice(1);
        weekdaySelect.appendChild(option);
    });

    // Event listeners
    checkbox.addEventListener('change', () => {
        optionsDiv.style.display = checkbox.checked ? 'block' : 'none';
    });

    unitSelect.addEventListener('change', () => {
        weekdaySelect.style.display = unitSelect.value === 'week' ? 'inline-block' : 'none';
        intervalInput.style.display = unitSelect.value === 'day of month' ? 'none' : 'inline-block';
        dayOfMonthSelect.style.display = unitSelect.value === 'day of month' ? 'inline-block' : 'none';
    });

    // Assemble the controls
    optionsDiv.appendChild(intervalWrapper);
    optionsDiv.appendChild(weekdaySelect);

    container.appendChild(checkboxWrapper);
    container.appendChild(optionsDiv);

    return container;
}

// Function to build the recurring pattern string
function buildRecurringPattern() {
    const checkbox = document.getElementById('recurring-checkbox');
    if (!checkbox.checked) return null;

    const unit = document.getElementById('recurring-unit').value;

    if (unit === 'day of month') {
        const dayNum = document.getElementById('day-of-month-select').value;
        const suffix = getDaySuffix(dayNum);
        return {
            pattern: `every ${dayNum}${suffix} of the month`,
            until: null
        };
    }

    const interval = document.getElementById('recurring-interval').value;
    const weekday = document.getElementById('recurring-weekday').value;

    let pattern = `every ${interval} ${unit}`;
    if (unit === 'week' && weekday) {
        pattern += ` on ${weekday}`;
    }

    return {
        pattern,
        until: null
    };
}

// Helper function to get the correct suffix for a day number
function getDaySuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

// Update the initMainPage function to fetch currency first
async function initMainPage() {
    await fetchCurrentCurrency();
    const mainContainer = document.getElementById('transactionModal');
    if (!mainContainer) return; // Only run on main page

    // Update currency symbols
    const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
    document.querySelector('.currency-sort-symbol').textContent = currencyInfo.symbol;
    document.querySelector('.currency-symbol').textContent = currencyInfo.symbol;

    // Update amount placeholder when currency changes
    const amountInput = document.getElementById('amount');
    if (amountInput) {
        amountInput.placeholder = `Amount (${currencyInfo.symbol})`;
    }

    // Month navigation (button + picker + arrows). Starts on the current month.
    initMonthNavigation();

    // Export to CSV
    document.getElementById('exportBtn').addEventListener('click', async () => {
        try {
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            const response = await fetch(joinPath(`api/export/range?start=${startDate}&end=${endDate}`), {
                ...fetchConfig,
                method: 'GET'
            });
            
            // Use the same response handler as other requests
            const handledResponse = await handleFetchResponse(response);
            if (!handledResponse) return;
            
            const blob = await handledResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `transactions-${startDate}-to-${endDate}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error exporting transactions:', error);
            alert('Failed to export transactions. Please try again.');
        }
    });

    // Export to PDF
    document.getElementById('exportPdfBtn').addEventListener('click', async () => {
        try {
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            
            // Get instance name from server
            const configResponse = await fetch(joinPath('api/config'), fetchConfig);
            await handleFetchResponse(configResponse);
            const config = await configResponse.json();
            const instanceName = config.instanceName || 'DumbBudget';
            
            // Get the current totals
            const response = await fetch(joinPath(`api/totals/range?start=${startDate}&end=${endDate}`), fetchConfig);
            await handleFetchResponse(response);
            const totals = await response.json();
            
            // Get transactions
            const transactionsResponse = await fetch(joinPath(`api/transactions/range?start=${startDate}&end=${endDate}`), fetchConfig);
            await handleFetchResponse(transactionsResponse);
            const transactions = await transactionsResponse.json();
            
            // Create PDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Set font
            doc.setFont('helvetica');
            
            // Add title
            doc.setFontSize(20);
            doc.text(instanceName, 20, 20);
            
            // Add date range
            doc.setFontSize(12);
            doc.text(`Date Range: ${startDate} to ${endDate}`, 20, 30);
            
            // Add totals section
            doc.setFontSize(14);
            doc.text('Summary', 20, 45);
            doc.setFontSize(12);
            doc.text(`Total spent: ${formatCurrency(totals.expenses)}`, 20, 55);
            doc.text(`Good purchases: ${formatCurrency(totals.good || 0)}`, 20, 65);
            doc.text(`Dumb purchases: ${formatCurrency(totals.dumb || 0)}`, 20, 75);
            
            // Add transactions table
            const tableData = transactions
                .filter(t => t.type === 'expense')
                .map(t => [
                    t.date,
                    t.category || '-',
                    PURCHASE_LABELS[t.purchaseType] || '-',
                    t.notes || '-',
                    formatCurrency(t.amount)
                ]);

            doc.autoTable({
                startY: 85,
                head: [['Date', 'Category', 'Purchase', 'Notes', 'Amount']],
                body: tableData,
                theme: 'grid',
                headStyles: { fillColor: [66, 66, 66] },
                styles: { fontSize: 9 }
            });

            // Save the PDF
            doc.save(`transactions-${startDate}-to-${endDate}.pdf`);
            
        } catch (error) {
            console.error('Error exporting to PDF:', error);
            toastManager.show('Failed to export to PDF. Please try again.', 'error');
        }
    });

    // Initialize sort controls
    const sortButtons = document.querySelectorAll('.sort-btn');
    const sortDirection = document.getElementById('sortDirection');

    sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            sortButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            btn.classList.add('active');
            
            currentSortField = btn.dataset.sort;
            loadTransactions();
        });
    });

    sortDirection.addEventListener('click', () => {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
        sortDirection.classList.toggle('descending', currentSortDirection === 'desc');
        loadTransactions();
    });

    // Set initial sort direction indicator
    sortDirection.classList.toggle('descending', currentSortDirection === 'desc');

    // Initial load
    loadTransactions();
    updateTotals();
    initViewTabs();
}

// ============================================================
// Selected month (shared by "My Budget" and "Overview")
// ============================================================

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

let selectedMonth = firstOfMonth(new Date());
let pickerYear = selectedMonth.getFullYear();

// Switch the whole app to a month and reload everything for it
function setSelectedMonth(date, { reload = true } = {}) {
    selectedMonth = firstOfMonth(date);
    const last = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
    document.getElementById('startDate').value = toLocalISODate(selectedMonth);
    document.getElementById('endDate').value = toLocalISODate(last);

    const label = selectedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    document.querySelectorAll('.selected-month-label').forEach(el => { el.textContent = label; });

    if (reload) {
        loadTransactions();
        updateTotals();
        if (!document.getElementById('overviewView').hidden) renderOverview();
    }
}

function stepMonth(step) {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + step, 1));
}

function renderMonthPicker() {
    const today = new Date();
    document.getElementById('pickerYear').textContent = pickerYear;
    document.getElementById('pickerMonths').innerHTML = MONTH_NAMES_SHORT.map((name, i) => {
        const isSelected = pickerYear === selectedMonth.getFullYear() && i === selectedMonth.getMonth();
        const isToday = pickerYear === today.getFullYear() && i === today.getMonth();
        return `<button type="button" class="picker-month ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}" data-month="${i}">${name}</button>`;
    }).join('');
}

function openMonthPicker(open) {
    const picker = document.getElementById('monthPicker');
    picker.hidden = !open;
    document.getElementById('monthPickerBtn').setAttribute('aria-expanded', String(open));
    if (open) {
        pickerYear = selectedMonth.getFullYear();
        renderMonthPicker();
    }
}

function initMonthNavigation() {
    const picker = document.getElementById('monthPicker');

    document.getElementById('monthPickerBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        openMonthPicker(picker.hidden);
    });
    document.getElementById('pickerPrevYear').addEventListener('click', () => { pickerYear--; renderMonthPicker(); });
    document.getElementById('pickerNextYear').addEventListener('click', () => { pickerYear++; renderMonthPicker(); });
    document.getElementById('pickerMonths').addEventListener('click', (e) => {
        const btn = e.target.closest('.picker-month');
        if (!btn) return;
        setSelectedMonth(new Date(pickerYear, Number(btn.dataset.month), 1));
        openMonthPicker(false);
    });
    document.getElementById('pickerThisMonth').addEventListener('click', () => {
        setSelectedMonth(new Date());
        openMonthPicker(false);
    });

    // Close the picker when clicking elsewhere or pressing Escape
    picker.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => openMonthPicker(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openMonthPicker(false); });

    // ‹ › arrows (on both pages)
    document.querySelectorAll('.month-step').forEach(btn =>
        btn.addEventListener('click', () => stepMonth(Number(btn.dataset.step))));

    // Start on the current month (data is loaded by initMainPage right after)
    setSelectedMonth(new Date(), { reload: false });

    // When a new month starts, move along with it — but only if you were
    // looking at the month that just ended (don't yank you away from browsing).
    let lastKnownMonth = firstOfMonth(new Date());
    const followCalendar = () => {
        const now = firstOfMonth(new Date());
        if (!sameMonth(now, lastKnownMonth)) {
            if (sameMonth(selectedMonth, lastKnownMonth)) setSelectedMonth(now);
            lastKnownMonth = now;
        }
    };
    setInterval(followCalendar, 60 * 1000);                 // check every minute
    document.addEventListener('visibilitychange', followCalendar); // and when you come back to the tab
}

// ============================================================
// Overview page: monthly spending ring chart
// ============================================================


// Colours that read well on the dark background
const CATEGORY_COLORS = [
    '#5B8DEF', '#F2A65A', '#56C596', '#E86A92', '#B48CF2', '#4FC1E9',
    '#F6D365', '#FF7F6E', '#8BD3A0', '#C9A0DC', '#7AA6C2', '#E5B181'
];

// Simple line icons (24x24). Categories are matched by keywords in their name.
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

// Which icon to use for a category name (first matching keyword wins).
// Add your own keywords here to change which icon a category gets.
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

// All categories the user can pick (built-in + custom), in dropdown order
function knownCategories() {
    return Array.from(document.getElementById('category').options)
        .map(o => o.value)
        .filter(v => v && v !== 'add_new');
}

function initViewTabs() {
    document.querySelectorAll('.view-tab').forEach(tab =>
        tab.addEventListener('click', () => showView(tab.dataset.view)));

    // Remember the open tab when the page is refreshed
    showView(window.location.hash === '#overview' ? 'overview' : 'budget');
}

function showView(view) {
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.getElementById('budgetView').hidden = view !== 'budget';
    document.getElementById('overviewView').hidden = view !== 'overview';
    history.replaceState(null, '', view === 'overview' ? '#overview' : window.location.pathname);
    if (view === 'overview') renderOverview();
}

async function renderOverview() {
    const first = selectedMonth;
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);

    let expenses = [];
    try {
        const response = await fetch(
            joinPath(`api/transactions/range?start=${toLocalISODate(first)}&end=${toLocalISODate(last)}`),
            fetchConfig
        );
        await handleFetchResponse(response);
        expenses = (await response.json()).filter(t => t.type === 'expense');
    } catch (error) {
        console.error('Error loading overview:', error);
        toastManager.show('Could not load the overview.', 'error');
        return;
    }

    // Add up spending per category, and good vs dumb
    const byCategory = {};
    let total = 0, good = 0, dumb = 0;
    for (const t of expenses) {
        const cat = t.category || 'Other';
        byCategory[cat] = (byCategory[cat] || 0) + t.amount;
        total += t.amount;
        if (t.purchaseType === 'good') good += t.amount;
        if (t.purchaseType === 'dumb') dumb += t.amount;
    }

    // Give every category a fixed colour (based on dropdown order, so it stays the same month to month)
    const allCats = [...new Set([...knownCategories(), ...Object.keys(byCategory)])];
    const colorOf = {};
    allCats.forEach((c, i) => { colorOf[c] = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });

    // Icons around the ring: categories with spending first, then the rest (max 12)
    const ringCats = [...allCats]
        .sort((a, b) => (byCategory[b] || 0) - (byCategory[a] || 0))
        .slice(0, 12);

    // --- Donut ring (SVG circles with dashed strokes, one per category)
    const radius = 38;
    const circumference = 2 * Math.PI * radius;
    const spent = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    let offset = 0;
    let segments = `<circle class="ring-track" cx="50" cy="50" r="${radius}"/>`;
    for (const [cat, amount] of spent) {
        const length = (amount / total) * circumference;
        const gap = spent.length > 1 ? 0.8 : 0; // small gap between slices
        segments += `<circle class="ring-segment" cx="50" cy="50" r="${radius}"
            stroke="${colorOf[cat]}"
            stroke-dasharray="${Math.max(length - gap, 0)} ${circumference}"
            stroke-dashoffset="${-offset}"><title>${escapeHtml(cat)}</title></circle>`;
        offset += length;
    }
    document.getElementById('ringSvg').innerHTML = segments;

    // --- Centre text: total, then good (green) and dumb (red)
    document.getElementById('ringTotal').textContent = formatCurrency(total);
    document.getElementById('ringGood').textContent = `Good ${formatCurrency(good)}`;
    document.getElementById('ringDumb').textContent = `Dumb ${formatCurrency(dumb)}`;

    // --- Category icons placed in a circle around the ring
    document.getElementById('ringIcons').innerHTML = ringCats.map((cat, i) => {
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

    // --- Good vs dumb bar (share of rated spending)
    const rated = good + dumb;
    const goodPct = rated ? Math.round((good / rated) * 100) : 0;
    const dumbPct = rated ? 100 - goodPct : 0;
    document.getElementById('goodPct').textContent = `Good ${goodPct}%`;
    document.getElementById('dumbPct').textContent = `Dumb ${dumbPct}%`;
    document.getElementById('splitBarGood').style.width = `${goodPct}%`;
    document.getElementById('splitBarDumb').style.width = `${dumbPct}%`;

    // --- Category list under the chart
    document.getElementById('categoryList').innerHTML = spent.length
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


const registerServiceWorker = () => {
     // Register PWA Service Worker
     if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service-worker.js")
            .then((reg) => console.log("Service Worker registered:", reg.scope))
            .catch((err) => console.log("Service Worker registration failed:", err));
    }
}

// Initialize functionality

    initThemeToggle();
    
    // Check which page we're on
    const isLoginPage = window.location.pathname.includes('login');
    
    if (isLoginPage) {
        // Only initialize PIN inputs on login page
        setupPinInputs();
    } else {
        // Only initialize main page functionality when not on login
        initModalHandling();
        initMainPage();
    }

    registerServiceWorker();

