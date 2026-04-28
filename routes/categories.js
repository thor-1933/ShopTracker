const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all categories
router.get('/', auth, async (req, res) => {
    try {
        const [categories] = await pool.query(
            'SELECT * FROM categories ORDER BY name ASC'
        );
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get category by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const [categories] = await pool.query(
            'SELECT * FROM categories WHERE id = ?',
            [req.params.id]
        );
        if (categories.length === 0) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.json({ success: true, category: categories[0] });
    } catch (error) {
        console.error('Error fetching category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Add new category (optional - for manage categories feature)
router.post('/', auth, async (req, res) => {
    const { name, description } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, message: 'Category name required' });
    }
    
    try {
        const [result] = await pool.query(
            'INSERT INTO categories (name, description) VALUES (?, ?)',
            [name, description || null]
        );
        res.json({ success: true, message: 'Category added', id: result.insertId });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update category
router.put('/:id', auth, async (req, res) => {
    const { name, description } = req.body;
    
    try {
        await pool.query(
            'UPDATE categories SET name = ?, description = ? WHERE id = ?',
            [name, description || null, req.params.id]
        );
        res.json({ success: true, message: 'Category updated' });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete category
router.delete('/:id', auth, async (req, res) => {
    try {
        // First, set category_id to NULL for products using this category
        await pool.query('UPDATE products SET category_id = NULL WHERE category_id = ?', [req.params.id]);
        await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;