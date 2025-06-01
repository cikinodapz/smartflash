const express = require('express');
const router = express.Router();
// const upload = require('../middlewares/upload');
const authMiddleware = require('../middlewares/auth.middleware'); // Middleware untuk verifikasi token
const { getFlashcardsByDeck,createFlashcard, updateFlashcard, deleteFlashcard, startQuiz, answerFlashcard, copyFlashcardsToDeck, moveFlashcardsToDeck, startQuizLocal, startQuizDua, getLearningHistory, getLearningStats, QuizMode, submitAnswer, getStats, getUserStats, submitQuizAnswers, getWeeklyProgress, QuizModeByPublic, generateAnalytics, getUserAnalytics, getAnalyticsByCategory, autoGenerateAnalytics, createAutoFlashcards, generateFlashcards } = require('../controllers/flashcardController/flashcard');

//flashcard manage
router.post('/addCard/:id', authMiddleware, createFlashcard);
router.post('/add-auto-card/:id', authMiddleware, createAutoFlashcards);

router.get('/listCard/:id',authMiddleware, getFlashcardsByDeck);
router.put('/decks/:id/flashcards/:flashcardId', authMiddleware, updateFlashcard);
router.delete('/decks/:id/flashcards/:flashcardId', authMiddleware, deleteFlashcard);
router.get('/quiz/start/:id', authMiddleware, QuizMode);
router.get('/quizPublic/start/:id', authMiddleware, QuizModeByPublic);
router.post('/quiz/answer/:id', authMiddleware, submitAnswer);
router.get('/statistik', authMiddleware, getUserStats);
router.get('/stats/:id/', authMiddleware, getStats);

router.get('/weekly-progress', authMiddleware, getWeeklyProgress);

//analytics
router.post('/generate-analytics', authMiddleware, generateAnalytics);
router.get('/analytics', authMiddleware, getUserAnalytics);
router.get('/analytics/:category', authMiddleware, getAnalyticsByCategory);
router.post('/auto-generate-analytics', authMiddleware, autoGenerateAnalytics);

//extended
router.post('/decks/:targetDeckId/copy-flashcards', authMiddleware, copyFlashcardsToDeck); //fitur copy
router.post('/flashcards/move', authMiddleware, moveFlashcardsToDeck);//fitur cut
//quiz mode
router.get("/quiz/:deckId",authMiddleware, startQuiz); // Mulai kuis
router.post("/quiz/:flashcardId",authMiddleware, answerFlashcard); // Simpan jawaban user
router.get("/history", authMiddleware, getLearningHistory);
router.get("/stats", authMiddleware, getLearningStats);

//baru sampai kuis kocak
//done kuis
//tes cuyyykkk
module.exports = router;
