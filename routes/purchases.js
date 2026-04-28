const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Get purchases for current month
router.get('/', auth, async (req, res) => {
    const { month, year } = req.query;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();
    
    try {
        const [purchases] = await pool.query(`
            SELECT p.*, s.name as supplier_name
            FROM purchases p
            LEFT JOIN suppliers s ON p.supplier_id = s.id
            WHERE p.user_id = ? AND MONTH(p.purchase_date) = ? AND YEAR(p.purchase_date) = ?
            ORDER BY p.purchase_date DESC
        `, [req.user.id, currentMonth, currentYear]);
        
        res.json({ success: true, purchases });
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.json({ success: true, purchases: [] });
    }
});

// Get purchases by supplier
router.get('/supplier/:supplierId', auth, async (req, res) => {
    try {
        const [purchases] = await pool.query(`
            SELECT p.*, pi.product_id, pr.name as product_name, pi.quantity, pi.purchase_price, pi.total_amount
            FROM purchases p
            JOIN purchase_items pi ON p.id = pi.purchase_id
            JOIN products pr ON pi.product_id = pr.id
            WHERE p.supplier_id = ? AND p.user_id = ?
            ORDER BY p.purchase_date DESC
        `, [req.params.supplierId, req.user.id]);
        
        res.json({ success: true, purchases });
    } catch (error) {
        console.error('Error fetching supplier purchases:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add new purchase (restock from supplier)
router.post('/', auth, async (req, res) => {
    const { supplier_id, items, purchase_date, total_amount } = req.body;
    const purchase_id = `PO${Date.now()}`;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Insert purchase record
        const [result] = await connection.query(
            `INSERT INTO purchases (purchase_id, supplier_id, user_id, purchase_date, total_amount)
             VALUES (?, ?, ?, ?, ?)`,
            [purchase_id, supplier_id, req.user.id, purchase_date || new Date(), total_amount]
        );
        
        const purchaseId = result.insertId;
        
        // Insert purchase items and update product stock
        for (const item of items) {
            await connection.query(
                `INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price, total_amount)
                 VALUES (?, ?, ?, ?, ?)`,
                [purchaseId, item.product_id, item.quantity, item.purchase_price, item.quantity * item.purchase_price]
            );
            
            // Update product stock
            await connection.query(
                `UPDATE products SET current_stock = current_stock + ?, purchase_price = ?
                 WHERE id = ? AND user_id = ?`,
                [item.quantity, item.purchase_price, item.product_id, req.user.id]
            );
        }
        
        await connection.commit();
        res.json({ success: true, message: 'Purchase recorded successfully', purchase_id });
    } catch (error) {
        await connection.rollback();
        console.error('Error adding purchase:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        connection.release();
    }
});

module.exports = router;