const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();


// Daily sales report
router.get('/daily', auth, async (req, res) => {
    const { date } = req.query;
    
    try {
        const [sales] = await pool.query(`
            SELECT s.*, c.name as customer_name, COUNT(si.id) as items_count
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN sale_items si ON s.id = si.sale_id
            WHERE s.user_id = ? AND DATE(s.created_at) = ?
            GROUP BY s.id
            ORDER BY s.created_at DESC
        `, [req.user.id, date || 'CURDATE()']);
        
        const queryDate = date || new Date().toISOString().split('T')[0];
        const [summary] = await pool.query(`
            SELECT 
                COALESCE(revenue, 0) as total_revenue,
                COALESCE(total_profit, 0) as total_profit,
                COALESCE(total_invoices, 0) as total_sales
            FROM vw_daily_sales_summary
            WHERE user_id = ? AND sale_date = ?
        `, [req.user.id, queryDate]);
        
        res.json({ success: true, sales, summary: summary[0] || { total_revenue: 0, total_profit: 0, total_sales: 0 } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Top selling products
router.get('/top-products', auth, async (req, res) => {
    const { limit } = req.query;
    
    try {
        const [products] = await pool.query(`
            SELECT 
                product_id as id,
                name,
                total_quantity,
                total_revenue,
                total_profit
            FROM vw_top_selling_products
            WHERE user_id = ?
            ORDER BY total_quantity DESC
            LIMIT ?
        `, [req.user.id, parseInt(limit) || 10]);
        
        res.json({ success: true, products });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Monthly profit & loss
router.get('/profit-loss', auth, async (req, res) => {
    const { month, year } = req.query;
    
    try {
        // Query current month directly from tables to ensure 100% reliability
        const [report] = await pool.query(`
            SELECT 
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(total_profit), 0) as gross_profit
            FROM sales
            WHERE user_id = ? AND MONTH(created_at) = ? AND YEAR(created_at) = ?
        `, [req.user.id, month, year]);
        
        const [expenses] = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses
            FROM expenses
            WHERE user_id = ? AND MONTH(expense_date) = ? AND YEAR(expense_date) = ?
        `, [req.user.id, month, year]);
        
        // Fetch previous month
        let prevMonth = month - 1;
        let prevYear = year;
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = year - 1;
        }
        
        // Fallback to direct tables if view fails or doesn't have data
        const [prevReport] = await pool.query(`
            SELECT 
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(SUM(total_profit), 0) as gross_profit
            FROM sales
            WHERE user_id = ? AND MONTH(created_at) = ? AND YEAR(created_at) = ?
        `, [req.user.id, prevMonth, prevYear]);
        
        const [prevExpenses] = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_expenses
            FROM expenses
            WHERE user_id = ? AND MONTH(expense_date) = ? AND YEAR(expense_date) = ?
        `, [req.user.id, prevMonth, prevYear]);
        
        const rev = report.length > 0 ? report[0].total_revenue : 0;
        const gp = report.length > 0 ? report[0].gross_profit : 0;
        const exp = expenses.length > 0 ? expenses[0].total_expenses : 0;
        const netProfit = gp - exp;
        const profitMargin = rev ? (netProfit / rev * 100).toFixed(2) : 0;
        
        const prevRev = prevReport[0].total_revenue || 0;
        const prevGp = prevReport[0].gross_profit || 0;
        const prevExp = prevExpenses[0].total_expenses || 0;
        
        const revChange = prevRev ? ((rev - prevRev) / prevRev * 100).toFixed(1) : (rev ? 100 : 0);
        const gpChange = prevGp ? ((gp - prevGp) / prevGp * 100).toFixed(1) : (gp ? 100 : 0);
        const expChange = prevExp ? ((exp - prevExp) / prevExp * 100).toFixed(1) : (exp ? 100 : 0);
        
        res.json({
            success: true,
            report: {
                revenue: rev,
                gross_profit: gp,
                expenses: exp,
                net_profit: netProfit,
                profit_margin: profitMargin,
                changes: {
                    revenue: revChange,
                    profit: gpChange,
                    expenses: expChange
                }
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get sales by category
 * GET /api/reports/sales-by-category
 */
router.get('/sales-by-category', auth, async (req, res) => {
    try {
        const [categories] = await pool.query(`
            SELECT 
                COALESCE(c.name, 'Uncategorized') as name,
                SUM(si.quantity * si.price_at_time) as revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE s.user_id = ?
            GROUP BY c.id, c.name
            ORDER BY revenue DESC
        `, [req.user.id]);
        
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Error fetching sales by category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Get sales data for Revenue Overview chart
 * GET /api/reports/sales-data
 */
router.get('/sales-data', auth, async (req, res) => {
    try {
        const period = req.query.period || 'month';
        let labels = [];
        let values = [];
        
        if (period === 'week') {
            // Last 7 days
            labels = ['6 days ago', '5 days ago', '4 days ago', '3 days ago', '2 days ago', 'Yesterday', 'Today'];
            values = [0, 0, 0, 0, 0, 0, 0];
            
            const [sales] = await pool.query(`
                SELECT DATE(created_at) as date, SUM(total_amount) as amount 
                FROM sales 
                WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY DATE(created_at)
            `, [req.user.id]);
            
            sales.forEach(s => {
                const diff = Math.floor((new Date().getTime() - new Date(s.date).getTime()) / (1000 * 3600 * 24));
                if (diff >= 0 && diff <= 6) values[6 - diff] += parseFloat(s.amount) || 0;
            });
            
        } else if (period === 'month') {
            // 4 weeks of current month
            labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            values = [0, 0, 0, 0];
            
            const [sales] = await pool.query(`
                SELECT DAY(created_at) as day, SUM(total_amount) as amount 
                FROM sales 
                WHERE user_id = ? AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())
                GROUP BY DAY(created_at)
            `, [req.user.id]);
            
            console.log("SALES DB RESULT:", sales);
            
            sales.forEach(s => {
                const weekIndex = Math.min(Math.floor((s.day - 1) / 7), 3);
                values[weekIndex] += parseFloat(s.amount) || 0;
            });
            
        } else {
            // 12 months
            labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            
            const [sales] = await pool.query(`
                SELECT MONTH(created_at) as month, SUM(total_amount) as amount 
                FROM sales 
                WHERE user_id = ? AND YEAR(created_at) = YEAR(CURDATE())
                GROUP BY MONTH(created_at)
            `, [req.user.id]);
            
            sales.forEach(s => {
                if (s.month >= 1 && s.month <= 12) values[s.month - 1] += parseFloat(s.amount) || 0;
            });
        }
        
        res.json({ success: true, labels, values });
    } catch (error) {
        console.error('Error fetching sales data chart:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;