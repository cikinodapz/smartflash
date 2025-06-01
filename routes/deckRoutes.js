
const express = require('express');
const { createDeck,getDecks,updateDeck,deleteDeck, shareDeck, getSharedDecks, getDeckById, getUserProfile, getPublicDecks, getLearningContribution, upvoteDeck, copyDeck, addComment, getComments, getUpvoteCount} = require('../controllers/deckController/deck');
const authMiddleware = require('../middlewares/auth.middleware'); 

const router = express.Router();

router.get('/profile', authMiddleware, getUserProfile);
router.get('/contributions', authMiddleware, getLearningContribution);
//deck manage
router.post('/createDeck', authMiddleware, createDeck); 
router.get('/getAllDeck', authMiddleware, getDecks); 
router.get('/getDeck/:deckId', authMiddleware, getDeckById);
router.put('/editDeck/:id', authMiddleware, updateDeck); 
router.delete('/hapusDeck/:id', authMiddleware, deleteDeck);

router.post('/share/:deckId', authMiddleware, shareDeck);
router.get('/shared', authMiddleware, getSharedDecks);
router.get('/public', getPublicDecks);
//analitik, history dan progress masih kosong ya!!

router.post('/decks/:id/upvote', authMiddleware, upvoteDeck);
router.get('/decks/:id/upvotes', getUpvoteCount);
router.post('/decks/:id/copy', authMiddleware, copyDeck);
router.post('/decks/:id/comment', authMiddleware, addComment);
router.get('/decks/:id/comments', getComments);




module.exports = router;
