const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

const INITIAL_DEBTS = {
    A: 68500,  // Bhargav
    B: 68500,  // Sagar
    C: 19700   // Bharat
};

const SALARY_SPLIT = {
    A: 0.30,  // Bhargav 30%
    B: 0.30,  // Sagar 30%
    C: 0.40   // Bharat 40%
};

const TOTAL_DEBT = INITIAL_DEBTS.A + INITIAL_DEBTS.B + INITIAL_DEBTS.C;

let state = {
    totalDebtPaid: 0,
    totalSalaryPaid: 0,
    payments: [],
    initialDebts: INITIAL_DEBTS
};

function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
}

function calculatePartnerDetails(toPersonX, toSalary) {
    // Debt portions (proportional to initial debt)
    const debtA = toPersonX * (INITIAL_DEBTS.A / TOTAL_DEBT);
    const debtB = toPersonX * (INITIAL_DEBTS.B / TOTAL_DEBT);
    const debtC = toPersonX * (INITIAL_DEBTS.C / TOTAL_DEBT);

    // Salary portions (FIXED: 30% / 30% / 40%)
    const salaryA = toSalary * SALARY_SPLIT.A;
    const salaryB = toSalary * SALARY_SPLIT.B;
    const salaryC = toSalary * SALARY_SPLIT.C;

    return {
        A: { debt: debtA, salary: salaryA },
        B: { debt: debtB, salary: salaryB },
        C: { debt: debtC, salary: salaryC }
    };
}

app.get('/api/state', (req, res) => {
    res.json(state);
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        history: state.payments.slice(-limit).reverse(),
        totalDebtPaid: state.totalDebtPaid,
        totalSalaryPaid: state.totalSalaryPaid
    });
});

app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const remainingDebt = Math.max(0, TOTAL_DEBT - state.totalDebtPaid);
    const toPersonX = Math.min(amount, remainingDebt);
    const toSalary = amount - toPersonX;

    const partnerDetails = calculatePartnerDetails(toPersonX, toSalary);

    state.totalDebtPaid += toPersonX;
    state.totalSalaryPaid += toSalary;

    state.payments.push({
        amount: parseFloat(amount),
        toPersonX,
        toSalary,
        partnerDetails,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    console.log(`💰 Payment: ₹${amount} | Debt: ₹${toPersonX} | Salary: ₹${toSalary}`);
    console.log(`   A: Debt ₹${partnerDetails.A.debt.toFixed(2)} + Salary ₹${partnerDetails.A.salary.toFixed(2)}`);
    console.log(`   B: Debt ₹${partnerDetails.B.debt.toFixed(2)} + Salary ₹${partnerDetails.B.salary.toFixed(2)}`);
    console.log(`   C: Debt ₹${partnerDetails.C.debt.toFixed(2)} + Salary ₹${partnerDetails.C.salary.toFixed(2)}`);

    res.json({ success: true, state: { totalDebtPaid: state.totalDebtPaid, totalSalaryPaid: state.totalSalaryPaid } });
});

app.post('/api/admin/login', (req, res) => {
    const { password, telegramId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
    if (!ADMIN_TELEGRAM_ID && telegramId) {
        ADMIN_TELEGRAM_ID = telegramId.toString();
        return res.json({ success: true, isAdmin: true });
    }
    if (isAdmin(telegramId)) return res.json({ success: true, isAdmin: true });
    res.status(403).json({ error: 'Admin already set' });
});

app.get('/api/admin/check', (req, res) => {
    res.json({ isAdmin: isAdmin(req.query.telegramId), hasAdmin: !!ADMIN_TELEGRAM_ID });
});

app.post('/api/admin/reset', (req, res) => {
    const { password, telegramId } = req.body;
    if (password !== ADMIN_PASSWORD || !isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    state = { totalDebtPaid: 0, totalSalaryPaid: 0, payments: [], initialDebts: INITIAL_DEBTS };
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Partnership Calculator Server');
    console.log('💰 Total Debt: ₹' + TOTAL_DEBT.toLocaleString());
    console.log('📊 Salary Split: A=30%, B=30%, C=40%');
});
