const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all expenses
router.get('/', auth, async (req, res) => {
    try {
        const [expenses] = await pool.query(
            'SELECT * FROM expenses WHERE user_id = ? ORDER BY expense_date DESC LIMIT 100',
            [req.user.id]
        );
        
        res.json({ success: true, expenses });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add expense
router.post('/', auth, async (req, res) => {
    const { expense_name, category, amount, payment_method, notes, expense_date } = req.body;
    
    try {
        const [result] = await pool.query(
            `INSERT INTO expenses (user_id, expense_name, category, amount, payment_method, notes, expense_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, expense_name, category, amount, payment_method, notes, expense_date]
        );
        
        res.json({ success: true, message: 'Expense added', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete expense
router.delete('/:id', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM expenses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ success: true, message: 'Expense deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;