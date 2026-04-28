const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Helper function to format numbers in Indian style
function formatIndianNumber(num) {
    if (num >= 10000000) {
        return (num / 10000000).toFixed(1) + 'Cr';
    } else if (num >= 100000) {
        return (num / 100000).toFixed(1) + 'L';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Create new sale
 * POST /api/sales
 */
router.post('/', auth, async (req, res) => {
    const { items, payment_method, total_amount, total_profit, customer_name, customer_phone } = req.body;
    const invoice_no = `INV${Date.now()}`;
    
    // Validate required fields
    if (!items || !items.length) {
        return res.status(400).json({ 
            success: false, 
            message: 'No items in sale' 
        });
    }
    
    if (!payment_method) {
        return res.status(400).json({ 
            success: false, 
            message: 'Payment method is required' 
        });
    }
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Handle customer
        let customer_id = null;
        if (customer_name && customer_phone) {
            const [existing] = await connection.query(
                'SELECT customer_id FROM customers WHERE phone = ?',
                [customer_phone]
            );
            
            if (existing.length > 0) {
                customer_id = existing[0].customer_id;
            } else {
                const [newCustomer] = await connection.query(
                    'INSERT INTO customers (name, phone) VALUES (?, ?)',
                    [customer_name, customer_phone]
                );
                customer_id = newCustomer.insertId;
            }
        }
        
        // Create sale record using Advanced Stored Procedure
        await connection.query(
            'CALL sp_process_sale(?, ?, ?, ?, ?, ?, @out_sale_id)',
            [invoice_no, req.user.id, customer_id, total_amount, total_profit, payment_method]
        );
        const [outParam] = await connection.query('SELECT @out_sale_id AS sale_id');
        const saleId = outParam[0].sale_id;
        
        // Insert sale items and update stock using Stored Procedure
        for (const item of items) {
            await connection.query(
                'INSERT INTO sale_items (sale_id, product_id, quantity, price_at_time, cost_at_time, profit) VALUES (?, ?, ?, ?, ?, ?)',
                [saleId, item.product_id, item.quantity, item.price, item.cost, item.profit]
            );
            
            await connection.query(
                'CALL sp_update_product_stock(?, ?)',
                [item.product_id, -item.quantity]
            );
        }
        
        await connection.commit();
        res.json({ success: true, message: 'Sale completed', invoice_no, sale_id: saleId });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating sale:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    } finally {
        connection.release();
    }
});

/**
 * Get all sales for logged-in user
 * GET /api/sales
 */
router.get('/', auth, async (req, res) => {
    try {
        const [sales] = await pool.query(`
            SELECT s.*, c.name as customer_name, COUNT(si.id) as items_count 
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN sale_items si ON s.id = si.sale_id
            WHERE s.user_id = ?
            GROUP BY s.id
            ORDER BY s.created_at DESC
            LIMIT 1000
        `, [req.user.id]);
        
        res.json({ success: true, sales: sales || [] });
    } catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get total number of sales for ALL users (for landing page stats)
 * GET /api/sales/total - NO AUTH REQUIRED
 */
router.get('/total', async (req, res) => {
    try {
        const [result] = await pool.query(`
            SELECT 
                COUNT(*) as total_sales,
                COUNT(DISTINCT user_id) as total_users
            FROM sales
        `);
        
        const totalSalesCount = result[0].total_sales || 0;
        const totalUsers = result[0].total_users || 0;
        
        res.json({ 
            success: true, 
            total_sales: totalSalesCount,
            total_users: totalUsers,
            total_sales_formatted: formatIndianNumber(totalSalesCount),
            total_users_formatted: formatIndianNumber(totalUsers)
        });
    } catch (error) {
        console.error('Error fetching total sales:', error);
        res.json({ 
            success: true, 
            total_sales: 0,
            total_users: 0,
            total_sales_formatted: '0',
            total_users_formatted: '0'
        });
    }
});

/**
 * Get single sale by ID with items
 * GET /api/sales/:id
 */
router.get('/:id', auth, async (req, res) => {
    try {
        const [sale] = await pool.query(`
            SELECT s.*, c.name as customer_name
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE s.id = ? AND s.user_id = ?
        `, [req.params.id, req.user.id]);
        
        if (sale.length === 0) {
            return res.status(404).json({ success: false, message: 'Sale not found' });
        }
        
        const [items] = await pool.query(`
            SELECT si.*, p.name as product_name, p.barcode
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = ?
        `, [req.params.id]);
        
        res.json({ success: true, sale: sale[0], items: items || [] });
    } catch (error) {
        console.error('Error fetching sale:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get sale items by sale ID
 * GET /api/sales/:id/items
 */
router.get('/:id/items', auth, async (req, res) => {
    try {
        const [items] = await pool.query(`
            SELECT 
                si.*, 
                p.name as product_name,
                p.barcode,
                p.category_id
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = ?
        `, [req.params.id]);
        
        res.json({ success: true, items: items || [] });
    } catch (error) {
        console.error('Error fetching sale items:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get daily sales summary for logged-in user
 * GET /api/sales/summary/daily
 */
router.get('/summary/daily', auth, async (req, res) => {
    try {
        const [result] = await pool.query(`
            SELECT 
                COALESCE(SUM(total_amount), 0) as total_sales,
                COALESCE(SUM(total_profit), 0) as total_profit,
                COUNT(*) as transactions
            FROM sales
            WHERE user_id = ? AND DATE(created_at) = CURDATE()
        `, [req.user.id]);
        
        res.json({ 
            success: true, 
            summary: {
                total_sales: result[0].total_sales || 0,
                total_profit: result[0].total_profit || 0,
                transactions: result[0].transactions || 0
            }
        });
    } catch (error) {
        console.error('Error fetching daily summary:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get weekly sales summary
 * GET /api/sales/summary/weekly
 */
router.get('/summary/weekly', auth, async (req, res) => {
    try {
        const [result] = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                SUM(total_amount) as total_sales,
                SUM(total_profit) as total_profit,
                COUNT(*) as transactions
            FROM sales
            WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [req.user.id]);
        
        res.json({ success: true, weekly_summary: result || [] });
    } catch (error) {
        console.error('Error fetching weekly summary:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get monthly sales summary
 * GET /api/sales/summary/monthly
 */
router.get('/summary/monthly', auth, async (req, res) => {
    const { month, year } = req.query;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();
    
    try {
        const [result] = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                SUM(total_amount) as total_sales,
                SUM(total_profit) as total_profit,
                COUNT(*) as transactions
            FROM sales
            WHERE user_id = ? AND MONTH(created_at) = ? AND YEAR(created_at) = ?
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [req.user.id, currentMonth, currentYear]);
        
        res.json({ success: true, monthly_summary: result || [] });
    } catch (error) {
        console.error('Error fetching monthly summary:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get sales by date range
 * GET /api/sales/range?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
router.get('/range', auth, async (req, res) => {
    const { start, end } = req.query;
    
    if (!start || !end) {
        return res.status(400).json({ 
            success: false, 
            message: 'Start and end dates are required' 
        });
    }
    
    try {
        const [sales] = await pool.query(`
            SELECT s.*, c.name as customer_name, COUNT(si.id) as items_count
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN sale_items si ON s.id = si.sale_id
            WHERE s.user_id = ? AND DATE(s.created_at) BETWEEN ? AND ?
            GROUP BY s.id
            ORDER BY s.created_at DESC
        `, [req.user.id, start, end]);
        
        res.json({ 
            success: true, 
            sales: sales || [],
            count: sales?.length || 0,
            total_amount: sales?.reduce((sum, s) => sum + (s.total_amount || 0), 0) || 0
        });
    } catch (error) {
        console.error('Error fetching sales by range:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;