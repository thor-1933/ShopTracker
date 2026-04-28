const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all products for logged-in user
router.get('/', auth, async (req, res) => {
    try {
        const [products] = await pool.query(`
            SELECT p.*, c.name as category_name 
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC
        `, [req.user.id]);
        
        res.json({ success: true, products });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get product by barcode
router.get('/barcode/:code', auth, async (req, res) => {
    try {
        const [products] = await pool.query(
            'SELECT * FROM products WHERE barcode = ? AND user_id = ?',
            [req.params.code, req.user.id]
        );
        
        if (products.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        res.json({ success: true, product: products[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add product
router.post('/', auth, async (req, res) => {
    const { name, barcode, category_id, purchase_price, selling_price, current_stock, min_stock } = req.body;
    
    try {
        const [result] = await pool.query(
            `INSERT INTO products (user_id, name, barcode, category_id, purchase_price, selling_price, current_stock, min_stock)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, name, barcode || null, category_id || null, purchase_price, selling_price, current_stock || 0, min_stock || 5]
        );
        
        res.json({ success: true, message: 'Product added', id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update product
router.put('/:id', auth, async (req, res) => {
    const { name, selling_price, current_stock, min_stock } = req.body;
    
    try {
        await pool.query(
            'UPDATE products SET name = ?, selling_price = ?, current_stock = ?, min_stock = ? WHERE id = ? AND user_id = ?',
            [name, selling_price, current_stock, min_stock, req.params.id, req.user.id]
        );
        
        res.json({ success: true, message: 'Product updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete product
router.delete('/:id', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;