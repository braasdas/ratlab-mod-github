/**
 * Token Type - Typing Engine Module
 *
 * Core typing test logic: word generation, input processing, timing,
 * statistics tracking, and result computation.
 *
 * Depends on: window.TokenType.Tokenizer
 *
 * Usage:
 *   <script src="js/tokenizer.js"></script>
 *   <script src="js/typing-engine.js"></script>
 *
 *   const words = TokenType.TypingEngine.init({ duration: 30, mode: "words" });
 *   TokenType.TypingEngine.handleInput("t");
 */

window.TokenType = window.TokenType || {};

window.TokenType.TypingEngine = (function () {
  "use strict";

  var Tokenizer = null; // resolved lazily so load order doesn't matter

  function getTokenizer() {
    if (!Tokenizer) {
      Tokenizer = window.TokenType && window.TokenType.Tokenizer;
    }
    return Tokenizer;
  }

  // =========================================================================
  // Word Lists
  // =========================================================================

  var WORD_LIST = [
    // Common / easy words
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "I",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "her", "she", "or",
    "an", "will", "my", "one", "all", "would", "there", "their", "what", "so",
    "up", "out", "if", "about", "who", "get", "which", "go", "me", "when",
    "make", "can", "like", "time", "no", "just", "him", "know", "take", "people",
    "into", "year", "your", "good", "some", "could", "them", "see", "other", "than",
    "then", "now", "look", "only", "come", "its", "over", "think", "also", "back",
    "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
    "new", "want", "because", "any", "these", "give", "day", "most", "us",

    // Medium difficulty
    "great", "long", "right", "still", "world", "much", "need", "should", "life", "find",
    "here", "thing", "many", "start", "hand", "high", "place", "small", "never", "might",
    "old", "under", "again", "move", "every", "night", "point", "each", "nothing", "home",
    "order", "try", "ask", "away", "turn", "end", "must", "big", "help", "line",
    "mean", "own", "keep", "through", "last", "real", "left", "same", "another", "run",
    "feel", "change", "play", "house", "open", "between", "close", "city", "while", "light",
    "learn", "part", "next", "head", "against", "hard", "story", "name", "kind", "thought",
    "school", "different", "seem", "begin", "often", "walk", "example", "ease", "paper", "group",
    "always", "music", "those", "both", "mark", "book", "letter", "until", "mile", "river",
    "car", "feet", "care", "second", "enough", "plain", "girl", "usual", "young", "ready",

    // Slightly harder / longer words
    "important", "children", "side", "been", "number", "call", "really", "almost", "water", "since",
    "long", "very", "after", "word", "little", "where", "state", "before", "right", "too",
    "answer", "form", "three", "small", "set", "put", "large", "spell", "add", "land",
    "such", "follow", "act", "why", "men", "read", "need", "move", "live", "believe",
    "happen", "early", "hold", "write", "stand", "near", "late", "run", "real", "leave",
    "eye", "build", "miss", "eat", "face", "watch", "found", "study", "hear", "stop",
    "area", "several", "problem", "product", "system", "program", "question", "during", "company", "country",
    "develop", "market", "power", "return", "money", "service", "amount", "public", "continue", "possible",
    "bring", "reason", "provide", "however", "already", "rather", "without", "together", "control", "record",
    "window", "morning", "above", "ever", "short", "story", "human", "inside", "along", "appear"
  ];

  var QUOTES = [
    { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
    { text: "Any sufficiently advanced technology is indistinguishable from magic.", author: "Arthur C. Clarke" },
    { text: "To err is human, but to really foul things up you need a computer.", author: "Paul R. Ehrlich" },
    { text: "Artificial intelligence is no match for natural stupidity.", author: "Unknown" },
    { text: "I think there is a world market for maybe five computers.", author: "Thomas Watson" },
    { text: "The computer was born to solve problems that did not exist before.", author: "Bill Gates" },
    { text: "Computers are incredibly fast, accurate, and stupid. Human beings are incredibly slow, inaccurate, and brilliant. Together they are powerful beyond imagination.", author: "Albert Einstein" },
    { text: "The question of whether a computer can think is no more interesting than the question of whether a submarine can swim.", author: "Edsger W. Dijkstra" },
    { text: "In a world where you can be anything, be kind. Unless you can be a robot. Then be a kind robot.", author: "Unknown" },
    { text: "The real danger is not that computers will begin to think like men, but that men will begin to think like computers.", author: "Sydney J. Harris" },
    { text: "Software is like entropy. It is difficult to grasp, weighs nothing, and obeys the second law of thermodynamics; i.e., it always increases.", author: "Norman Augustine" },
    { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
    { text: "Measuring programming progress by lines of code is like measuring aircraft building progress by weight.", author: "Bill Gates" },
    { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds" },
    { text: "Programming today is a race between software engineers striving to build bigger and better idiot-proof programs, and the universe trying to produce bigger and better idiots. So far, the universe is winning.", author: "Rick Cook" },
    { text: "It is not enough to do your best; you must know what to do, and then do your best.", author: "W. Edwards Deming" },
    { text: "Typing is the new handwriting. And like handwriting, it reveals character.", author: "Unknown" },
    { text: "The keyboard is mightier than the sword, and considerably faster than the pen.", author: "Unknown" },
    { text: "Machine intelligence is the last invention that humanity will ever need to make.", author: "Nick Bostrom" },
    { text: "Beware of bugs in the above code; I have only proved it correct, not tried it.", author: "Donald Knuth" },
    { text: "The most disastrous thing that you can ever learn is your first programming language.", author: "Alan Kay" },
    { text: "We are stuck with technology when what we really want is just stuff that works.", author: "Douglas Adams" },
    { text: "People who are really serious about software should make their own hardware.", author: "Alan Kay" },
    { text: "The best error message is the one that never shows up.", author: "Thomas Fuchs" }
  ];

  // =========================================================================
  // State
  // =========================================================================

  var state = createFreshState();

  function createFreshState() {
    return {
      isRunning: false,
      isFinished: false,
      startTime: null,
      endTime: null,
      duration: 30,
      timeRemaining: 30,
      currentWordIndex: 0,
      currentCharIndex: 0,
      words: [],
      typedHistory: [],
      currentInput: "",
      correctChars: 0,
      incorrectChars: 0,
      extraChars: 0,
      missedChars: 0,
      totalKeystrokes: 0,
      wpmHistory: [],
      timerInterval: null,

      // Callbacks
      onUpdate: null,
      onFinish: null,
      onTick: null,

      // Config
      mode: "words",
      wordCount: 50
    };
  }

  // =========================================================================
  // Word / Quote Generation
  // =========================================================================

  /**
   * Generate an array of random words from the built-in word list.
   *
   * @param  {number} count  Number of words to generate.
   * @return {string[]}      Array of random words.
   */
  function generateWords(count) {
    var words = [];
    var len = WORD_LIST.length;
    var lastWord = "";

    for (var i = 0; i < count; i++) {
      var word;
      // Avoid consecutive duplicates
      do {
        word = WORD_LIST[Math.floor(Math.random() * len)];
      } while (word === lastWord && len > 1);

      words.push(word);
      lastWord = word;
    }

    return words;
  }

  /**
   * Return a random quote object from the quotes list.
   *
   * @return {{ text: string, author: string }}
   */
  function generateQuote() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }

  /**
   * Generate test text based on the current mode.
   *
   * @param  {string} mode       "words" or "quotes"
   * @param  {number} wordCount  How many words to generate (words mode only).
   * @return {string[]}          Array of words for the test.
   */
  function getTestText(mode, wordCount) {
    if (mode === "quotes") {
      var quote = generateQuote();
      var fullText = quote.text + " - " + quote.author;
      return fullText.split(/\s+/);
    }
    return generateWords(wordCount || 50);
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  /**
   * Initialize or reset the typing engine with the given options.
   *
   * @param  {Object}   options
   * @param  {number}   [options.duration=30]    Test duration in seconds.
   * @param  {string}   [options.mode="words"]   "words" or "quotes".
   * @param  {number}   [options.wordCount=50]   Number of words (words mode).
   * @param  {Function} [options.onUpdate]       Called on each keystroke with stats.
   * @param  {Function} [options.onFinish]       Called when test finishes.
   * @param  {Function} [options.onTick]         Called every second during timer.
   * @return {string[]}                          The generated words array.
   */
  function init(options) {
    options = options || {};

    // Clean up any existing timer
    stopTimer();

    // Reset state
    state = createFreshState();
    state.duration = options.duration || 30;
    state.timeRemaining = state.duration;
    state.mode = options.mode || "words";
    state.wordCount = options.wordCount || 50;
    state.onUpdate = options.onUpdate || null;
    state.onFinish = options.onFinish || null;
    state.onTick = options.onTick || null;

    // Generate words - for timed tests, generate plenty of words
    var targetWordCount = state.wordCount;
    if (state.mode === "words") {
      // Estimate: average typing ~80 WPM * duration in minutes * 1.5 buffer
      var estimatedWords = Math.ceil((80 * state.duration / 60) * 1.5);
      targetWordCount = Math.max(targetWordCount, estimatedWords);
    }

    state.words = getTestText(state.mode, targetWordCount);

    return state.words;
  }

  // =========================================================================
  // Input Handling
  // =========================================================================

  /**
   * Process the current input value from the typing field.
   *
   * Called on every keystroke. Handles character comparison, word completion
   * (on space), and test start/finish logic.
   *
   * @param  {string}  inputValue  The full current value of the input field.
   * @return {Object}              Current state snapshot for rendering.
   */
  function handleInput(inputValue) {
    if (state.isFinished) {
      return getStateSnapshot();
    }

    // Start the timer on the very first keystroke
    if (!state.isRunning && inputValue.length > 0) {
      state.isRunning = true;
      state.startTime = Date.now();
      startTimer();
    }

    state.totalKeystrokes++;

    var currentWord = state.words[state.currentWordIndex];
    if (!currentWord) {
      finishTest();
      return getStateSnapshot();
    }

    // Check if the user pressed space (word submission)
    if (inputValue.endsWith(" ")) {
      var typedWord = inputValue.slice(0, -1); // remove trailing space
      submitWord(typedWord, currentWord);
      state.currentInput = "";

      // Check if the user has finished all words
      if (state.currentWordIndex >= state.words.length) {
        // Generate more words for timed tests
        if (state.mode === "words" && state.isRunning && !state.isFinished) {
          var moreWords = generateWords(30);
          for (var i = 0; i < moreWords.length; i++) {
            state.words.push(moreWords[i]);
          }
        } else {
          finishTest();
        }
      }

      var snapshot = getStateSnapshot();
      snapshot.wordCompleted = true;
      if (state.onUpdate) state.onUpdate(snapshot);
      return snapshot;
    }

    // Update current input (character-level tracking for live highlighting)
    state.currentInput = inputValue;
    state.currentCharIndex = inputValue.length;

    var snapshot = getStateSnapshot();
    snapshot.wordCompleted = false;
    if (state.onUpdate) state.onUpdate(snapshot);
    return snapshot;
  }

  /**
   * Submit a completed word and record its accuracy.
   *
   * @param {string} typed   What the user typed.
   * @param {string} actual  The correct word.
   */
  function submitWord(typed, actual) {
    var isCorrect = typed === actual;
    var charCorrect = 0;
    var charIncorrect = 0;
    var charExtra = 0;
    var charMissed = 0;

    var maxLen = Math.max(typed.length, actual.length);

    for (var i = 0; i < maxLen; i++) {
      if (i < typed.length && i < actual.length) {
        if (typed[i] === actual[i]) {
          charCorrect++;
        } else {
          charIncorrect++;
        }
      } else if (i >= actual.length) {
        // Extra characters typed beyond word length
        charExtra++;
      } else {
        // Characters in the word the user didn't type
        charMissed++;
      }
    }

    // Include the space after the word as a correct character (for WPM calc)
    charCorrect++;

    state.correctChars += charCorrect;
    state.incorrectChars += charIncorrect;
    state.extraChars += charExtra;
    state.missedChars += charMissed;

    state.typedHistory.push({
      word: actual,
      typed: typed,
      correct: isCorrect
    });

    state.currentWordIndex++;
    state.currentCharIndex = 0;
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  /**
   * Calculate current typing statistics.
   *
   * @return {Object} Stats object.
   */
  function getCurrentStats() {
    var elapsed = getElapsedSeconds();
    var elapsedMinutes = elapsed / 60;

    // Prevent division by zero
    if (elapsedMinutes <= 0) {
      return {
        wpm: 0,
        rawWpm: 0,
        accuracy: 100,
        correctChars: 0,
        incorrectChars: 0,
        extraChars: 0,
        missedChars: 0,
        tokensPerSecond: 0,
        totalTokens: 0,
        elapsedTime: 0,
        timeRemaining: state.timeRemaining,
        consistency: 100
      };
    }

    // WPM = (correct characters / 5) / elapsed minutes
    // The "5" is the standard word length used in WPM calculations
    var wpm = Math.round((state.correctChars / 5) / elapsedMinutes);

    // Raw WPM = all characters typed / 5 / elapsed minutes
    var totalTypedChars = state.correctChars + state.incorrectChars + state.extraChars;
    var rawWpm = Math.round((totalTypedChars / 5) / elapsedMinutes);

    // Accuracy
    var totalAttempted = state.correctChars + state.incorrectChars + state.extraChars + state.missedChars;
    var accuracy = totalAttempted > 0
      ? Math.round((state.correctChars / totalAttempted) * 1000) / 10
      : 100;

    // Tokens per second using the Tokenizer
    var tok = getTokenizer();
    var tokensPerSecond = 0;
    var totalTokens = 0;

    if (tok) {
      // Reconstruct typed text from history for token counting
      var typedText = buildTypedText();
      totalTokens = tok.approximateTokenCount(typedText);
      tokensPerSecond = elapsed > 0
        ? Math.round((totalTokens / elapsed) * 100) / 100
        : 0;
    }

    // Consistency: inverse of coefficient of variation of WPM samples
    var consistency = calculateConsistency();

    return {
      wpm: Math.max(0, wpm),
      rawWpm: Math.max(0, rawWpm),
      accuracy: Math.min(100, accuracy),
      correctChars: state.correctChars,
      incorrectChars: state.incorrectChars,
      extraChars: state.extraChars,
      missedChars: state.missedChars,
      tokensPerSecond: tokensPerSecond,
      totalTokens: totalTokens,
      elapsedTime: Math.round(elapsed * 10) / 10,
      timeRemaining: state.timeRemaining,
      consistency: consistency
    };
  }

  /**
   * Get final results after the test is complete.
   *
   * @return {Object} Full results including stats and wpmHistory.
   */
  function getResults() {
    var stats = getCurrentStats();
    return {
      wpm: stats.wpm,
      rawWpm: stats.rawWpm,
      accuracy: stats.accuracy,
      correctChars: stats.correctChars,
      incorrectChars: stats.incorrectChars,
      extraChars: stats.extraChars,
      missedChars: stats.missedChars,
      tokensPerSecond: stats.tokensPerSecond,
      totalTokens: stats.totalTokens,
      elapsedTime: stats.elapsedTime,
      consistency: stats.consistency,
      wpmHistory: state.wpmHistory.slice(),
      typedHistory: state.typedHistory.slice(),
      wordsTyped: state.typedHistory.length,
      duration: state.duration,
      mode: state.mode
    };
  }

  /**
   * Build the full typed text string from history (for token counting).
   */
  function buildTypedText() {
    var parts = [];
    for (var i = 0; i < state.typedHistory.length; i++) {
      parts.push(state.typedHistory[i].typed);
    }
    // Add current partially-typed word
    if (state.currentInput) {
      parts.push(state.currentInput);
    }
    return parts.join(" ");
  }

  /**
   * Calculate typing consistency as a percentage.
   * 100% = perfectly consistent WPM, lower = more variable.
   */
  function calculateConsistency() {
    var history = state.wpmHistory;
    if (history.length < 2) return 100;

    // Use the raw WPM values from the history
    var values = [];
    for (var i = 0; i < history.length; i++) {
      if (history[i].wpm > 0) {
        values.push(history[i].wpm);
      }
    }

    if (values.length < 2) return 100;

    // Calculate mean
    var sum = 0;
    for (var j = 0; j < values.length; j++) {
      sum += values[j];
    }
    var mean = sum / values.length;

    if (mean === 0) return 100;

    // Calculate standard deviation
    var sqDiffSum = 0;
    for (var k = 0; k < values.length; k++) {
      var diff = values[k] - mean;
      sqDiffSum += diff * diff;
    }
    var stdDev = Math.sqrt(sqDiffSum / values.length);

    // Coefficient of variation (CV) -- lower is more consistent
    var cv = stdDev / mean;

    // Convert to a percentage where 100% = perfect consistency
    // cv of 0 = 100%, cv of 1 = 0%
    var consistency = Math.max(0, Math.round((1 - cv) * 100));
    return Math.min(100, consistency);
  }

  // =========================================================================
  // Timer
  // =========================================================================

  /**
   * Start the countdown timer. Records a WPM sample every second.
   */
  function startTimer() {
    if (state.timerInterval) return;

    state.timerInterval = setInterval(function () {
      if (!state.isRunning || state.isFinished) {
        stopTimer();
        return;
      }

      var elapsed = getElapsedSeconds();
      state.timeRemaining = Math.max(0, state.duration - Math.floor(elapsed));

      // Record WPM snapshot for the chart
      var elapsedMinutes = elapsed / 60;
      if (elapsedMinutes > 0) {
        var wpm = Math.round((state.correctChars / 5) / elapsedMinutes);
        var totalChars = state.correctChars + state.incorrectChars + state.extraChars;
        var rawWpm = Math.round((totalChars / 5) / elapsedMinutes);

        state.wpmHistory.push({
          time: Math.round(elapsed),
          wpm: Math.max(0, wpm),
          raw: Math.max(0, rawWpm)
        });
      }

      // Notify the app of the tick
      if (state.onTick) {
        state.onTick({
          timeRemaining: state.timeRemaining,
          elapsed: Math.round(elapsed)
        });
      }

      // Check if time is up
      if (state.timeRemaining <= 0) {
        finishTest();
      }
    }, 1000);
  }

  /**
   * Stop and clean up the timer interval.
   */
  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  /**
   * Get elapsed seconds since the test started.
   */
  function getElapsedSeconds() {
    if (!state.startTime) return 0;
    var endPoint = state.endTime || Date.now();
    return (endPoint - state.startTime) / 1000;
  }

  // =========================================================================
  // Test Lifecycle
  // =========================================================================

  /**
   * End the test and compute final stats.
   */
  function finishTest() {
    if (state.isFinished) return;

    state.isFinished = true;
    state.isRunning = false;
    state.endTime = Date.now();
    state.timeRemaining = 0;
    stopTimer();

    // Handle any partially typed word -- count missed chars
    if (state.currentInput.length > 0 && state.currentWordIndex < state.words.length) {
      var currentWord = state.words[state.currentWordIndex];
      var typed = state.currentInput;

      // Score partial word
      for (var i = 0; i < currentWord.length; i++) {
        if (i < typed.length) {
          if (typed[i] === currentWord[i]) {
            state.correctChars++;
          } else {
            state.incorrectChars++;
          }
        } else {
          state.missedChars++;
        }
      }

      // Extra chars beyond the word
      if (typed.length > currentWord.length) {
        state.extraChars += typed.length - currentWord.length;
      }

      state.typedHistory.push({
        word: currentWord,
        typed: typed,
        correct: typed === currentWord
      });
    }

    if (state.onFinish) {
      state.onFinish(getResults());
    }
  }

  /**
   * Fully reset the engine to initial state.
   */
  function reset() {
    stopTimer();
    state = createFreshState();
  }

  // =========================================================================
  // State Snapshot
  // =========================================================================

  /**
   * Get a snapshot of the current state for rendering purposes.
   */
  function getStateSnapshot() {
    return {
      isRunning: state.isRunning,
      isFinished: state.isFinished,
      currentWordIndex: state.currentWordIndex,
      currentCharIndex: state.currentCharIndex,
      currentInput: state.currentInput,
      words: state.words,
      timeRemaining: state.timeRemaining,
      typedHistory: state.typedHistory,
      stats: getCurrentStats()
    };
  }

  // =========================================================================
  // Public API
  // =========================================================================

  return {
    // Word generation
    generateWords: generateWords,
    generateQuote: generateQuote,
    getTestText: getTestText,

    // Lifecycle
    init: init,
    reset: reset,
    handleInput: handleInput,
    startTimer: startTimer,
    stopTimer: stopTimer,

    // Stats & Results
    getCurrentStats: getCurrentStats,
    getResults: getResults,

    // State access (read-only helpers)
    getState: function () {
      return getStateSnapshot();
    },
    isRunning: function () {
      return state.isRunning;
    },
    isFinished: function () {
      return state.isFinished;
    },

    // Allow forced finish (e.g. Escape key)
    forceFinish: function () {
      finishTest();
    }
  };
})();
