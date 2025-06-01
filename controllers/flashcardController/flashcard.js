const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const getFlashcardsByDeck = async (req, res) => {
  try {
    const { id } = req.params; // Deck ID from URL

    // Validate deck ID
    if (!id) {
      return res.status(400).json({ error: "Deck ID is required" });
    }

    // Get userId from authMiddleware
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Debug: Log the deck ID and user ID
    console.log("Fetching flashcards for deck:", id, "by user:", userId);

    // Check if the deck exists and belongs to the user
    const deck = await prisma.deck.findUnique({
      where: { id },
    });
    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }
    if (deck.userId !== userId) {
      return res.status(403).json({
        error: "You are not authorized to view flashcards in this deck",
      });
    }

    // Fetch flashcards for the deck
    const flashcards = await prisma.flashcard.findMany({
      where: { deckId: id },
      select: {
        id: true,
        question: true,
        answer: true,
        imageUrl: true,
        audioUrl: true,
        aiGenerated: true,
        tags: true,
        difficulty: true,
        deckId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res
      .status(200)
      .json({ message: "Flashcards retrieved successfully", flashcards });
  } catch (error) {
    console.error("Error fetching flashcards:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const createFlashcard = async (req, res) => {
  try {
    const { id } = req.params; // Deck ID from URL
    const {
      question,
      answer,
      imageUrl,
      audioUrl,
      tags,
      difficulty,
      aiGenerated,
    } = req.body;

    // Validate required fields
    if (!question || !answer) {
      return res
        .status(400)
        .json({ error: "Question and answer are required" });
    }

    // Get userId from authMiddleware
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Check if the deck exists and belongs to the user
    const deck = await prisma.deck.findUnique({
      where: { id },
    });
    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }
    if (deck.userId !== userId) {
      return res.status(403).json({
        error: "You are not authorized to add flashcards to this deck",
      });
    }

    // Create the flashcard
    const flashcard = await prisma.flashcard.create({
      data: {
        question,
        answer,
        imageUrl: imageUrl || null,
        audioUrl: audioUrl || null,
        aiGenerated: aiGenerated || false,
        tags: tags || [],
        difficulty: difficulty ? parseInt(difficulty, 10) : 1, // Default to 1 if not provided
        deckId: id,
      },
      select: {
        id: true,
        question: true,
        answer: true,
        imageUrl: true,
        audioUrl: true,
        aiGenerated: true,
        tags: true,
        difficulty: true,
        deckId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res
      .status(201)
      .json({ message: "Flashcard created successfully", flashcard });
  } catch (error) {
    console.error("Error creating flashcard:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const { InferenceClient } = require("@huggingface/inference");

const createAutoFlashcards = async (req, res) => {
  try {
    const { id } = req.params; // Deck ID
    const { sentences, count } = req.body; // Sentences to process and number of flashcards to generate
    const userId = req.user?.id;

    // Validate inputs
    if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
      return res
        .status(400)
        .json({ error: "Please provide sentences to generate flashcards" });
    }
    if (!count || count < 1 || count > 20) {
      return res.status(400).json({ error: "Count must be between 1 and 20" });
    }
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Verify deck ownership
    const deck = await prisma.deck.findUnique({ where: { id } });
    if (!deck) return res.status(404).json({ error: "Deck not found" });
    if (deck.userId !== userId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to modify this deck" });
    }

    // Combine sentences into a single text
    const text = sentences.join(" ");

    // Call Hugging Face API to generate Q&A pairs
    const generatedFlashcards = await generateFlashcardsWithAI(text, count);

    // Create flashcards in database
    const createdFlashcards = await prisma.$transaction(
      generatedFlashcards.map((flashcard) =>
        prisma.flashcard.create({
          data: {
            question: flashcard.question,
            answer: flashcard.answer,
            aiGenerated: true,
            tags: [flashcard.type || "general"],
            difficulty: flashcard.difficulty || 3, // Default to medium difficulty
            deckId: id,
          },
          select: {
            id: true,
            question: true,
            answer: true,
            aiGenerated: true,
            tags: true,
            difficulty: true,
            createdAt: true,
          },
        })
      )
    );

    res.status(201).json({
      message: `${createdFlashcards.length} flashcards generated successfully`,
      flashcards: createdFlashcards,
    });
  } catch (error) {
    console.error("Error generating flashcards:", error);
    res.status(500).json({
      error: "Failed to generate flashcards",
      details: error.message,
    });
  }
};

async function generateFlashcardsWithAI(text, count) {
  try {
    // Validate API key before creating client
    const apiKey = process.env.HUGGING_FACE_API_KEY;

    if (!apiKey || typeof apiKey !== "string") {
      console.error("Hugging Face API key is missing or invalid");
      throw new Error("Invalid API key");
    }

    if (!apiKey.startsWith("hf_")) {
      console.error(
        "Hugging Face API key format is incorrect (should start with hf_)"
      );
      throw new Error("Invalid API key format");
    }

    const client = new InferenceClient({
      token: apiKey,
    });

    const prompt = `Generate exactly ${count} question-answer pairs from this text: "${text}". 
    Return a valid JSON array with objects containing: question (string), answer (string), 
    type (factual, fill-in-the-blank, true-false, or contextual), and difficulty (1-5).
    Example: [{"question":"What is X?","answer":"X is Y","type":"factual","difficulty":1}]`;

    const response = await client.textGeneration({
      model: "google/flan-t5-base",
      prompt,
      parameters: {
        max_new_tokens: 3000,
        temperature: 0.7,
        top_p: 0.9,
        return_full_text: false,
      },
    });

    // Parse response
    let flashcards;
    try {
      const parsed = JSON.parse(response.generated_text);
      flashcards = Array.isArray(parsed)
        ? parsed
        : parsed.flashcards || parsed.results || [];
    } catch (e) {
      // Fallback if parsing fails
      const jsonMatch = response.generated_text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No valid JSON found");
      flashcards = JSON.parse(jsonMatch[0]);
    }

    return flashcards
      .slice(0, count)
      .map((item) => ({
        question: item.question?.trim() || "No question generated",
        answer: item.answer?.trim() || "No answer generated",
        type: (item.type?.toLowerCase() || "general").replace(/[^a-z-]/g, ""),
        difficulty: Math.min(Math.max(parseInt(item.difficulty) || 3, 1), 5),
      }))
      .filter(
        (item) =>
          item.question !== "No question generated" &&
          item.answer !== "No answer generated"
      );
  } catch (error) {
    console.error("Hugging Face generation error:", error);
    return generateSimpleFlashcards(text, count);
  }
}

// Simple fallback generator with varied question types
function generateSimpleFlashcards(text, count) {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const flashcards = [];
  const questionTypes = [
    {
      type: "factual",
      template: (s) => ({
        question: `What is true about: "${s}"?`,
        answer: s,
        difficulty: 2,
      }),
    },
    {
      type: "fill-in-the-blank",
      template: (s, word) => ({
        question: s.replace(word, "_____"),
        answer: word,
        difficulty: 3,
      }),
    },
    {
      type: "true-false",
      template: (s) => ({
        question: `Is this statement true: "${s}"?`,
        answer: "True",
        difficulty: 1,
      }),
    },
    {
      type: "contextual",
      template: (s) => ({
        question: `Why is this statement important: "${s}"?`,
        answer: `This statement highlights a key characteristic: ${s}`,
        difficulty: 4,
      }),
    },
  ];

  for (let i = 0; i < count; i++) {
    // Cycle through sentences if count exceeds number of sentences
    const sentence = sentences[i % sentences.length].trim();
    const words = sentence.split(" ");
    const randomWord = words[Math.floor(Math.random() * words.length)];
    const questionType = questionTypes[i % questionTypes.length];

    let flashcard;
    if (questionType.type === "fill-in-the-blank") {
      flashcard = questionType.template(sentence, randomWord);
    } else {
      flashcard = questionType.template(sentence);
    }

    flashcards.push({
      question: flashcard.question,
      answer: flashcard.answer,
      type: questionType.type,
      difficulty: flashcard.difficulty,
    });
  }

  return flashcards;
}

const updateFlashcard = async (req, res) => {
  try {
    const { id, flashcardId } = req.params; // Deck ID and Flashcard ID from URL
    const {
      question,
      answer,
      imageUrl,
      audioUrl,
      tags,
      difficulty,
      aiGenerated,
    } = req.body;

    // Validate input (at least one field to update)
    if (
      !question &&
      !answer &&
      imageUrl === undefined &&
      audioUrl === undefined &&
      tags === undefined &&
      difficulty === undefined &&
      aiGenerated === undefined
    ) {
      return res
        .status(400)
        .json({ error: "At least one field is required to update" });
    }

    // Validate deck and flashcard IDs
    if (!id || !flashcardId) {
      return res
        .status(400)
        .json({ error: "Deck ID and Flashcard ID are required" });
    }

    // Get userId from authMiddleware
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Debug: Log the deck ID, flashcard ID, and user ID
    console.log(
      "Updating flashcard:",
      flashcardId,
      "in deck:",
      id,
      "by user:",
      userId
    );

    // Check if the deck exists and belongs to the user
    const deck = await prisma.deck.findUnique({
      where: { id },
    });
    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }
    if (deck.userId !== userId) {
      return res.status(403).json({
        error: "You are not authorized to update flashcards in this deck",
      });
    }

    // Check if the flashcard exists and belongs to the deck
    const flashcard = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
    });
    if (!flashcard) {
      return res.status(404).json({ error: "Flashcard not found" });
    }
    if (flashcard.deckId !== id) {
      return res
        .status(400)
        .json({ error: "Flashcard does not belong to this deck" });
    }

    // Prepare update data
    const updateData = {};
    if (question) updateData.question = question;
    if (answer) updateData.answer = answer;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (audioUrl !== undefined) updateData.audioUrl = audioUrl;
    if (tags) updateData.tags = tags;
    if (difficulty !== undefined)
      updateData.difficulty = parseInt(difficulty, 10);
    if (aiGenerated !== undefined) updateData.aiGenerated = aiGenerated;

    // Update the flashcard
    const updatedFlashcard = await prisma.flashcard.update({
      where: { id: flashcardId },
      data: updateData,
      select: {
        id: true,
        question: true,
        answer: true,
        imageUrl: true,
        audioUrl: true,
        aiGenerated: true,
        tags: true,
        difficulty: true,
        deckId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      message: "Flashcard updated successfully",
      flashcard: updatedFlashcard,
    });
  } catch (error) {
    console.error("Error updating flashcard:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const deleteFlashcard = async (req, res) => {
  try {
    const { id, flashcardId } = req.params; // Deck ID and Flashcard ID from URL

    // Validate deck and flashcard IDs
    if (!id || !flashcardId) {
      return res
        .status(400)
        .json({ error: "Deck ID and Flashcard ID are required" });
    }

    // Get userId from authMiddleware
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Debug: Log the deck ID, flashcard ID, and user ID
    console.log(
      "Deleting flashcard:",
      flashcardId,
      "in deck:",
      id,
      "by user:",
      userId
    );

    // Check if the deck exists and belongs to the user
    const deck = await prisma.deck.findUnique({
      where: { id },
    });
    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }
    if (deck.userId !== userId) {
      return res.status(403).json({
        error: "You are not authorized to delete flashcards in this deck",
      });
    }

    // Check if the flashcard exists and belongs to the deck
    const flashcard = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
    });
    if (!flashcard) {
      return res.status(404).json({ error: "Flashcard not found" });
    }
    if (flashcard.deckId !== id) {
      return res
        .status(400)
        .json({ error: "Flashcard does not belong to this deck" });
    }

    // Delete related Progress and History records
    await prisma.progress.deleteMany({
      where: { flashcardId },
    });
    await prisma.history.deleteMany({
      where: { flashcardId },
    });

    // Delete the flashcard
    await prisma.flashcard.delete({
      where: { id: flashcardId },
    });

    res.status(200).json({ message: "Flashcard deleted successfully" });
  } catch (error) {
    console.error("Error deleting flashcard:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

require("dotenv").config();
const { HfInference } = require("@huggingface/inference");

const hf = new HfInference(process.env.HF_TOKEN);

const QuizMode = async (req, res) => {
  try {
    const { id } = req.params; // Deck ID
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Check if deck exists and belongs to user
    const deck = await prisma.deck.findUnique({
      where: { id },
      include: {
        flashcards: true,
      },
    });

    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }

    if (deck.flashcards.length === 0) {
      return res.status(400).json({
        error: "No flashcards found in this deck",
      });
    }

    // Get learning progress for all flashcards
    let progressData = [];
    try {
      progressData = await prisma.progress.findMany({
        where: {
          userId,
          flashcardId: { in: deck.flashcards.map((card) => card.id) },
        },
      });
    } catch (error) {
      console.log("Progress model not found, using default values");
    }

    // Prepare flashcards with progress data
    const flashcardsWithProgress = deck.flashcards.map((card) => {
      const progressRecord = progressData.find(
        (p) => p.flashcardId === card.id
      );
      const progress = progressRecord || {
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReview: new Date(0),
        lastReviewed: null,
        isLearned: false,
      };

      return {
        ...card,
        progress,
      };
    });

    // Fungsi untuk menghasilkan distractors dengan Hugging Face
    const generateDistractors = async (question, correctAnswer) => {
      try {
        const prompt = `
          Given the question: "${question}"
          and the correct answer: "${correctAnswer}"
          Generate 3 plausible but incorrect distractors for a multiple-choice quiz.
          Format the output as a list, one distractor per line, without numbers, quotes, brackets, or any symbols like *.
        `;

        const response = await hf.textGeneration({
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          inputs: prompt,
          parameters: {
            max_new_tokens: 100,
            temperature: 0.7,
            return_full_text: false,
          },
        });

        // Parsing teks yang dihasilkan
        let distractors = response.generated_text
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .map((line) => line.replace(/["\[\],*]|\d+\.\s*/g, "")) // Hapus tanda kutip, kurung, koma, bintang, dan prefiks angka
          .filter(
            (line) =>
              line &&
              line !== correctAnswer &&
              !line.includes("Given") &&
              !line.includes("Generate")
          )
          .slice(0, 3);

        // Jika kurang dari 3 distractors, tambahkan fallback
        while (distractors.length < 3) {
          distractors.push(`Varian ${distractors.length + 1}`);
        }

        return distractors;
      } catch (error) {
        console.error("Error generating distractors:", error);
        return ["Option 1", "Option 2", "Option 3"];
      }
    };

    // Generate quiz questions for ALL flashcards
    const generateQuizQuestions = async () => {
      return await Promise.all(
        flashcardsWithProgress.map(async (card) => {
          // Generate distractors using Hugging Face
          const distractors = await generateDistractors(
            card.question,
            card.answer
          );

          // Combine and shuffle options
          const allOptions = [card.answer, ...distractors];
          const shuffledOptions = allOptions.sort(() => Math.random() - 0.5);

          // Generate options with IDs (A, B, C, D)
          const options = shuffledOptions.map((option, index) => ({
            id: String.fromCharCode(65 + index),
            text: option,
            isCorrect: option === card.answer,
          }));

          return {
            flashcardId: card.id,
            question: card.question,
            imageUrl: card.imageUrl,
            audioUrl: card.audioUrl,
            options: options.map((opt) => ({
              id: opt.id,
              text: opt.text,
            })),
            correctAnswer: card.answer,
            difficulty: card.difficulty,
            progress: {
              repetitions: card.progress.repetitions,
              easeFactor: card.progress.easeFactor,
              interval: card.progress.interval,
            },
          };
        })
      );
    };

    const quizQuestions = await generateQuizQuestions();

    // Shuffle questions for better experience
    const shuffledQuestions = quizQuestions.sort(() => Math.random() - 0.5);

    // Calculate deck statistics
    const learnedCards = flashcardsWithProgress.filter(
      (card) => card.progress.isLearned
    ).length;
    const dueForReview = flashcardsWithProgress.filter(
      (card) =>
        !card.progress.isLearned || card.progress.nextReview <= new Date()
    ).length;

    res.status(200).json({
      message: "Quiz generated successfully",
      quiz: {
        deckId: deck.id,
        deckName: deck.name,
        totalQuestions: shuffledQuestions.length,
        questions: shuffledQuestions,
        statistics: {
          totalCards: deck.flashcards.length,
          learnedCards,
          dueForReview,
        },
      },
    });
  } catch (error) {
    console.error("Error generating quiz:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const QuizModeByPublic = async (req, res) => {
  try {
    const { id } = req.params; // Deck ID
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Check if deck exists and belongs to user
    const deck = await prisma.deck.findUnique({
      where: { id },
      include: {
        flashcards: true,
      },
    });

    if (!deck) {
      return res.status(404).json({ error: "Deck not found" });
    }

    if (deck.flashcards.length === 0) {
      return res.status(400).json({
        error: "No flashcards found in this deck",
      });
    }

    // Get learning progress for all flashcards
    let progressData = [];
    try {
      progressData = await prisma.progress.findMany({
        where: {
          userId,
          flashcardId: { in: deck.flashcards.map((card) => card.id) },
        },
      });
    } catch (error) {
      console.log("Progress model not found, using default values");
    }

    // Prepare flashcards with progress data
    const flashcardsWithProgress = deck.flashcards.map((card) => {
      const progressRecord = progressData.find(
        (p) => p.flashcardId === card.id
      );
      const progress = progressRecord || {
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReview: new Date(0),
        lastReviewed: null,
        isLearned: false,
      };

      return {
        ...card,
        progress,
      };
    });

    // Generate quiz questions for ALL flashcards
    const generateQuizQuestions = () => {
      return flashcardsWithProgress.map((card) => {
        // Generate multiple choice options for each card
        const generateOptions = () => {
          const correctAnswer = card.answer;
          const otherCards = deck.flashcards.filter(
            (c) =>
              c.id !== card.id &&
              c.answer.toLowerCase().trim() !==
                correctAnswer.toLowerCase().trim()
          );

          let wrongAnswers = [];

          if (otherCards.length >= 3) {
            // Use actual wrong answers from other cards
            wrongAnswers = otherCards
              .sort(() => Math.random() - 0.5)
              .slice(0, 3)
              .map((c) => c.answer);
          } else {
            // Fallback options if not enough unique answers
            wrongAnswers = otherCards.map((c) => c.answer);
            const genericOptions = [
              "None of the above",
              "Not applicable",
              "Cannot be determined",
            ];

            while (wrongAnswers.length < 3) {
              const randomOption =
                genericOptions[wrongAnswers.length] ||
                `Option ${wrongAnswers.length + 1}`;
              if (
                !wrongAnswers.includes(randomOption) &&
                randomOption.toLowerCase().trim() !==
                  correctAnswer.toLowerCase().trim()
              ) {
                wrongAnswers.push(randomOption);
              }
            }
          }

          // Combine and shuffle options
          const allOptions = [correctAnswer, ...wrongAnswers.slice(0, 3)];
          const shuffledOptions = allOptions.sort(() => Math.random() - 0.5);

          return shuffledOptions.map((option, index) => ({
            id: String.fromCharCode(65 + index),
            text: option,
            isCorrect: option === correctAnswer,
          }));
        };

        const options = generateOptions();

        return {
          flashcardId: card.id,
          question: card.question,
          imageUrl: card.imageUrl,
          audioUrl: card.audioUrl,
          options: options.map((opt) => ({
            id: opt.id,
            text: opt.text,
          })),
          correctAnswer: card.answer,
          difficulty: card.difficulty,
          progress: {
            repetitions: card.progress.repetitions,
            easeFactor: card.progress.easeFactor,
            interval: card.progress.interval,
          },
        };
      });
    };

    const quizQuestions = generateQuizQuestions();

    // Shuffle questions for better experience
    const shuffledQuestions = quizQuestions.sort(() => Math.random() - 0.5);

    // Calculate deck statistics
    const learnedCards = flashcardsWithProgress.filter(
      (card) => card.progress.isLearned
    ).length;
    const dueForReview = flashcardsWithProgress.filter(
      (card) =>
        !card.progress.isLearned || card.progress.nextReview <= new Date()
    ).length;

    res.status(200).json({
      message: "Quiz generated successfully",
      quiz: {
        deckId: deck.id,
        deckName: deck.name,
        totalQuestions: shuffledQuestions.length,
        questions: shuffledQuestions,
        statistics: {
          totalCards: deck.flashcards.length,
          learnedCards,
          dueForReview,
        },
      },
    });
  } catch (error) {
    console.error("Error generating quiz:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const submitAnswer = async (req, res) => {
  try {
    const { id } = req.params; // Deck ID
    const { flashcardId, selectedOption, timeSpent } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Validate required fields
    if (!flashcardId || !selectedOption) {
      return res.status(400).json({
        error: "Flashcard ID and selected option are required",
      });
    }

    // Get flashcard with correct answer
    const flashcard = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: {
        deck: true,
      },
    });

    if (!flashcard) {
      return res.status(404).json({ error: "Flashcard not found" });
    }

    if (flashcard.deck.id !== id) {
      return res.status(400).json({
        error: "Flashcard does not belong to this deck",
      });
    }

    // Check if user has access to the deck (either owner or via shared deck)
    const deckAccess = await prisma.deck.findFirst({
      where: {
        id: flashcard.deck.id,
        OR: [
          { userId: userId }, // User is owner
          { sharedDecks: { some: { userId: userId } } }, // Or has shared access
        ],
      },
    });

    // Check if answer is correct
    const isCorrect =
      selectedOption.toLowerCase().trim() ===
      flashcard.answer.toLowerCase().trim();

    // Get or create learning progress
    let progress;
    try {
      progress = await prisma.progress.findFirst({
        where: {
          userId,
          flashcardId,
        },
      });

      if (!progress) {
        progress = await prisma.progress.create({
          data: {
            userId,
            flashcardId,
            easeFactor: 2.5,
            interval: 1,
            repetitions: 0,
            nextReview: new Date(),
            isLearned: false,
            totalReviews: 0,
            correctReviews: 0,
          },
        });
      }
    } catch (error) {
      // If Progress model doesn't exist, create a temporary object
      console.log("Progress model not available, using in-memory tracking");
      progress = {
        easeFactor: 2.5,
        interval: 1,
        repetitions: 0,
        nextReview: new Date(),
        isLearned: false,
        totalReviews: 0,
        correctReviews: 0,
      };
    }

    // Spaced Repetition Algorithm (SM-2 Algorithm)
    const calculateNextReview = (currentProgress, correct, responseTime) => {
      let { easeFactor, interval, repetitions } = currentProgress;

      // Quality factor based on correctness and response time
      let quality;
      if (!correct) {
        quality = 0; // Incorrect answer
      } else {
        // Base quality for correct answer (3-5 scale)
        const baseQuality = 4;

        // Adjust based on response time (if provided)
        if (responseTime) {
          const timeBonus =
            responseTime < 5000 ? 1 : responseTime < 15000 ? 0 : -1;
          quality = Math.max(0, Math.min(5, baseQuality + timeBonus));
        } else {
          quality = baseQuality;
        }
      }

      // Update ease factor
      easeFactor = Math.max(
        1.3,
        easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
      );

      // Update repetitions and interval
      if (!correct) {
        // Incorrect answer - reset
        repetitions = 0;
        interval = 1;
      } else {
        // Correct answer - mark as mastered immediately
        repetitions = 1;
        interval = 1;
      }

      // Calculate next review date
      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + interval);

      // Mark as learned if answer is correct
      const isLearned = correct;

      return {
        easeFactor,
        interval,
        repetitions,
        nextReview,
        isLearned,
        quality,
      };
    };

    const newProgress = calculateNextReview(progress, isCorrect, timeSpent);

    // Update learning progress
    let updatedProgress;
    try {
      if (progress.id) {
        updatedProgress = await prisma.progress.update({
          where: { id: progress.id },
          data: {
            easeFactor: newProgress.easeFactor,
            interval: newProgress.interval,
            repetitions: newProgress.repetitions,
            nextReview: newProgress.nextReview,
            lastReviewed: new Date(),
            isLearned: newProgress.isLearned,
            totalReviews: { increment: 1 },
            correctReviews: isCorrect ? { increment: 1 } : undefined,
          },
        });
      } else {
        // If no database progress tracking, use in-memory values
        updatedProgress = {
          ...progress,
          ...newProgress,
          lastReviewed: new Date(),
          totalReviews: (progress.totalReviews || 0) + 1,
          correctReviews: (progress.correctReviews || 0) + (isCorrect ? 1 : 0),
        };
      }
    } catch (error) {
      console.log("Using in-memory progress tracking");
      updatedProgress = {
        ...progress,
        ...newProgress,
        lastReviewed: new Date(),
        totalReviews: (progress.totalReviews || 0) + 1,
        correctReviews: (progress.correctReviews || 0) + (isCorrect ? 1 : 0),
      };
    }

    // Create history record
    // Create history record
    const historyRecord = await prisma.history.create({
      data: {
        userId: userId,
        flashcardId: flashcardId,
        deckId: id,
        userAnswer: selectedOption,
        isCorrect: isCorrect,
        status: isCorrect ? "MASTERED" : "NEEDS_REVIEW", // Langsung MASTERED jika benar
      },
    });

    // Calculate accuracy
    const accuracy =
      updatedProgress.totalReviews > 0
        ? (updatedProgress.correctReviews / updatedProgress.totalReviews) * 100
        : 0;

    // Prepare response
    const result = {
      correct: isCorrect,
      correctAnswer: flashcard.answer,
      selectedAnswer: selectedOption,
      explanation: isCorrect
        ? "Correct! Well done!"
        : `Incorrect. The correct answer is: ${flashcard.answer}`,
      progress: {
        repetitions: newProgress.repetitions,
        interval: newProgress.interval,
        nextReview: newProgress.nextReview,
        isLearned: newProgress.isLearned,
        accuracy: Math.round(accuracy),
        qualityScore: newProgress.quality,
      },
      nextReviewIn: {
        days: newProgress.interval,
        date: newProgress.nextReview,
      },
      historyId: historyRecord.id, // Include the history record ID in response
    };

    res.status(200).json({
      message: "Answer submitted successfully",
      result,
    });
  } catch (error) {
    console.error("Error submitting answer:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const getUserStats = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        decks: {
          include: {
            flashcards: true,
          },
        },
        progress: true,
        history: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Calculate statistics
    // 1. Number of decks
    const totalDecks = user.decks.length;

    // 2. Total number of flashcards
    const totalFlashcards = user.decks.reduce(
      (sum, deck) => sum + deck.flashcards.length,
      0
    );

    // 3. Calculate daily streak
    const calculateDailyStreak = (history) => {
      if (history.length === 0) return 0;

      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today

      // Group history by day
      const historyByDay = history.reduce((acc, record) => {
        const recordDate = new Date(record.createdAt);
        recordDate.setHours(0, 0, 0, 0); // Normalize to start of day
        const dateKey = recordDate.toISOString().split("T")[0];
        acc[dateKey] = acc[dateKey] || [];
        acc[dateKey].push(record);
        return acc;
      }, {});

      // Check if today has activity
      const todayKey = today.toISOString().split("T")[0];
      if (historyByDay[todayKey]) {
        streak = 1;
      } else {
        // If no activity today, start checking from yesterday
        today.setDate(today.getDate() - 1);
      }

      // Count consecutive days with activity
      while (true) {
        const checkDate = new Date(today);
        checkDate.setDate(checkDate.getDate() - streak);
        const checkDateKey = checkDate.toISOString().split("T")[0];

        if (!historyByDay[checkDateKey]) {
          break; // Break if no activity on this day
        }
        streak++;
      }

      return streak;
    };

    const dailyStreak = calculateDailyStreak(user.history);

    // 4. Calculate average accuracy
    const calculateAverageAccuracy = (progress) => {
      if (progress.length === 0) return 0;

      const totalAccuracy = progress.reduce((sum, record) => {
        if (record.totalReviews === 0) return sum;
        return sum + (record.correctReviews / record.totalReviews) * 100;
      }, 0);

      return Math.round(totalAccuracy / progress.length) || 0;
    };

    const averageAccuracy = calculateAverageAccuracy(user.progress);

    // Prepare response
    const stats = {
      dailyStreak: {
        count: dailyStreak,
        lastActivity: user.history[0]?.createdAt || null,
      },
      decks: {
        total: totalDecks,
        publicDecks: user.decks.filter((deck) => deck.isPublic).length,
        privateDecks: user.decks.filter((deck) => !deck.isPublic).length,
      },
      flashcards: {
        total: totalFlashcards,
        learned: user.progress.filter((p) => p.isLearned).length,
        inProgress: user.progress.filter((p) => !p.isLearned).length,
      },
      accuracy: {
        average: averageAccuracy,
        totalReviews: user.progress.reduce(
          (sum, record) => sum + record.totalReviews,
          0
        ),
        correctReviews: user.progress.reduce(
          (sum, record) => sum + record.correctReviews,
          0
        ),
      },
    };

    res.status(200).json({
      message: "User statistics retrieved successfully",
      stats,
    });
  } catch (error) {
    console.error("Error fetching user statistics:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const getWeeklyProgress = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch user progress data for the last 7 days
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); // End of today
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 6); // Start of 7 days ago
    startDate.setHours(0, 0, 0, 0); // Start of the day

    const progress = await prisma.progress.findMany({
      where: {
        userId,
        lastReviewed: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        lastReviewed: true,
        isLearned: true,
        correctReviews: true,
        totalReviews: true,
      },
    });

    if (!progress) {
      return res.status(404).json({ error: "Progress data not found" });
    }

    // Group progress by day
    const progressByDay = progress.reduce((acc, record) => {
      if (!record.lastReviewed) return acc;
      const recordDate = new Date(record.lastReviewed);
      recordDate.setHours(0, 0, 0, 0); // Normalize to start of day
      const dateKey = recordDate.toISOString().split("T")[0];
      acc[dateKey] = acc[dateKey] || {
        learned: 0,
        correctReviews: 0,
        totalReviews: 0,
      };
      if (record.isLearned) acc[dateKey].learned += 1;
      acc[dateKey].correctReviews += record.correctReviews;
      acc[dateKey].totalReviews += record.totalReviews;
      return acc;
    }, {});

    // Generate weekly progress data
    const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
    const weeklyProgress = [];

    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateKey = currentDate.toISOString().split("T")[0];
      const dayOfWeek = (currentDate.getDay() + 6) % 7; // Adjust: Monday = 0, Sunday = 6

      const dayData = progressByDay[dateKey] || {
        learned: 0,
        correctReviews: 0,
        totalReviews: 0,
      };

      const accuracy = dayData.totalReviews
        ? (dayData.correctReviews / dayData.totalReviews) * 100
        : 0;

      weeklyProgress.push({
        day: days[dayOfWeek],
        cardsLearned: dayData.learned,
        accuracy: Math.round(accuracy) || 0,
      });
    }

    // Sort by day order (Sen, Sel, Rab, Kam, Jum, Sab, Min)
    const sortedProgress = days.map(
      (day) =>
        weeklyProgress.find((item) => item.day === day) || {
          day,
          cardsLearned: 0,
          accuracy: 0,
        }
    );

    res.status(200).json({
      message: "Weekly progress retrieved successfully",
      weeklyProgress: sortedProgress,
    });
  } catch (error) {
    console.error("Error fetching weekly progress:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

const generateAnalytics = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Get all user's progress data with flashcard and deck info
    const progressData = await prisma.progress.findMany({
      where: { userId },
      include: {
        flashcard: {
          include: {
            deck: true,
          },
        },
      },
    });

    if (!progressData || progressData.length === 0) {
      return res.status(404).json({ error: "No progress data found" });
    }

    // Group data by category (deck category)
    const categoryStats = progressData.reduce((acc, progress) => {
      const category = progress.flashcard.deck.category;

      if (!acc[category]) {
        acc[category] = {
          totalReviews: 0,
          correctReviews: 0,
          flashcards: [],
          weakAreas: new Set(),
        };
      }

      acc[category].totalReviews += progress.totalReviews;
      acc[category].correctReviews += progress.correctReviews;
      acc[category].flashcards.push({
        id: progress.flashcard.id,
        tags: progress.flashcard.tags,
        difficulty: progress.flashcard.difficulty,
        performance:
          progress.totalReviews > 0
            ? (progress.correctReviews / progress.totalReviews) * 100
            : 0,
      });

      return acc;
    }, {});

    // Generate analytics for each category
    const analyticsPromises = Object.entries(categoryStats).map(
      async ([category, stats]) => {
        const performance =
          stats.totalReviews > 0
            ? (stats.correctReviews / stats.totalReviews) * 100
            : 0;

        // Identify weak areas (flashcards with performance < 60%)
        const weakAreas = [];
        const recommendations = [];

        stats.flashcards.forEach((flashcard) => {
          if (flashcard.performance < 60 && flashcard.tags.length > 0) {
            flashcard.tags.forEach((tag) => {
              if (!weakAreas.includes(tag)) {
                weakAreas.push(tag);
              }
            });
          }
        });

        // Generate recommendations based on performance
        if (performance < 50) {
          recommendations.push(`Focus more on ${category} fundamentals`);
          recommendations.push(`Increase daily practice for ${category}`);
        } else if (performance < 70) {
          recommendations.push(`Review ${category} concepts regularly`);
        } else if (performance >= 70) {
          recommendations.push(
            `Great progress in ${category}! Try advanced topics`
          );
        }

        // Add specific recommendations for weak areas
        weakAreas.forEach((area) => {
          recommendations.push(`Review ${area} topics in ${category}`);
        });

        // Check if analytics already exists for this category
        const existingAnalytics = await prisma.analytics.findFirst({
          where: {
            userId,
            category,
          },
        });

        if (existingAnalytics) {
          // Update existing analytics
          return prisma.analytics.update({
            where: { id: existingAnalytics.id },
            data: {
              performance: Math.round(performance * 100) / 100,
              weakAreas,
              recommendations,
              updatedAt: new Date(),
            },
          });
        } else {
          // Create new analytics
          return prisma.analytics.create({
            data: {
              userId,
              category,
              performance: Math.round(performance * 100) / 100,
              weakAreas,
              recommendations,
            },
          });
        }
      }
    );

    const analyticsResults = await Promise.all(analyticsPromises);

    res.status(200).json({
      message: "Analytics generated successfully",
      analytics: analyticsResults,
    });
  } catch (error) {
    console.error("Error generating analytics:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

// Get user analytics
const getUserAnalytics = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const analytics = await prisma.analytics.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 4, // Hanya mengambil 2 data terbaru
    });

    res.status(200).json({
      message:
        analytics.length > 0
          ? "Analytics retrieved successfully"
          : "No analytics data found",
      analytics: analytics || [],
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

// Get analytics by category
const getAnalyticsByCategory = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { category } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!category) {
      return res.status(400).json({ error: "Category parameter is required" });
    }

    const analytics = await prisma.analytics.findFirst({
      where: {
        userId,
        category,
      },
    });

    if (!analytics) {
      return res
        .status(404)
        .json({ error: "Analytics not found for this category" });
    }

    res.status(200).json({
      message: "Category analytics retrieved successfully",
      analytics,
    });
  } catch (error) {
    console.error("Error fetching category analytics:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

// Auto-generate analytics (can be called periodically)
const autoGenerateAnalytics = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Check if user has recent activity (last 24 hours)
    const recentActivity = await prisma.history.findFirst({
      where: {
        userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    if (!recentActivity) {
      return res.status(200).json({
        message: "No recent activity found, analytics not updated",
      });
    }

    // Call the generate analytics function
    req.user = { id: userId };
    await generateAnalytics(req, res);
  } catch (error) {
    console.error("Error auto-generating analytics:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

// Additional helper endpoint - Get Learning Statistics
const getStats = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const deck = await prisma.deck.findUnique({
      where: { id },
      include: {
        flashcards: true,
      },
    });

    if (!deck || deck.userId !== userId) {
      return res.status(404).json({ error: "Deck not found" });
    }

    // Get progress data
    let progressData = [];
    try {
      progressData = await prisma.progress.findMany({
        where: {
          userId,
          flashcardId: { in: deck.flashcards.map((card) => card.id) },
        },
      });
    } catch (error) {
      console.log("Progress model not available");
    }

    const now = new Date();
    const stats = {
      totalCards: deck.flashcards.length,
      learnedCards: 0,
      dueForReview: 0,
      newCards: 0,
      averageAccuracy: 0,
      totalReviews: 0,
      streakDays: 0,
      nextReviewTime: null,
    };

    let totalAccuracy = 0;
    let cardsWithProgress = 0;
    let nextReviews = [];

    deck.flashcards.forEach((card) => {
      const progressRecord = progressData.find(
        (p) => p.flashcardId === card.id
      );
      const progress = progressRecord || {
        totalReviews: 0,
        correctReviews: 0,
        isLearned: false,
        nextReview: new Date(0),
      };

      if (!progress) {
        stats.newCards++;
      } else {
        cardsWithProgress++;
        stats.totalReviews += progress.totalReviews;

        if (progress.totalReviews > 0) {
          totalAccuracy +=
            (progress.correctReviews / progress.totalReviews) * 100;
        }

        if (progress.isLearned) {
          stats.learnedCards++;
        }

        if (progress.nextReview <= now) {
          stats.dueForReview++;
        }

        nextReviews.push(progress.nextReview);
      }
    });

    stats.averageAccuracy =
      cardsWithProgress > 0 ? Math.round(totalAccuracy / cardsWithProgress) : 0;

    stats.nextReviewTime =
      nextReviews.length > 0
        ? new Date(Math.min(...nextReviews.map((d) => d.getTime())))
        : null;

    res.status(200).json({
      message: "Learning statistics retrieved successfully",
      stats,
    });
  } catch (error) {
    console.error("Error getting learning stats:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    await prisma.$disconnect();
  }
};

//rencana ga dipake yang dari sini kebawah
const copyFlashcardsToDeck = async (req, res) => {
  try {
    const { targetDeckId } = req.params;
    const { flashcardIds } = req.body; // Ekspektasi: array dari string ID flashcard

    // 1. Validasi input
    if (!targetDeckId) {
      return res
        .status(400)
        .json({ message: "ID Deck tujuan tidak boleh kosong." });
    }
    if (
      !flashcardIds ||
      !Array.isArray(flashcardIds) ||
      flashcardIds.length === 0
    ) {
      return res.status(400).json({
        message: "ID Flashcard harus berupa array dan tidak boleh kosong.",
      });
    }

    // 2. Cek apakah deck tujuan ada
    const targetDeck = await prisma.deck.findUnique({
      where: { id: targetDeckId },
    });

    if (!targetDeck) {
      return res.status(404).json({ message: "Deck tujuan tidak ditemukan!" });
    }

    // 3. Ambil data flashcard asli yang akan disalin
    const originalFlashcards = await prisma.flashcard.findMany({
      where: {
        id: { in: flashcardIds },
      },
    });

    // 4. Pastikan semua flashcard yang diminta ditemukan
    if (originalFlashcards.length !== flashcardIds.length) {
      const foundIds = originalFlashcards.map((fc) => fc.id);
      const notFoundIds = flashcardIds.filter((id) => !foundIds.includes(id));
      return res.status(404).json({
        message: `Beberapa flashcard tidak ditemukan: ${notFoundIds.join(
          ", "
        )}. Tidak ada flashcard yang disalin.`,
      });
    }

    // 5. Siapkan data untuk flashcard baru (salinan)
    const newFlashcardsData = originalFlashcards.map((card) => ({
      question: card.question,
      answer: card.answer,
      imageUrl: card.imageUrl, // Salin path gambar apa adanya
      deckId: targetDeckId, // Kaitkan dengan deck tujuan
      // createdAt dan updatedAt akan di-handle otomatis oleh Prisma
    }));

    // 6. Buat flashcard baru (salinan) di deck tujuan
    // Menggunakan createMany untuk efisiensi jika menyalin banyak flashcard sekaligus
    const result = await prisma.flashcard.createMany({
      data: newFlashcardsData,
    });

    res.status(201).json({
      message: `${result.count} flashcard berhasil disalin ke deck '${targetDeck.name}'.`,
      count: result.count,
    });
  } catch (error) {
    console.error("Error saat menyalin flashcard:", error);
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server saat menyalin flashcard." });
  }
};

const moveFlashcardsToDeck = async (req, res) => {
  try {
    const { flashcardIds, targetDeckId } = req.body;

    // 1. Validasi input dasar
    if (!targetDeckId) {
      return res
        .status(400)
        .json({ message: "ID Deck tujuan tidak boleh kosong." });
    }
    if (
      !flashcardIds ||
      !Array.isArray(flashcardIds) ||
      flashcardIds.length === 0
    ) {
      return res.status(400).json({
        message: "ID Flashcard harus berupa array dan tidak boleh kosong.",
      });
    }

    // 2. Cek apakah deck tujuan ada
    const targetDeck = await prisma.deck.findUnique({
      where: { id: targetDeckId },
    });

    if (!targetDeck) {
      return res.status(404).json({ message: "Deck tujuan tidak ditemukan!" });
    }

    // 3. Verifikasi semua flashcard yang dipilih ada
    const existingFlashcards = await prisma.flashcard.findMany({
      where: {
        id: { in: flashcardIds },
      },
      select: { id: true, deckId: true }, // Ambil ID dan deckId saat ini
    });

    if (existingFlashcards.length !== flashcardIds.length) {
      const foundDbIds = existingFlashcards.map((fc) => fc.id);
      const notFoundRequestIds = flashcardIds.filter(
        (id) => !foundDbIds.includes(id)
      );
      return res.status(404).json({
        message: `Beberapa flashcard tidak ditemukan di database: ${notFoundRequestIds.join(
          ", "
        )}. Tidak ada flashcard yang dipindahkan.`,
      });
    }

    // 4. Identifikasi flashcard yang benar-benar perlu dipindahkan (yang belum ada di deck tujuan)
    const flashcardsToActuallyMoveIds = existingFlashcards
      .filter((fc) => fc.deckId !== targetDeckId) // Hanya pindahkan jika beda deck
      .map((fc) => fc.id);

    let movedCount = 0;
    if (flashcardsToActuallyMoveIds.length > 0) {
      const updateResult = await prisma.flashcard.updateMany({
        where: {
          id: { in: flashcardsToActuallyMoveIds },
        },
        data: {
          deckId: targetDeckId,
          // updatedAt akan di-handle otomatis oleh Prisma jika ada @updatedAt
        },
      });
      movedCount = updateResult.count;
    }

    // 5. Buat pesan respons yang informatif
    let message;
    const totalSelected = flashcardIds.length;
    const alreadyInTargetDeckCount =
      totalSelected - flashcardsToActuallyMoveIds.length;

    if (movedCount > 0) {
      message = `${movedCount} flashcard berhasil dipindahkan ke deck '${targetDeck.name}'.`;
      if (alreadyInTargetDeckCount > 0) {
        message += ` ${alreadyInTargetDeckCount} flashcard lainnya sudah berada di deck tujuan.`;
      }
    } else if (
      alreadyInTargetDeckCount > 0 &&
      totalSelected === alreadyInTargetDeckCount
    ) {
      message = `Semua ${totalSelected} flashcard yang dipilih sudah berada di deck '${targetDeck.name}'. Tidak ada yang dipindahkan.`;
    } else if (totalSelected > 0) {
      // Tidak ada yang dipindahkan dan tidak ada yang sudah di deck tujuan (kemungkinan karena semua ID tidak valid, sudah ditangani di atas)
      message = `Tidak ada flashcard yang memenuhi syarat untuk dipindahkan ke deck '${targetDeck.name}'.`;
    } else {
      // flashcardIds kosong, sudah divalidasi di awal.
      message = "Tidak ada flashcard yang dipilih untuk dipindahkan.";
    }

    res.status(200).json({
      message: message,
      movedCount: movedCount, // Jumlah flashcard yang deckId-nya benar-benar diubah
      alreadyInTargetDeckCount: alreadyInTargetDeckCount,
    });
  } catch (error) {
    console.error("Error saat memindahkan flashcard:", error);
    res.status(500).json({
      message: "Terjadi kesalahan server saat memindahkan flashcard.",
    });
  }
};

require("dotenv").config();
const startQuiz = async (req, res) => {
  try {
    const { deckId } = req.params;

    // Verifikasi deck exists
    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      include: { flashcards: true },
    });

    if (!deck) {
      return res.status(404).json({ message: "Deck tidak ditemukan!" });
    }

    if (deck.flashcards.length === 0) {
      return res
        .status(400)
        .json({ message: "Deck kosong, tambahkan flashcard terlebih dahulu!" });
    }

    // Fungsi untuk menghasilkan distractors dengan Hugging Face
    const generateDistractors = async (question, correctAnswer) => {
      try {
        const prompt = `
          Given the question: "${question}"
          and the correct answer: "${correctAnswer}"
          Generate 3 plausible but incorrect distractors for a multiple-choice quiz.
          Format the output as a list, one distractor per line, without numbers, quotes, brackets, or any symbols like *.
        `;

        const response = await hf.textGeneration({
          model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
          inputs: prompt,
          parameters: {
            max_new_tokens: 100,
            temperature: 0.7,
            return_full_text: false,
          },
        });

        // Parsing teks yang dihasilkan
        let distractors = response.generated_text
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .map((line) => line.replace(/["\[\],*]|\d+\.\s*/g, "")) // Hapus tanda kutip, kurung, koma, bintang, dan prefiks angka
          .filter(
            (line) =>
              line &&
              line !== correctAnswer &&
              !line.includes("Given") &&
              !line.includes("Generate")
          )
          .slice(0, 3);

        // Jika kurang dari 3 distractors, tambahkan fallback
        while (distractors.length < 3) {
          distractors.push(`Varian ${distractors.length + 1}`);
        }

        return distractors;
      } catch (error) {
        console.error("Error generating distractors:", error);
        return ["Option 1", "Option 2", "Option 3"];
      }
    };

    // Format data kuis untuk setiap flashcard
    const quizData = await Promise.all(
      deck.flashcards.map(async (card) => {
        // Generate distractors menggunakan Hugging Face
        const distractors = await generateDistractors(
          card.question,
          card.answer
        );

        // Gabungkan jawaban benar dengan distractors dan acak
        const options = [...distractors, card.answer].sort(
          () => 0.5 - Math.random()
        );

        return {
          flashcardId: card.id,
          question: card.question,
          options: options,
          correctAnswer: card.answer,
          imageUrl: card.imageUrl,
        };
      })
    );

    res.status(200).json({
      message: "Kuis dimulai!",
      deckId: deckId,
      quiz: quizData,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

const answerFlashcard = async (req, res) => {
  // Fungsi untuk menghitung progress deck
  const calculateDeckProgress = async (deckId, userId) => {
    // Hitung total flashcards dalam deck
    const totalFlashcards = await prisma.flashcard.count({
      where: { deckId },
    });

    // Hitung flashcards yang sudah dikuasai (MASTERED) oleh user
    const masteredFlashcards = await prisma.progress.count({
      where: {
        userId,
        flashcard: { deckId },
        status: "MASTERED",
      },
    });

    // Hitung persentase kemajuan
    const percentage =
      totalFlashcards > 0
        ? Math.round((masteredFlashcards / totalFlashcards) * 100)
        : 0;

    return {
      total: totalFlashcards,
      mastered: masteredFlashcards,
      percentage,
    };
  };

  try {
    const { flashcardId } = req.params;
    const { userAnswer } = req.body;

    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }

    const userId = req.user.userId;

    // Validate input
    if (!flashcardId || !userAnswer) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Find the flashcard
    const flashcard = await prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: true },
    });

    if (!flashcard) {
      return res.status(404).json({ message: "Flashcard tidak ditemukan!" });
    }

    // Determine answer correctness
    const isCorrect =
      userAnswer.trim().toLowerCase() === flashcard.answer.trim().toLowerCase();
    const status = isCorrect ? "MASTERED" : "NEEDS_REVIEW";

    // Find existing progress record
    const existingProgress = await prisma.progress.findFirst({
      where: {
        userId,
        flashcardId,
      },
    });

    let progress;
    if (existingProgress) {
      progress = await prisma.progress.update({
        where: { id: existingProgress.id },
        data: { status, updatedAt: new Date() },
      });
    } else {
      progress = await prisma.progress.create({
        data: {
          userId,
          flashcardId,
          status,
        },
      });
    }

    // Create history record
    await prisma.history.create({
      data: {
        userId,
        flashcardId,
        deckId: flashcard.deckId,
        userAnswer,
        isCorrect,
        status,
      },
    });

    // Calculate progress
    const deckProgress = await calculateDeckProgress(flashcard.deckId, userId);

    res.status(200).json({
      message: isCorrect ? "Jawaban benar!" : "Jawaban salah.",
      isCorrect,
      correctAnswer: flashcard.answer,
      progress: {
        currentCardStatus: status,
        deckCompletionPercentage: deckProgress.percentage,
        totalFlashcards: deckProgress.total,
        mastered: deckProgress.mastered,
      },
    });
  } catch (error) {
    console.error("Error processing flashcard answer:", error);
    res.status(500).json({
      message: "Terjadi kesalahan server",
      error: error.message,
    });
  }
};

// Endpoint untuk mendapatkan riwayat belajar user
const getLearningHistory = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }

    const userId = req.user.userId;
    const { deckId, limit } = req.query;

    const history = await prisma.history.findMany({
      where: {
        userId,
        ...(deckId && { deckId }), // Filter by deckId jika ada
      },
      include: {
        flashcard: true,
        deck: {
          select: {
            name: true,
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit ? parseInt(limit) : undefined, // Limit hasil jika ada
    });

    res.status(200).json({
      history: history.map((record) => ({
        id: record.id,
        question: record.flashcard.question,
        userAnswer: record.userAnswer,
        correctAnswer: record.flashcard.answer,
        isCorrect: record.isCorrect,
        status: record.status,
        deckName: record.deck.name,
        deckCategory: record.deck.category,
        createdAt: record.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching learning history:", error);
    res.status(500).json({
      message: "Terjadi kesalahan server",
      error: error.message,
    });
  }
};

const getLearningStats = async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }

    const userId = req.user.userId;

    // Total flashcards attempted
    const totalAttempts = await prisma.history.count({
      where: { userId },
    });

    // Correct answers
    const correctAnswers = await prisma.history.count({
      where: { userId, isCorrect: true },
    });

    // Accuracy percentage
    const accuracy =
      totalAttempts > 0
        ? Math.round((correctAnswers / totalAttempts) * 100)
        : 0;

    // Recently studied decks
    const recentDecks = await prisma.history.findMany({
      where: { userId },
      distinct: ["deckId"],
      include: {
        deck: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    });

    res.status(200).json({
      stats: {
        totalAttempts,
        correctAnswers,
        accuracy,
        recentDecks: recentDecks.map((deck) => ({
          id: deck.deck.id,
          name: deck.deck.name,
          category: deck.deck.category,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching learning stats:", error);
    res.status(500).json({
      message: "Terjadi kesalahan server",
      error: error.message,
    });
  }
};

// Tambahkan route di router

module.exports = {
  getFlashcardsByDeck,
  createFlashcard,
  createAutoFlashcards,
  updateFlashcard,
  deleteFlashcard,
  QuizMode,
  QuizModeByPublic,
  submitAnswer,
  getUserStats,
  getWeeklyProgress,
  generateAnalytics,
  getUserAnalytics,
  getAnalyticsByCategory,
  autoGenerateAnalytics,
  getStats,
  copyFlashcardsToDeck,
  moveFlashcardsToDeck,
  startQuiz,
  answerFlashcard,
  getLearningHistory,
  getLearningStats,
};
