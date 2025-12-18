const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

// UPDATED DEBT AMOUNTS (Reduced by 2250 each)
const INITIAL_DEBTS = {
    A: 66250,  // Bhargav (was 68500, reduced by 2250)
    B: 66250,  // Sagar (was 68500, reduced by 2250)
    C: 17450   // Bharat (was 19700, reduced by 2250)
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
    totalExtraPayments: 0,
    extraPayments: { A: 0, B: 0, C: 0 },
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

    // Salary portions (30% / 30% / 40%)
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
        totalSalaryPaid: state.totalSalaryPaid,
        totalExtraPayments: state.totalExtraPayments,
        extraPayments: state.extraPayments
    });
});

// POST: Record regular payment with 50/50 split
app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const remainingDebt = Math.max(0, TOTAL_DEBT - state.totalDebtPaid);

    // 50/50 SPLIT FORMULA
    const toPersonX = Math.min(amount * 0.5, remainingDebt);
    const toSalary = amount * 0.5;

    const partnerDetails = calculatePartnerDetails(toPersonX, toSalary);

    state.totalDebtPaid += toPersonX;
    state.totalSalaryPaid += toSalary;

    state.payments.push({
        type: 'regular',
        amount: parseFloat(amount),
        toPersonX,
        toSalary,
        partnerDetails,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    console.log(`💰 Payment: ₹${amount} | Debt (50%): ₹${toPersonX} | Salary (50%): ₹${toSalary}`);
    console.log(`   Remaining Total Debt: ₹${(TOTAL_DEBT - state.totalDebtPaid).toLocaleString()}`);

    res.json({ 
        success: true, 
        state: { 
            totalDebtPaid: state.totalDebtPaid, 
            totalSalaryPaid: state.totalSalaryPaid 
        } 
    });
});

// POST: Record extra payment by partner
app.post('/api/extra-payment', (req, res) => {
    const { partner, amount, recordedBy, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!partner || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    if (!['A', 'B', 'C'].includes(partner)) {
        return res.status(400).json({ error: 'Invalid partner' });
    }

    state.extraPayments[partner] += parseFloat(amount);
    state.totalExtraPayments += parseFloat(amount);

    state.payments.push({
        type: 'extra',
        partner,
        amount: parseFloat(amount),
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    const partnerNames = { A: 'Bhargav', B: 'Sagar', C: 'Bharat' };
    console.log(`💵 Extra Payment: ₹${amount} by ${partnerNames[partner]}`);

    res.json({ 
        success: true, 
        extraPayments: state.extraPayments,
        totalExtraPayments: state.totalExtraPayments
    });
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
    state = { 
        totalDebtPaid: 0, 
        totalSalaryPaid: 0, 
        totalExtraPayments: 0,
        extraPayments: { A: 0, B: 0, C: 0 },
        payments: [], 
        initialDebts: INITIAL_DEBTS 
    };
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Partnership Calculator Server');
    console.log('💰 Total Debt: ₹' + TOTAL_DEBT.toLocaleString());
    console.log('   • Bhargav: ₹66,250');
    console.log('   • Sagar: ₹66,250');
    console.log('   • Bharat: ₹17,450');
    console.log('📊 Split: 50% to X | 50% Salary Pool');
    console.log('💼 Salary: A=30%, B=30%, C=40%');
});
