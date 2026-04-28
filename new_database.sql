-- ==========================================================
-- NEW DATABASE SCHEMA WITH ADVANCED SQL FEATURES
-- Meets Quotas: 4 Subqueries, 4 Procedures, 5 Views, 4 Functions, TCL, Joins
-- ==========================================================

-- 1. DDL: Drop previous database and create new
DROP DATABASE IF EXISTS shoptrack_v2;
CREATE DATABASE shoptrack_v2;
USE shoptrack_v2;

-- 2. DDL: Create Tables
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    shop_name VARCHAR(100),
    phone VARCHAR(20),
    gst VARCHAR(50),
    pan VARCHAR(50),
    shop_type VARCHAR(100) DEFAULT 'Kirana / General Store',
    established VARCHAR(10),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DML: Insert initial data
INSERT INTO categories (name) VALUES 
('Groceries'), ('Dairy'), ('Beverages'), ('Snacks'), ('Household')
ON DUPLICATE KEY UPDATE name = name;

CREATE TABLE IF NOT EXISTS suppliers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    city VARCHAR(50),
    state VARCHAR(50),
    payment_terms VARCHAR(20) DEFAULT 'cash',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    barcode VARCHAR(50),
    category_id INT,
    supplier_id INT,
    purchase_price DECIMAL(10,2) DEFAULT 0,
    selling_price DECIMAL(10,2) DEFAULT 0,
    current_stock INT DEFAULT 0,
    min_stock INT DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
    id INT PRIMARY KEY AUTO_INCREMENT,
    invoice_no VARCHAR(20) UNIQUE,
    user_id INT NOT NULL,
    customer_id INT,
    total_amount DECIMAL(10,2) DEFAULT 0,
    total_profit DECIMAL(10,2) DEFAULT 0,
    payment_method VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sale_id INT,
    product_id INT,
    quantity INT DEFAULT 1,
    price_at_time DECIMAL(10,2),
    cost_at_time DECIMAL(10,2),
    profit DECIMAL(10,2),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS expenses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    expense_name VARCHAR(100) NOT NULL,
    category VARCHAR(50),
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(20),
    notes TEXT,
    expense_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    purchase_id VARCHAR(20) UNIQUE,
    supplier_id INT NOT NULL,
    user_id INT NOT NULL,
    purchase_date DATE NOT NULL,
    total_amount DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    purchase_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    purchase_price DECIMAL(10,2) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    supplier_id INT NOT NULL,
    product_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_supplier_product (supplier_id, product_id)
);


-- ==========================================================
-- 3. FUNCTIONS (Quota: 4)
-- ==========================================================
DELIMITER //

-- Function 1: Calculate profit based on prices and quantity
CREATE FUNCTION fn_calculate_profit(selling_price DECIMAL(10,2), purchase_price DECIMAL(10,2), quantity INT) 
RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
    RETURN (selling_price - purchase_price) * quantity;
END //

-- Function 2: Determine customer tier based on total spent
CREATE FUNCTION fn_get_customer_tier(total_spent DECIMAL(10,2)) 
RETURNS VARCHAR(20)
DETERMINISTIC
BEGIN
    IF total_spent > 50000 THEN RETURN 'Gold';
    ELSEIF total_spent > 10000 THEN RETURN 'Silver';
    ELSE RETURN 'Bronze';
    END IF;
END //

-- Function 3: Calculate tax (GST) for a given amount
CREATE FUNCTION fn_calculate_tax(amount DECIMAL(10,2), tax_rate DECIMAL(5,2)) 
RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
    RETURN amount * (tax_rate / 100);
END //

-- Function 4: Format numbers to Indian currency string
CREATE FUNCTION fn_format_currency(amount DECIMAL(10,2)) 
RETURNS VARCHAR(50)
DETERMINISTIC
BEGIN
    RETURN CONCAT('₹ ', FORMAT(amount, 2));
END //

DELIMITER ;


-- ==========================================================
-- 4. VIEWS (Quota: 5)
-- Contains Subqueries (Quota: 4)
-- ==========================================================

-- View 1: Low stock products with supplier details (Includes JOINs)
CREATE VIEW vw_low_stock_alerts AS
SELECT 
    p.user_id,
    p.id AS product_id,
    p.name AS product_name,
    c.name AS category_name,
    s.name AS supplier_name,
    p.current_stock,
    p.min_stock
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN suppliers s ON p.supplier_id = s.id
WHERE p.current_stock <= p.min_stock;

-- View 2: Daily Sales Summary (Contains SUBQUERY 1)
CREATE VIEW vw_daily_sales_summary AS
SELECT 
    s.user_id,
    DATE(s.created_at) AS sale_date,
    COUNT(s.id) AS total_invoices,
    SUM(s.total_amount) AS revenue,
    SUM(s.total_profit) AS total_profit,
    -- SUBQUERY 1: Get unique customers per day
    (SELECT COUNT(DISTINCT customer_id) FROM sales WHERE DATE(created_at) = DATE(s.created_at) AND user_id = s.user_id) AS unique_customers
FROM sales s
GROUP BY s.user_id, DATE(s.created_at);

-- View 3: Top Selling Products (Contains SUBQUERY 2)
CREATE VIEW vw_top_selling_products AS
SELECT 
    s.user_id,
    p.id AS product_id,
    p.name,
    SUM(si.quantity) AS total_quantity,
    SUM(si.quantity * si.price_at_time) AS total_revenue,
    SUM(si.profit) AS total_profit,
    -- SUBQUERY 2: Find the last time this product was sold
    (SELECT MAX(created_at) FROM sales WHERE id IN (SELECT sale_id FROM sale_items WHERE product_id = p.id)) AS last_sold
FROM sale_items si
JOIN products p ON si.product_id = p.id
JOIN sales s ON si.sale_id = s.id
GROUP BY s.user_id, p.id, p.name;

-- View 4: Monthly Profit and Loss (Contains SUBQUERY 3)
CREATE VIEW vw_monthly_profit_loss AS
SELECT 
    s.user_id,
    MONTH(s.created_at) AS month,
    YEAR(s.created_at) AS year,
    SUM(s.total_amount) AS total_revenue,
    SUM(s.total_profit) AS gross_profit,
    -- SUBQUERY 3: Aggregate expenses for the same month/year
    IFNULL((SELECT SUM(amount) FROM expenses e WHERE e.user_id = s.user_id AND MONTH(e.expense_date) = MONTH(s.created_at) AND YEAR(e.expense_date) = YEAR(s.created_at)), 0) AS total_expenses
FROM sales s
GROUP BY s.user_id, YEAR(s.created_at), MONTH(s.created_at);

-- View 5: Supplier Performance (Contains SUBQUERY 4)
CREATE VIEW vw_supplier_performance AS
SELECT 
    s.user_id,
    s.id AS supplier_id,
    s.name AS supplier_name,
    COUNT(p.id) AS total_purchases,
    SUM(p.total_amount) AS total_spent,
    -- SUBQUERY 4: Count number of products offered by this supplier
    (SELECT COUNT(*) FROM products WHERE supplier_id = s.id) AS products_supplied
FROM suppliers s
LEFT JOIN purchases p ON s.id = p.supplier_id
GROUP BY s.user_id, s.id, s.name;


-- ==========================================================
-- 5. STORED PROCEDURES (Quota: 4) 
-- Integrates TCL (Transactions)
-- ==========================================================
DELIMITER //

-- Procedure 1: Process Sale with Transaction and Error Handling (TCL)
CREATE PROCEDURE sp_process_sale(
    IN p_invoice_no VARCHAR(20),
    IN p_user_id INT,
    IN p_customer_id INT,
    IN p_total_amount DECIMAL(10,2),
    IN p_total_profit DECIMAL(10,2),
    IN p_payment_method VARCHAR(20),
    OUT p_sale_id INT
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transaction failed, sale rolled back';
    END;
    
    START TRANSACTION;
    
    INSERT INTO sales (invoice_no, user_id, customer_id, total_amount, total_profit, payment_method)
    VALUES (p_invoice_no, p_user_id, p_customer_id, p_total_amount, p_total_profit, p_payment_method);
    
    SET p_sale_id = LAST_INSERT_ID();
    
    COMMIT;
END //

-- Procedure 2: Log an expense safely
CREATE PROCEDURE sp_add_expense(
    IN p_user_id INT,
    IN p_expense_name VARCHAR(100),
    IN p_category VARCHAR(50),
    IN p_amount DECIMAL(10,2),
    IN p_method VARCHAR(20),
    IN p_date DATE
)
BEGIN
    INSERT INTO expenses (user_id, expense_name, category, amount, payment_method, expense_date)
    VALUES (p_user_id, p_expense_name, p_category, p_amount, p_method, p_date);
END //

-- Procedure 3: Update product stock dynamically
CREATE PROCEDURE sp_update_product_stock(
    IN p_product_id INT,
    IN p_quantity_change INT
)
BEGIN
    UPDATE products 
    SET current_stock = current_stock + p_quantity_change
    WHERE id = p_product_id;
END //

-- Procedure 4: Get Quick Summary Stats for a user
CREATE PROCEDURE sp_get_quick_stats(
    IN p_user_id INT,
    OUT p_revenue DECIMAL(10,2),
    OUT p_profit DECIMAL(10,2),
    OUT p_sales_count INT
)
BEGIN
    SELECT SUM(total_amount), SUM(total_profit), COUNT(id)
    INTO p_revenue, p_profit, p_sales_count
    FROM sales
    WHERE user_id = p_user_id;
END //

DELIMITER ;
