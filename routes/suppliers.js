const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all suppliers for logged-in user
router.get('/', auth, async (req, res) => {
    try {
        const [suppliers] = await pool.query(`
            SELECT s.*, 
                   GROUP_CONCAT(DISTINCT sp.product_id) as product_ids,
                   GROUP_CONCAT(DISTINCT p.name) as product_names
            FROM suppliers s
            LEFT JOIN supplier_products sp ON s.id = sp.supplier_id
            LEFT JOIN products p ON sp.product_id = p.id
            WHERE s.user_id = ?
            GROUP BY s.id
            ORDER BY s.created_at DESC
        `, [req.user.id]);
        
        // Format products for each supplier
        const formattedSuppliers = suppliers.map(s => {
            let products = [];
            if (s.product_ids) {
                const ids = s.product_ids.split(',');
                const names = s.product_names ? s.product_names.split(',') : [];
                products = ids.map((id, idx) => ({
                    id: parseInt(id),
                    name: names[idx] || 'Unknown'
                }));
            }
            return {
                ...s,
                products: products
            };
        });
        
        res.json({ success: true, suppliers: formattedSuppliers });
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add supplier
router.post('/', auth, async (req, res) => {
    const { name, contact_person, phone, email, address, city, state, payment_terms, status, products } = req.body;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Insert supplier
        const [result] = await connection.query(
            `INSERT INTO suppliers (user_id, name, contact_person, phone, email, address, city, state, payment_terms, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, name, contact_person || null, phone || null, email || null, address || null, city || null, state || null, payment_terms || 'cash', status || 'active']
        );
        
        const supplierId = result.insertId;
        
        // Insert supplier products
        if (products && products.length > 0) {
            let productList = products;
            if (typeof products === 'string') {
                productList = JSON.parse(products);
            }
            for (const product of productList) {
                await connection.query(
                    'INSERT INTO supplier_products (supplier_id, product_id) VALUES (?, ?)',
                    [supplierId, product.id]
                );
            }
        }
        
        await connection.commit();
        res.json({ success: true, message: 'Supplier added', id: supplierId });
    } catch (error) {
        await connection.rollback();
        console.error('Error adding supplier:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    } finally {
        connection.release();
    }
});

// Update supplier
router.put('/:id', auth, async (req, res) => {
    const { name, contact_person, phone, email, address, city, state, payment_terms, status, products } = req.body;
    const supplierId = req.params.id;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Update supplier
        await connection.query(
            `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, city = ?, state = ?, payment_terms = ?, status = ?
             WHERE id = ? AND user_id = ?`,
            [name, contact_person || null, phone || null, email || null, address || null, city || null, state || null, payment_terms || 'cash', status || 'active', supplierId, req.user.id]
        );
        
        // Delete existing product links
        await connection.query('DELETE FROM supplier_products WHERE supplier_id = ?', [supplierId]);
        
        // Insert new product links
        if (products && products.length > 0) {
            let productList = products;
            if (typeof products === 'string') {
                productList = JSON.parse(products);
            }
            for (const product of productList) {
                await connection.query(
                    'INSERT INTO supplier_products (supplier_id, product_id) VALUES (?, ?)',
                    [supplierId, product.id]
                );
            }
        }
        
        await connection.commit();
        res.json({ success: true, message: 'Supplier updated' });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating supplier:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    } finally {
        connection.release();
    }
});

// Delete supplier
router.delete('/:id', auth, async (req, res) => {
    try {
        // First delete related supplier_products (cascade will handle, but explicit for safety)
        await pool.query('DELETE FROM supplier_products WHERE supplier_id = ?', [req.params.id]);
        await pool.query('DELETE FROM suppliers WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ success: true, message: 'Supplier deleted' });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get monthly purchase summary
router.get('/monthly-purchase', auth, async (req, res) => {
    const { month, year } = req.query;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();
    
    try {
        const [result] = await pool.query(`
            SELECT 
                COALESCE(SUM(p.total_amount), 0) as total_purchase
            FROM purchases p
            WHERE p.user_id = ? AND MONTH(p.purchase_date) = ? AND YEAR(p.purchase_date) = ?
        `, [req.user.id, currentMonth, currentYear]);
        
        res.json({ success: true, total_purchase: result[0].total_purchase });
    } catch (error) {
        console.error('Error fetching monthly purchase:', error);
        res.json({ success: true, total_purchase: 0 }); // Return 0 instead of error
    }
});

module.exports = router;