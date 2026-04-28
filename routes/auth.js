const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
    const { username, email, password, shop_name, phone } = req.body;
    
    try {
        // Check if user exists
        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Insert user
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password, shop_name, phone) VALUES (?, ?, ?, ?, ?)',
            [username, email, hashedPassword, shop_name, phone]
        );
        
        // Create token
        const token = jwt.sign({ id: result.insertId, username }, process.env.JWT_SECRET, {
            expiresIn: '7d'
        });
        
        res.json({
            success: true,
            token,
            user: { 
                id: result.insertId, 
                username, 
                email, 
                shop_name, 
                phone,
                gst: '',
                pan: '',
                shop_type: 'Kirana / General Store',
                established: '',
                address: ''
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, {
            expiresIn: '7d'
        });
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                shop_name: user.shop_name,
                phone: user.phone,
                gst: user.gst || '',
                pan: user.pan || '',
                shop_type: user.shop_type || 'Kirana / General Store',
                established: user.established || '',
                address: user.address || ''
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get current user
router.get('/me', async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [users] = await pool.query(
            'SELECT id, username, email, phone, shop_name, gst, pan, shop_type, established, address, created_at FROM users WHERE id = ?',
            [decoded.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json({ 
            success: true, 
            user: {
                id: users[0].id,
                username: users[0].username,
                email: users[0].email,
                phone: users[0].phone,
                shop_name: users[0].shop_name,
                gst: users[0].gst || '',
                pan: users[0].pan || '',
                shop_type: users[0].shop_type || 'Kirana / General Store',
                established: users[0].established || '',
                address: users[0].address || ''
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update profile
router.put('/update', async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const { username, email, phone } = req.body;
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        await pool.query(
            'UPDATE users SET username = ?, email = ?, phone = ? WHERE id = ?',
            [username, email, phone, decoded.id]
        );
        
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update shop details
router.put('/shop', async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const { shop_name, gst, pan, shop_type, established, address } = req.body;
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        await pool.query(
            `UPDATE users SET 
                shop_name = ?, 
                gst = ?, 
                pan = ?, 
                shop_type = ?, 
                established = ?, 
                address = ? 
            WHERE id = ?`,
            [shop_name, gst || null, pan || null, shop_type || 'Kirana / General Store', established || null, address || null, decoded.id]
        );
        
        res.json({ success: true, message: 'Shop details updated successfully' });
    } catch (error) {
        console.error('Update shop error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Change password
router.put('/password', async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const { currentPassword, newPassword } = req.body;
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const [users] = await pool.query('SELECT password FROM users WHERE id = ?', [decoded.id]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const isMatch = await bcrypt.compare(currentPassword, users[0].password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, decoded.id]);
        
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get total users count (for landing page stats) - NO AUTH REQUIRED
router.get('/users/count', async (req, res) => {
    try {
        const [result] = await pool.query('SELECT COUNT(*) as count FROM users');
        res.json({ success: true, count: result[0].count });
    } catch (error) {
        console.error('Error fetching user count:', error);
        res.json({ success: true, count: 0 });
    }
});

// Delete account
router.delete('/delete', async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Delete user's data first (cascade will handle related tables)
        await pool.query('DELETE FROM users WHERE id = ?', [decoded.id]);
        
        res.json({ success: true, message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Logout (optional - client-side token removal is enough)
router.post('/logout', async (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;