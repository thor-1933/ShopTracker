const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all customers
router.get('/', auth, async (req, res) => {
    try {
        const [customers] = await pool.query(`
            SELECT DISTINCT c.* 
            FROM customers c
            JOIN sales s ON c.customer_id = s.customer_id
            WHERE s.user_id = ?
            ORDER BY c.name ASC
        `, [req.user.id]);
        
        res.json({ success: true, customers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Search customers
router.get('/search', auth, async (req, res) => {
    const { q } = req.query;
    
    try {
        const [customers] = await pool.query(`
            SELECT DISTINCT c.* 
            FROM customers c
            JOIN sales s ON c.customer_id = s.customer_id
            WHERE s.user_id = ? AND (c.name LIKE ? OR c.phone LIKE ?)
            ORDER BY c.name ASC
            LIMIT 10
        `, [req.user.id, `%${q}%`, `%${q}%`]);
        
        res.json({ success: true, customers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add customer
router.post('/', auth, async (req, res) => {
    const { name, phone, email } = req.body;
    
    try {
        const [result] = await pool.query(
            'INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)',
            [name, phone, email || null]
        );
        
        res.json({ success: true, message: 'Customer added', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;