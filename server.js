const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = 'admin123';
const PRESET_ADMIN_ID = null;

let ADMIN_TELEGRAM_ID = PRESET_ADMIN_ID;

// APPROVED USERS (for private access)
let approvedUsers = new Set();
let pendingApprovals = [];

// CONFIGURABLE DEBTS
let INITIAL_DEBTS = {
    A: 66250,
    B: 66250,
    C: 17450
};

const SHAREHOLDING = {
    A: 0.30,
    B: 0.30,
    C: 0.40
};

let state = {
    totalDebtPaid: 0,
    totalSalaryPaid: 0,
    totalExtraPayments: 0,
    extraPayments: { A: 0, B: 0, C: 0 },
    payments: [],
    initialDebts: { ...INITIAL_DEBTS },
    debtFullyPaid: false
};

function getTotalDebt() {
    return INITIAL_DEBTS.A + INITIAL_DEBTS.B + INITIAL_DEBTS.C;
}

function isAdmin(telegramId) {
    if (!ADMIN_TELEGRAM_ID) return false;
    return telegramId?.toString() === ADMIN_TELEGRAM_ID?.toString();
}

function isApprovedUser(telegramId) {
    if (isAdmin(telegramId)) return true;
    return approvedUsers.has(telegramId?.toString());
}

function getRemainingDebt() {
    const totalDebt = getTotalDebt();
    const totalPaid = state.totalDebtPaid + state.totalExtraPayments;
    return Math.max(0, totalDebt - totalPaid);
}

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

function calculatePartnerDetails(amount) {
    const totalDebt = getTotalDebt();
    const remainingDebt = getRemainingDebt();

    const shareA = amount * SHAREHOLDING.A;
    const shareB = amount * SHAREHOLDING.B;
    const shareC = amount * SHAREHOLDING.C;

    let debtA, debtB, debtC, salaryA, salaryB, salaryC;
    let toPersonX, toSalary;
    let debtClearRate;

    if (remainingDebt <= 0) {
        debtA = debtB = debtC = 0;
        salaryA = shareA;
        salaryB = shareB;
        salaryC = shareC;
        toPersonX = 0;
        toSalary = amount;
        debtClearRate = 0;
    } else if (remainingDebt < amount * 0.5) {
        debtClearRate = remainingDebt / totalDebt;

        debtA = INITIAL_DEBTS.A * debtClearRate;
        debtB = INITIAL_DEBTS.B * debtClearRate;
        debtC = INITIAL_DEBTS.C * debtClearRate;

        toPersonX = remainingDebt;
        toSalary = amount - remainingDebt;

        salaryA = shareA - debtA;
        salaryB = shareB - debtB;
        salaryC = shareC - debtC;
    } else {
        debtClearRate = (amount * 0.5) / totalDebt;

        debtA = INITIAL_DEBTS.A * debtClearRate;
        debtB = INITIAL_DEBTS.B * debtClearRate;
        debtC = INITIAL_DEBTS.C * debtClearRate;

        salaryA = shareA - debtA;
        salaryB = shareB - debtB;
        salaryC = shareC - debtC;

        toPersonX = debtA + debtB + debtC;
        toSalary = salaryA + salaryB + salaryC;
    }

    return {
        A: { share: shareA, debt: debtA, salary: salaryA },
        B: { share: shareB, debt: debtB, salary: salaryB },
        C: { share: shareC, debt: debtC, salary: salaryC },
        debtClearRate: debtClearRate * 100,
        toPersonX,
        toSalary,
        isDebtComplete: remainingDebt <= toPersonX
    };
}

function recalculateState() {
    state.totalDebtPaid = 0;
    state.totalSalaryPaid = 0;
    state.totalExtraPayments = 0;
    state.extraPayments = { A: 0, B: 0, C: 0 };

    for (let payment of state.payments) {
        if (payment.type === 'regular') {
            const details = calculatePartnerDetails(payment.amount);
            payment.toPersonX = details.toPersonX;
            payment.toSalary = details.toSalary;
            payment.partnerDetails = details;

            state.totalDebtPaid += details.toPersonX;
            state.totalSalaryPaid += details.toSalary;
        } else if (payment.type === 'extra') {
            state.extraPayments[payment.partner] += payment.amount;
            state.totalExtraPayments += payment.amount;
        }
    }

    state.debtFullyPaid = getRemainingDebt() <= 0;
}

function getMonthlyBreakdown(month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const monthlyPayments = state.payments.filter(p => {
        if (p.paymentStartDate && p.paymentEndDate) {
            const pStart = new Date(p.paymentStartDate);
            const pEnd = new Date(p.paymentEndDate);
            return (pStart <= endDate && pEnd >= startDate);
        } else {
            const paymentDate = new Date(p.timestamp);
            return paymentDate >= startDate && paymentDate <= endDate;
        }
    });

    let totalAmount = 0;
    let salaryA = 0, salaryB = 0, salaryC = 0;
    let debtPaid = 0;

    for (let payment of monthlyPayments) {
        if (payment.type === 'regular') {
            totalAmount += payment.amount;
            salaryA += payment.partnerDetails.A.salary;
            salaryB += payment.partnerDetails.B.salary;
            salaryC += payment.partnerDetails.C.salary;
            debtPaid += payment.toPersonX;
        }
    }

    return {
        month,
        year,
        totalPayments: monthlyPayments.length,
        totalAmount,
        debtPaid,
        totalSalary: totalAmount - debtPaid,
        salaries: { A: salaryA, B: salaryB, C: salaryC },
        payments: monthlyPayments
    };
}

app.post('/api/access/request', (req, res) => {
    const { telegramId, userName } = req.body;

    if (!telegramId) {
        return res.status(400).json({ error: 'Telegram ID required' });
    }

    if (isApprovedUser(telegramId)) {
        return res.json({ approved: true });
    }

    const alreadyPending = pendingApprovals.find(p => p.telegramId === telegramId);
    if (alreadyPending) {
        return res.json({ pending: true, message: 'Request pending approval' });
    }

    pendingApprovals.push({
        telegramId: telegramId.toString(),
        userName: userName || 'Unknown User',
        requestedAt: new Date().toISOString()
    });

    console.log('🔔 NEW ACCESS REQUEST:');
    console.log('   User: ' + userName);
    console.log('   Telegram ID: ' + telegramId);

    res.json({ pending: true, message: 'Access request sent to admin' });
});

app.get('/api/access/pending', (req, res) => {
    const { telegramId } = req.query;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    res.json({ pending: pendingApprovals });
});

app.post('/api/access/approve', (req, res) => {
    const { telegramId, userId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    approvedUsers.add(userId.toString());
    pendingApprovals = pendingApprovals.filter(p => p.telegramId !== userId);

    console.log('✅ User approved: ' + userId);

    res.json({ success: true });
});

app.post('/api/access/reject', (req, res) => {
    const { telegramId, userId } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    pendingApprovals = pendingApprovals.filter(p => p.telegramId !== userId);

    console.log('❌ User rejected: ' + userId);

    res.json({ success: true });
});

app.get('/api/state', (req, res) => {
    const { telegramId } = req.query;

    if (!isApprovedUser(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const debtPaid = calculateIndividualDebtPaid();
    const remainingDebt = getRemainingDebt();

    res.json({
        ...state,
        debtPaid,
        remainingDebt,
        debtFullyPaid: state.debtFullyPaid
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        initialDebts: INITIAL_DEBTS,
        shareholding: SHAREHOLDING
    });
});

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
    recalculateState();

    console.log('💰 Debts Updated & Recalculated');

    res.json({ success: true, initialDebts: INITIAL_DEBTS });
});

app.get('/api/history', (req, res) => {
    const { telegramId, limit } = req.query;

    if (!isApprovedUser(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const limitNum = parseInt(limit) || 50;
    const debtPaid = calculateIndividualDebtPaid();

    res.json({
        history: state.payments.slice(-limitNum).reverse(),
        totalDebtPaid: state.totalDebtPaid,
        totalSalaryPaid: state.totalSalaryPaid,
        totalExtraPayments: state.totalExtraPayments,
        extraPayments: state.extraPayments,
        debtPaid,
        debtFullyPaid: state.debtFullyPaid
    });
});

app.get('/api/monthly', (req, res) => {
    const { telegramId, month, year } = req.query;

    if (!isApprovedUser(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (!monthNum || !yearNum) {
        return res.status(400).json({ error: 'Month and year required' });
    }

    const breakdown = getMonthlyBreakdown(monthNum, yearNum);
    res.json(breakdown);
});

app.post('/api/payment', (req, res) => {
    const { amount, recordedBy, telegramId, comment, paymentStartDate, paymentEndDate } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    if (paymentStartDate && paymentEndDate) {
        const startDate = new Date(paymentStartDate);
        const endDate = new Date(paymentEndDate);

        if (startDate > endDate) {
            return res.status(400).json({ error: 'Start date must be before end date' });
        }
    }

    const partnerDetails = calculatePartnerDetails(amount);

    const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    state.payments.push({
        id: paymentId,
        type: 'regular',
        amount: parseFloat(amount),
        toPersonX: partnerDetails.toPersonX,
        toSalary: partnerDetails.toSalary,
        partnerDetails,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId,
        comment: comment || '',
        paymentStartDate: paymentStartDate || null,
        paymentEndDate: paymentEndDate || null
    });

    state.totalDebtPaid += partnerDetails.toPersonX;
    state.totalSalaryPaid += partnerDetails.toSalary;
    state.debtFullyPaid = getRemainingDebt() <= 0;

    console.log(`💰 Payment: ₹${amount}`);
    if (paymentStartDate && paymentEndDate) {
        console.log(`   📅 Period: ${paymentStartDate} to ${paymentEndDate}`);
    }
    if (comment) console.log(`   💬 Comment: ${comment}`);
    if (partnerDetails.isDebtComplete) {
        console.log('   🎉 DEBT FULLY PAID!');
    }

    res.json({ success: true, state: { totalDebtPaid: state.totalDebtPaid, totalSalaryPaid: state.totalSalaryPaid, debtFullyPaid: state.debtFullyPaid } });
});

app.put('/api/payment/:id', (req, res) => {
    const { id } = req.params;
    const { amount, comment, telegramId, paymentStartDate, paymentEndDate } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const payment = state.payments.find(p => p.id === id);

    if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
    }

    if (paymentStartDate && paymentEndDate) {
        const startDate = new Date(paymentStartDate);
        const endDate = new Date(paymentEndDate);

        if (startDate > endDate) {
            return res.status(400).json({ error: 'Start date must be before end date' });
        }
    }

    if (payment.type === 'regular') {
        payment.amount = parseFloat(amount);
        payment.comment = comment || '';
        payment.paymentStartDate = paymentStartDate || null;
        payment.paymentEndDate = paymentEndDate || null;
        payment.editedAt = new Date().toISOString();

        recalculateState();

        console.log(`✏️  Payment edited: ID ${id}`);

        res.json({ success: true, state: { totalDebtPaid: state.totalDebtPaid, totalSalaryPaid: state.totalSalaryPaid } });
    } else {
        payment.amount = parseFloat(amount);
        payment.comment = comment || '';
        payment.editedAt = new Date().toISOString();

        recalculateState();

        res.json({ success: true });
    }
});

app.post('/api/extra-payment', (req, res) => {
    const { partner, amount, recordedBy, telegramId, comment } = req.body;

    if (!isAdmin(telegramId)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!partner || !['A', 'B', 'C'].includes(partner)) {
        return res.status(400).json({ error: 'Invalid partner' });
    }

    if (amount === undefined || amount === null) {
        return res.status(400).json({ error: 'Amount required' });
    }

    const amountNum = parseFloat(amount);

    if (isNaN(amountNum)) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    state.extraPayments[partner] += amountNum;
    state.totalExtraPayments += amountNum;

    const paymentId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    state.payments.push({
        id: paymentId,
        type: 'extra',
        partner,
        amount: amountNum,
        recordedBy: recordedBy || 'Unknown',
        timestamp: new Date().toISOString(),
        telegramId,
        comment: comment || ''
    });

    state.debtFullyPaid = getRemainingDebt() <= 0;

    const isNewDebt = amountNum < 0;
    console.log(`${isNewDebt ? '🆕 New Debt' : '💵 Extra Payment'}: ₹${Math.abs(amountNum)} for ${partner}`);
    if (comment) console.log(`   💬 Comment: ${comment}`);

    res.json({ success: true, extraPayments: state.extraPayments, totalExtraPayments: state.totalExtraPayments });
});

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

    state.payments.splice(paymentIndex, 1);
    recalculateState();

    console.log(`🗑️  Payment deleted: ID ${id}`);

    res.json({ success: true, state: { totalDebtPaid: state.totalDebtPaid, totalSalaryPaid: state.totalSalaryPaid } });
});

app.post('/api/admin/login', (req, res) => {
    const { password, telegramId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
    if (!ADMIN_TELEGRAM_ID && telegramId) {
        ADMIN_TELEGRAM_ID = telegramId.toString();
        approvedUsers.add(telegramId.toString());
        return res.json({ success: true, isAdmin: true });
    }
    if (isAdmin(telegramId)) return res.json({ success: true, isAdmin: true });
    res.status(403).json({ error: 'Admin already set' });
});

app.get('/api/admin/check', (req, res) => {
    const telegramId = req.query.telegramId;
    const admin = isAdmin(telegramId);
    const approved = isApprovedUser(telegramId);
    res.json({ isAdmin: admin, hasAdmin: !!ADMIN_TELEGRAM_ID, isApproved: approved });
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
        initialDebts: { ...INITIAL_DEBTS },
        debtFullyPaid: false
    };
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Partnership Calculator Server');
    console.log('✅ All features working!');
});
