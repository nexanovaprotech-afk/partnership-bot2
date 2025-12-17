const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Admin configuration - CHANGE THIS PASSWORD!
const ADMIN_TELEGRAM_ID = null; // Will be set on first admin login
const ADMIN_PASSWORD = 'admin123'; // Change this!

// In-memory storage
let state = {
    totalDebtPaid: 0,
    totalSalaryPaid: 0,
    payments: [],
    initialDebts: {
        A: 68500,  // Bhargav
        B: 68500,  // Sagar
        C: 19700   // Bharat
    }
};

// Check if user is admin
function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId === ADMIN_TELEGRAM_ID;
}

// GET: Current state
app.get('/api/state', (req, res) => {
    res.json(state);
});

// GET: Payment history
app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        history: state.payments.slice(-limit).reverse(),
        totalDebtPaid: state.totalDebtPaid,
        totalSalaryPaid: state.totalSalaryPaid
    });
});

// POST: Record payment (Admin only)
app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const totalDebt = state.initialDebts.A + state.initialDebts.B + state.initialDebts.C;
    const remainingDebt = Math.max(0, totalDebt - state.totalDebtPaid);
    const toPersonX = Math.min(amount, remainingDebt);
    const toSalary = amount - toPersonX;

    state.totalDebtPaid += toPersonX;
    state.totalSalaryPaid += toSalary;

    state.payments.push({
        amount: parseFloat(amount),
        toPersonX,
        toSalary,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    res.json({ 
        success: true, 
        state: {
            totalDebtPaid: state.totalDebtPaid,
            totalSalaryPaid: state.totalSalaryPaid
        }
    });
});

// POST: Admin login
app.post('/api/admin/login', (req, res) => {
    const { password, telegramId } = req.body;

    if (password === ADMIN_PASSWORD) {
        // First login sets the admin
        if (!ADMIN_TELEGRAM_ID && telegramId) {
            global.ADMIN_TELEGRAM_ID = telegramId;
        }

        res.json({ 
            success: true, 
            isAdmin: telegramId === ADMIN_TELEGRAM_ID 
        });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// GET: Check admin status
app.get('/api/admin/check', (req, res) => {
    const telegramId = req.query.telegramId;
    res.json({ 
        isAdmin: isAdmin(telegramId),
        hasAdmin: !!ADMIN_TELEGRAM_ID
    });
});

// POST: Reset data (Admin only)
app.post('/api/admin/reset', (req, res) => {
    const { password, telegramId } = req.body;

    if (password !== ADMIN_PASSWORD || !isAdmin(telegramId)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    state = {
        totalDebtPaid: 0,
        totalSalaryPaid: 0,
        payments: [],
        initialDebts: state.initialDebts
    };

    res.json({ success: true, message: 'Data reset successfully' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Mini App: http://localhost:${PORT}`);
    console.log(`📊 API: http://localhost:${PORT}/api/state`);
});
