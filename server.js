// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors'); // ตรวจสอบว่า import cors แล้ว
const path = require('path');
const fs = require('fs').promises;
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET; // ดึงค่า Secret จาก .env

// ตรวจสอบ JWT_SECRET
if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined in .env file. Please add it.');
    process.exit(1); // ออกจากโปรแกรมหากไม่มี JWT_SECRET
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// ***** ปรับปรุงการตั้งค่า CORS ให้รองรับ Authorization header และทุก Method *****
const corsOptions = {
  origin: 'https://lancerza.github.io', // อนุญาตให้เฉพาะโดเมนนี้เท่านั้นที่เรียก API ได้
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'], // เพิ่ม 'OPTIONS'
  allowedHeaders: ['Content-Type', 'Authorization'], // อนุญาต Authorization header
  credentials: true, // อนุญาตให้ส่ง cookies/authorization headers ข้าม Origin ได้
  optionsSuccessStatus: 204 // สำหรับ preflight requests
};
app.use(cors(corsOptions)); // ใช้ cors middleware พร้อม options ที่กำหนด
// **************************************************************************

app.use(express.json());

let channelsData = [];
let textsData = {};

async function loadInitialData() {
    try {
        const channelsPath = path.join(__dirname, 'channels.json');
        const textsPath = path.join(__dirname, 'texts.json');

        const channelsRaw = await fs.readFile(channelsPath, 'utf8');
        channelsData = JSON.parse(channelsRaw);

        const textsRaw = await fs.readFile(textsPath, 'utf8');
        textsData = JSON.parse(textsRaw);

        console.log('Channels and texts data loaded successfully from files.');
    } catch (error) {
        console.error('Error loading initial data from files:', error);
        console.error('Please check if channels.json and texts.json exist at the specified path.');
        channelsData = [];
        textsData = { runningText: "Error loading messages.", footerText: "Error." };
    }
}

async function createTables() {
    try {
        await pool.query(`
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(10) DEFAULT 'user',
                status VARCHAR(10) DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Users table checked/created successfully.');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS favorite_channels (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                channel_name VARCHAR(255) NOT NULL,
                channel_img_src VARCHAR(255),
                channel_data_url TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (user_id, channel_name)
            );
        `);
        console.log('Favorite_channels table checked/created successfully.');

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_favorite_channels_user_id ON favorite_channels (user_id);
        `);
        console.log('Indexes checked/created successfully.');

    } catch (error) {
        console.error('Error creating tables:', error);
        process.exit(1);
    }
}

// Middleware สำหรับยืนยัน JWT (ใช้ป้องกัน API ที่ต้องการ Login)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ message: 'Authentication token required.' }); // 401 Unauthorized
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // Token หมดอายุ, ไม่ถูกต้อง หรือผิดรูปแบบ
            return res.status(403).json({ message: 'Invalid or expired token.' }); // 403 Forbidden
        }
        req.user = user; // เก็บข้อมูลผู้ใช้ที่ถอดรหัสจาก Token ไว้ใน req
        next(); // ไปยัง Middleware/Route ถัดไป
    });
};

// Route สำหรับลงทะเบียนผู้ใช้ใหม่
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Username, email, and password are required.' });
    }

    try {
        // ตรวจสอบว่า username หรือ email ซ้ำหรือไม่
        const checkUser = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
        if (checkUser.rows.length > 0) {
            return res.status(409).json({ message: 'Username or Email already exists.' }); // 409 Conflict
        }

        // เข้ารหัสรหัสผ่าน
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // บันทึกผู้ใช้ใหม่ลงในฐานข้อมูล
        const result = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, role, status',
            [username, email, hashedPassword]
        );

        const newUser = result.rows[0];
        res.status(201).json({ message: 'User registered successfully!', user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role, status: newUser.status } });
    } catch (error) {
        console.error('Error during registration:', error.message);
        res.status(500).json({ message: 'Server error during registration.', error: error.message });
    }
});

// Route สำหรับเข้าสู่ระบบ
app.post('/api/login', async (req, res) => {
    const { identifier, password } = req.body; // identifier สามารถเป็น username หรือ email

    if (!identifier || !password) {
        return res.status(400).json({ message: 'Username/Email and password are required.' });
    }

    try {
        // ค้นหาผู้ใช้ด้วย username หรือ email
        const userResult = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $1', // $1 ใช้ซ้ำได้
            [identifier]
        );

        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' }); // 401 Unauthorized
        }

        // เปรียบเทียบรหัสผ่านที่เข้ารหัส
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' }); // 401 Unauthorized
        }

        // ตรวจสอบสถานะผู้ใช้ (ถ้า active เท่านั้นถึงจะ Login ได้)
        if (user.status !== 'active') {
            return res.status(403).json({ message: 'Your account is not active.' }); // 403 Forbidden
        }

        // สร้าง JWT Token
        // ข้อมูลที่จะเก็บใน Token (payload) ควรเป็นข้อมูลที่ไม่ละเอียดอ่อนและใช้ระบุตัวตนผู้ใช้
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '1h' } // Token จะหมดอายุใน 1 ชั่วโมง
        );

        res.status(200).json({
            message: 'Logged in successfully!',
            token: token,
            user: { id: user.id, username: user.username, email: user.email, role: user.role, status: user.status }
        });

    } catch (error) {
        console.error('Error during login:', error.message);
        res.status(500).json({ message: 'Server error during login.', error: error.message });
    }
});

// API Endpoint สำหรับดึงข้อมูลช่อง - ต้องใช้ Token
// เราจะใช้ authenticateToken middleware ที่นี่
app.get('/api/channels', authenticateToken, (req, res) => {
    // โค้ดนี้จะทำงานก็ต่อเมื่อ Token ถูกต้องเท่านั้น
    if (channelsData.length > 0) {
        res.json(channelsData);
    } else {
        res.status(500).json({ message: "Channel data not available or failed to load on server." });
    }
});

// API Endpoint สำหรับดึงข้อมูลข้อความ (runningText, footerText) - ไม่ต้องป้องกัน
app.get('/api/texts', (req, res) => {
    if (Object.keys(textsData).length > 0) {
        res.json(textsData);
    } else {
        res.status(500).json({ message: "Text data not available or failed to load on server." });
    }
});

// เริ่ม Server
app.listen(PORT, async () => {
    try {
        await pool.connect();
        console.log('Connected to PostgreSQL database.');
        await createTables();
        await loadInitialData();
        console.log(`Server running on port ${PORT}`);
    } catch (err) {
        console.error('Failed to connect to database or start server:', err);
        process.exit(1);
    }
});

// เพิ่มการจัดการเมื่อ Server ปิดเพื่อปิด Pool ด้วย
process.on('SIGINT', async () => {
    await pool.end();
    console.log('PostgreSQL connection pool closed.');
    process.exit(0);
});