const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        console.log('✅ Connected to MySQL successfully!');
        await connection.end();
    } catch (error) {
        console.log('❌ Connection failed:', error.message);
        console.log('Please check your .env file');
    }
}

test();