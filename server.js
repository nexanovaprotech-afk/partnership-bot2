const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

// CONFIGURABLE DEBTS (can be updated by admin)
let INITIAL_DEBTS = {
    A: 66250,  // Bhargav
    B: 66250,  // Sagar
    C: 17450   // Bharat
};

// SHAREHOLDING (for salary distribution)
const SHAREHOLDING = {
    A: 0.30,  // Bhargav 30%
    B: 0.30,  // Sagar 30%
    C: 0.40   // Bharat 40%
};

let state = {
    totalDebtPaid: 0,
    totalSalaryPaid: 0,
    totalExtraPayments: 0,
    extraPayments: { A: 0, B: 0, C: 0 },
    payments: [],
    initialDebts: { ...INITIAL_DEBTS }
};

function getTotalDebt() {
    return INITIAL_DEBTS.A + INITIAL_DEBTS.B + INITIAL_DEBTS.C;
}

function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
}

// Calculate individual debt paid for each partner
function calculateIndividualDebtPaid() {
    const totalDebt = getTotalDebt();
    if (totalDebt === 0) return { A: 0, B: 0, C: 0 };

    const debtClearRate = state.totalDebtPaid / totalDebt;

    return {
        A: INITIAL_DEBTS.A * debtClearRate,
        B: INITIAL_DEBTS.B * debtClearRate,
        C: INITIAL_DEBTS.C * debtClearRate
    };
}

// CORRECT CALCULATION:
// 1. Divide payment by shareholding (30/30/40) - each partner gets their share
// 2. Calculate debt clear rate: ensures 50% of total payment goes to Person X
// 3. Each partner pays debt based on THEIR debt amount × clear rate
// 4. Each partner keeps salary = Their share - Their debt payment
// Result: Bharat gets HIGHER salary (40% share, low debt)
//         Everyone clears debt at SAME % rate
function calculatePartnerDetails(amount) {
    const totalDebt = getTotalDebt();

    // Step 1: Divide by shareholding
    const shareA = amount * SHAREHOLDING.A;  // 30%
    const shareB = amount * SHAREHOLDING.B;  // 30%
    const shareC = amount * SHAREHOLDING.C;  // 40%

    // Step 2: Calculate debt clear rate (ensures 50% to Person X)
    const debtClearRate = (amount * 0.5) / totalDebt;  // as decimal

    // Step 3: Calculate debt payments (each partner pays their debt × clear rate)
    const debtA = INITIAL_DEBTS.A * debtClearRate;
    const debtB = INITIAL_DEBTS.B * debtClearRate;
    const debtC = INITIAL_DEBTS.C * debtClearRate;

    // Step 4: Calculate salaries (share - debt)
    const salaryA = shareA - debtA;
    const salaryB = shareB - debtB;
    const salaryC = shareC - debtC;

    return {
        A: { share: shareA, debt: debtA, salary: salaryA },
        B: { share: shareB, debt: debtB, salary: salaryB },
        C: { share: shareC, debt: debtC, salary: salaryC },
        debtClearRate: debtClearRate * 100  // as percentage
    };
}

app.get('/api/state', (req, res) => {
    const debtPaid = calculateIndividualDebtPaid();
    res.json({
        ...state,
        debtPaid  // Add individual debt paid amounts
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        initialDebts: INITIAL_DEBTS,
        shareholding: SHAREHOLDING
    });
});

// POST: Update initial debts (admin only)
app.post('/api/config/debts', (req, res) => {
    const { debtA, debtB, debtC, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!debtA || !debtB || !debtC || debtA < 0 || debtB < 0 || debtC < 0) {
        return res.status(400).json({ error: 'Invalid debt amounts' });
    }

    INITIAL_DEBTS.A = parseFloat(debtA);
    INITIAL_DEBTS.B = parseFloat(debtB);
    INITIAL_DEBTS.C = parseFloat(debtC);

    state.initialDebts = { ...INITIAL_DEBTS };

    console.log('💰 Debts Updated:');
    console.log('   • Bhargav: ₹' + INITIAL_DEBTS.A.toLocaleString());
    console.log('   • Sagar: ₹' + INITIAL_DEBTS.B.toLocaleString());
    console.log('   • Bharat: ₹' + INITIAL_DEBTS.C.toLocaleString());

    res.json({ 
        success: true, 
        initialDebts: INITIAL_DEBTS 
    });
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const debtPaid = calculateIndividualDebtPaid();

    res.json({
        history: state.payments.slice(-limit).reverse(),
        totalDebtPaid: state.totalDebtPaid,
        totalSalaryPaid: state.totalSalaryPaid,
        totalExtraPayments: state.totalExtraPayments,
        extraPayments: state.extraPayments,
        debtPaid  // Add individual debt paid
    });
});

// POST: Record regular payment
app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const partnerDetails = calculatePartnerDetails(amount);

    const toPersonX = partnerDetails.A.debt + partnerDetails.B.debt + partnerDetails.C.debt;
    const toSalary = partnerDetails.A.salary + partnerDetails.B.salary + partnerDetails.C.salary;

    state.totalDebtPaid += toPersonX;
    state.totalSalaryPaid += toSalary;

    const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    state.payments.push({
        id: paymentId,
        type: 'regular',
        amount: parseFloat(amount),
        toPersonX,
        toSalary,
        partnerDetails,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId
    });

    console.log(`💰 Payment: ₹${amount}`);
    console.log(`   Debt Clear Rate: ${partnerDetails.debtClearRate.toFixed(4)}%`);
    console.log(`   Bhargav (30%): Share ₹${partnerDetails.A.share.toFixed(2)} → Debt ₹${partnerDetails.A.debt.toFixed(2)} + Salary ₹${partnerDetails.A.salary.toFixed(2)}`);
    console.log(`   Sagar (30%): Share ₹${partnerDetails.B.share.toFixed(2)} → Debt ₹${partnerDetails.B.debt.toFixed(2)} + Salary ₹${partnerDetails.B.salary.toFixed(2)}`);
    console.log(`   Bharat (40%): Share ₹${partnerDetails.C.share.toFixed(2)} → Debt ₹${partnerDetails.C.debt.toFixed(2)} + Salary ₹${partnerDetails.C.salary.toFixed(2)}`);
    console.log(`   Total: Debt ₹${toPersonX.toFixed(2)} (50%) | Salary ₹${toSalary.toFixed(2)} (50%)`);

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

    const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    state.payments.push({
        id: paymentId,
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

// DELETE: Remove single payment entry
app.delete('/api/payment/:id', (req, res) => {
    const { id } = req.params;
    const { telegramId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const paymentIndex = state.payments.findIndex(p => p.id === id);

    if (paymentIndex === -1) {
        return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = state.payments[paymentIndex];

    // Reverse the payment
    if (payment.type === 'regular') {
        state.totalDebtPaid -= payment.toPersonX;
        state.totalSalaryPaid -= payment.toSalary;
    } else if (payment.type === 'extra') {
        state.extraPayments[payment.partner] -= payment.amount;
        state.totalExtraPayments -= payment.amount;
    }

    // Remove from array
    state.payments.splice(paymentIndex, 1);

    console.log(`🗑️  Payment deleted: ID ${id}`);

    res.json({ 
        success: true,
        message: 'Payment deleted',
        state: {
            totalDebtPaid: state.totalDebtPaid,
            totalSalaryPaid: state.totalSalaryPaid,
            totalExtraPayments: state.totalExtraPayments,
            extraPayments: state.extraPayments
        }
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
        initialDebts: { ...INITIAL_DEBTS }
    };
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, () => {
    const totalDebt = getTotalDebt();
    console.log('🚀 Partnership Calculator Server (UPDATED)');
    console.log('💰 Total Debt: ₹' + totalDebt.toLocaleString());
    console.log('   • Bhargav: ₹' + INITIAL_DEBTS.A.toLocaleString() + ' (30% shareholding)');
    console.log('   • Sagar: ₹' + INITIAL_DEBTS.B.toLocaleString() + ' (30% shareholding)');
    console.log('   • Bharat: ₹' + INITIAL_DEBTS.C.toLocaleString() + ' (40% shareholding)');
    console.log('📊 Features:');
    console.log('   ✅ Configurable debts');
    console.log('   ✅ Individual debt paid tracking');
    console.log('   ✅ Delete single entries');
    console.log('   ✅ Everyone clears debt at SAME % rate!');
});
