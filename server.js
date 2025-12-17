const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// ⚠️ CHANGE THIS PASSWORD BEFORE DEPLOYING!
const ADMIN_PASSWORD = 'admin123';

// ⚠️ SET YOUR TELEGRAM ID HERE TO SKIP PASSWORD (Optional)
// Find your Telegram ID: @userinfobot
const PRESET_ADMIN_ID = 7873779706; // Example: 123456789

// In-memory storage
let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

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
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
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

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

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

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    // If no admin set yet, this user becomes admin
    if (!ADMIN_TELEGRAM_ID && telegramId) {
        ADMIN_TELEGRAM_ID = telegramId.toString();
        console.log(`✅ New admin set: ${ADMIN_TELEGRAM_ID}`);
        return res.json({ 
            success: true, 
            isAdmin: true,
            message: 'You are now the admin!'
        });
    }

    // Check if this user is the existing admin
    if (isAdmin(telegramId)) {
        return res.json({ 
            success: true, 
            isAdmin: true,
            message: 'Welcome back, admin!'
        });
    }

    // Someone else is already admin
    res.status(403).json({ 
        error: 'Admin already set by another user',
        isAdmin: false
    });
});

// GET: Check admin status
app.get('/api/admin/check', (req, res) => {
    const telegramId = req.query.telegramId;
    res.json({ 
        isAdmin: isAdmin(telegramId),
        hasAdmin: !!ADMIN_TELEGRAM_ID,
        currentAdmin: ADMIN_TELEGRAM_ID // For debugging (remove in production)
    });
});

// POST: Change admin (requires current admin password)
app.post('/api/admin/change', (req, res) => {
    const { password, newAdminId } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    ADMIN_TELEGRAM_ID = newAdminId ? newAdminId.toString() : null;
    console.log(`✅ Admin changed to: ${ADMIN_TELEGRAM_ID || 'None'}`);

    res.json({ 
        success: true, 
        message: 'Admin changed successfully',
        newAdmin: ADMIN_TELEGRAM_ID
    });
});

// POST: Reset data (Admin only)
app.post('/api/admin/reset', (req, res) => {
    const { password, telegramId } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    state = {
        totalDebtPaid: 0,
        totalSalaryPaid: 0,
        payments: [],
        initialDebts: state.initialDebts
    };

    console.log('✅ Data reset by admin');
    res.json({ success: true, message: 'Data reset successfully' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Mini App: http://localhost:${PORT}`);
    console.log(`📊 API: http://localhost:${PORT}/api/state`);
    if (ADMIN_TELEGRAM_ID) {
        console.log(`👤 Preset Admin ID: ${ADMIN_TELEGRAM_ID}`);
    }
});