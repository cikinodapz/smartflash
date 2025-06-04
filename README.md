# SmartFlash - Platform Pembelajaran Flashcard Berbasis AI  
  
## Deskripsi Umum Proyek  
  
SmartFlash adalah platform pembelajaran flashcard full-stack yang menggabungkan teknik spaced repetition tradisional dengan kemampuan AI modern untuk menciptakan lingkungan pembelajaran yang cerdas dan sosial. [1](#0-0)   
  
Platform ini memungkinkan pengguna untuk:  
- Membuat, mempelajari, dan berbagi deck flashcard dengan peningkatan AI  
- Menggunakan algoritma spaced repetition untuk optimasi pembelajaran  
- Mengintegrasikan multiple layanan AI untuk generasi konten  
- Menikmati fitur sosial untuk pengalaman pembelajaran kolaboratif  
- Melacak progress dengan analytics komprehensif  
  
## Penjelasan Arsitektur  
  
### Arsitektur Aplikasi Berlapis  
SmartFlash mengikuti pola arsitektur berlapis dengan pemisahan yang jelas antara layer aplikasi Express.js, controller business logic, middleware autentikasi, dan layer persistensi data.

### Model Data Utama  
- **User**: Autentikasi JWT + Google OAuth [2](#0-1)   
- **Deck**: Koleksi flashcard dengan kategori dan visibilitas  
- **Flashcard**: Konten multimedia dengan AI generation dan difficulty-based spaced repetition [3](#0-2)   
- **Progress**: Implementasi algoritma SM-2 untuk spaced repetition [4](#0-3)   
- **Analytics**: AI-powered insights dan rekomendasi pembelajaran

  ## Dependensi Penting  
  
### Core Framework & Runtime  
- **express** (~4.16.1): Web application framework [5](#0-4)   
- **@prisma/client** (^6.8.2): Type-safe database ORM [6](#0-5)   
  
### Authentication & Security  
- **jsonwebtoken** (^9.0.2): JWT token management [7](#0-6)   
- **google-auth-library** (^9.15.1): Google OAuth integration [8](#0-7)   
- **bcrypt** (^5.1.1): Password hashing [9](#0-8)   
  
### AI Integration  
- **@huggingface/inference** (^3.6.2): AI content generation [10](#0-9)   
- **openai** (^5.0.1): Advanced AI features [11](#0-10)   
  
### Utilities & Middleware  
- **cors** (^2.8.5): Cross-origin resource sharing [12](#0-11)   
- **multer** (^1.4.5): File upload handling [13](#0-12)   
- **axios** (^1.8.4): HTTP client untuk external APIs [14](#0-13)   
  
### Development Tools  
- **nodemon** (^3.1.9): Development server dengan hot reload [15](#0-14)   
- **prisma** (^6.8.2): Database migration dan schema management [16](#0-15)   
  
## Quick Start  
  
```bash  
# Install dependencies  [header-1](#header-1)
npm install  
  
# Setup database  [header-2](#header-2)
npx prisma migrate dev  
  
# Start development server  [header-3](#header-3)
npm run dev  
  
# Start production server  [header-4](#header-4)
npm start  
