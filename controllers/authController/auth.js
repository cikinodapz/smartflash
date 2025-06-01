const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { verifyGoogleToken } = require('../config/googleAuth');
const prisma = new PrismaClient();

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password (assuming password is hashed, e.g., with bcrypt)
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log('Generated JWT payload:', { id: user.id }); // Debug: Log payload

    res.status(200).json({ message: 'Login successful', token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Logout Function
const logout = async (req, res) => {
    try {
      res.clearCookie("token"); // Hapus token dari cookie
      res.status(200).json({ message: "Logout berhasil" });
    } catch (error) {
      res.status(500).json({ message: "Terjadi kesalahan", error });
    }
  };


  const register = async (req, res) => {
    try {
      const { name, email, password } = req.body;
  
      // Cek apakah email sudah terdaftar
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: 'Email sudah digunakan' });
      }
  
      // Hash password sebelum disimpan
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Simpan user baru ke database
      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });
  
      res.status(201).json({
        message: 'Registrasi berhasil',
        user: { id: newUser.id, name: newUser.name, email: newUser.email },
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Terjadi kesalahan server' });
    }
  };


  const googleAuth = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        message: "Google token is missing",
      });
    }

    const verificationResponse = await verifyGoogleToken(token);
    
    if (verificationResponse.error) {
      return res.status(400).json({
        message: verificationResponse.error,
      });
    }

    const profile = verificationResponse?.payload;
    
    // Cek apakah user sudah ada di database
    let user = await prisma.user.findUnique({
      where: { email: profile?.email },
    });

    if (!user) {
      // Jika user belum ada, buat user baru
      user = await prisma.user.create({
        data: {
          email: profile?.email,
          name: profile?.name,
          password: "", // Password kosong karena login via Google
          // Anda bisa menambahkan field lain dari profile Google jika diperlukan
        },
      });
    }

    // Generate JWT token
    const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    // Set cookie jika diperlukan
    res.cookie("token", jwtToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    res.status(200).json({
      message: "Login dengan Google berhasil",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token: jwtToken,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({
      message: "Terjadi kesalahan saat autentikasi dengan Google",
      error: error.message,
    });
  }
};

module.exports = { login, logout,register,googleAuth };
