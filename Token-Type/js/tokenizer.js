/**
 * TokenType Tokenizer Module
 *
 * A standalone, dependency-free approximation of BPE tokenization (modeled
 * after cl100k_base / Claude-style tokenizers) for use in a browser-based
 * typing-test game.
 *
 * The goal is NOT cryptographic accuracy -- it is to be close enough to
 * real LLM token counts that the numbers feel meaningful and educational.
 *
 * Design principles:
 *   1. Zero external dependencies -- runs in any modern browser.
 *   2. Fast enough for keystroke-level updates (< 1 ms for typical passages).
 *   3. Deterministic: same input always produces the same output.
 *
 * Usage:
 *   <script src="js/tokenizer.js"></script>
 *   const count = TokenType.Tokenizer.countTokens("Hello, world!");
 */

(function () {
  "use strict";

  window.TokenType = window.TokenType || {};

  // -----------------------------------------------------------------------
  // 1.  COMMON-WORD DICTIONARY
  //     Words that virtually every BPE tokenizer keeps as a single token.
  //     Organised loosely by frequency / part-of-speech for readability.
  // -----------------------------------------------------------------------

  var COMMON_WORDS = new Set([
    // Articles & determiners
    "a", "an", "the", "this", "that", "these", "those",
    "my", "your", "his", "her", "its", "our", "their",
    "some", "any", "no", "every", "each", "all", "both",
    "few", "many", "much", "more", "most", "other", "another",
    "such", "what", "which", "who", "whom", "whose",

    // Pronouns
    "i", "me", "we", "us", "you", "he", "him", "she",
    "it", "they", "them", "myself", "itself",

    // Prepositions & conjunctions
    "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "up", "about", "into", "over", "after",
    "and", "but", "or", "nor", "so", "yet", "if",
    "then", "than", "when", "while", "as", "because",
    "before", "between", "through", "during", "without",
    "against", "along", "among", "around", "under",
    "until", "upon", "within", "out", "off", "down",

    // Common verbs (base + inflections that real tokenizers keep whole)
    "is", "am", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "having",
    "do", "does", "did", "doing", "done",
    "will", "would", "could", "should", "shall", "may", "might",
    "must", "can", "need",
    "say", "said", "says",
    "get", "got", "gets",
    "make", "made", "makes",
    "go", "went", "gone", "goes", "going",
    "take", "took", "taken", "takes",
    "come", "came", "comes", "coming",
    "see", "saw", "seen", "sees",
    "know", "knew", "known", "knows",
    "give", "gave", "gives", "given",
    "find", "found", "finds",
    "think", "thought", "thinks",
    "tell", "told", "tells",
    "put", "set", "run", "ran",
    "let", "keep", "kept",
    "begin", "began", "begun",
    "show", "shows", "shown", "showed",
    "try", "tried", "tries",
    "ask", "asked", "asks",
    "use", "used", "uses",
    "work", "works", "worked",
    "call", "called", "calls",
    "want", "wanted", "wants",
    "look", "looked", "looks",
    "seem", "seemed", "seems",
    "help", "helped", "helps",
    "turn", "turned", "turns",
    "start", "started",
    "move", "moved",
    "live", "lived",
    "play", "played",
    "like", "liked",
    "read",

    // Common adjectives / adverbs
    "not", "very", "also", "just", "only", "well",
    "still", "even", "back", "now", "here", "there",
    "how", "where", "why", "when", "again", "once",
    "never", "always", "often", "soon", "already",
    "too", "quite", "really", "rather", "almost",
    "good", "new", "first", "last", "long", "great",
    "little", "own", "old", "right", "big", "high",
    "small", "large", "next", "early", "young",
    "important", "public", "bad", "same", "able",

    // Common nouns
    "time", "year", "people", "way", "day", "man",
    "woman", "child", "world", "life", "hand", "part",
    "place", "case", "week", "company", "system",
    "program", "question", "work", "number", "night",
    "point", "home", "water", "room", "mother",
    "area", "money", "story", "fact", "month",
    "lot", "thing", "name", "head", "line",
    "end", "city", "state", "word", "family",

    // Common longer words that real tokenizers keep as a single token.
    // These are among the most frequent 9+ char words in English and
    // appear as single tokens in cl100k_base.
    "something", "everything", "nothing", "anything",
    "sometimes", "everyone", "someone", "anyone",
    "different", "important", "between", "another",
    "because", "through", "however", "before",
    "understand", "understanding", "information",
    "experience", "government", "development",
    "education", "community", "business", "possible",
    "national", "political", "according", "available",
    "particular", "actually", "following", "including",
    "continue", "continued", "consider", "considered",
    "communication", "especially", "situation",
    "president", "technology", "together", "certainly",
    "remember", "performance", "beautiful", "wonderful",
    "generally", "certainly", "probably", "obviously",
    "seriously", "currently", "actually", "basically",
    "recently", "suddenly", "directly", "absolutely",
    "personal", "position", "practice", "provide",
    "provided", "question", "research", "service",
    "specific", "standard", "training", "various",

    // Programming-relevant (commonly single tokens)
    "code", "data", "file", "type", "true", "false",
    "null", "void", "int", "string", "class", "function",
    "return", "if", "else", "for", "while", "var",
    "let", "const", "new", "try", "catch", "throw",
    "import", "export", "from", "default", "async",
    "await", "yield", "break", "continue", "switch",
    "case", "map", "list", "array", "object", "key",
    "value", "index", "error", "test", "log", "print",
    "def", "self", "none", "lambda", "struct", "enum"
  ]);

  // -----------------------------------------------------------------------
  // 2.  COMMON SUBWORD UNITS
  //     Frequent BPE merges that real tokenizers learn.  We use these when
  //     splitting longer / uncommon words.
  // -----------------------------------------------------------------------

  // Suffixes -- ordered longest-first so we greedily match the longest one.
  // Compound suffixes (e.g. "ously", "ously", "ation") come first so they
  // are consumed as a single token rather than split awkwardly.
  var SUFFIXES = [
    // 5+ char compound suffixes
    "ation", "ition", "ously", "ously", "ively",
    "ement", "iness", "ional", "ially", "ously",
    "ately", "ently", "antly",
    // 4 char suffixes
    "tion", "sion", "ment", "ness", "able", "ible",
    "ious", "eous",
    "ful", "less",
    "ive", "ative",
    "ing", "ling",
    "ght",
    "ent", "ant",
    "ence", "ance",
    "ity", "ety",
    "ism", "ist",
    "ure", "ture",
    "age", "ade",
    "ally", "ily",
    "ize", "ise",
    "ify",
    "ward",
    "wise",
    "ship",
    "dom",
    "ous",
    "ly", "er", "or",
    "ed", "es", "en",
    "al", "ial",
    "ar", "ary",
    "ic", "ical"
  ];

  // Prefixes -- same greedy-longest strategy.
  var PREFIXES = [
    "inter", "trans", "super", "under",
    "over", "out", "mis", "dis",
    "pre", "pro", "anti", "auto",
    "semi", "sub", "non",
    "un", "re", "in", "im",
    "ir", "il", "en", "em",
    "ex", "co"
  ];

  // -----------------------------------------------------------------------
  // 3.  HELPER UTILITIES
  // -----------------------------------------------------------------------

  /**
   * Pre-tokenize text into coarse segments the way real BPE tokenizers do:
   * split on whitespace boundaries, punctuation, and digit/letter transitions.
   *
   * Each segment includes leading whitespace (BPE convention: the space is
   * part of the following token, not the preceding one).
   *
   * Returns an array of raw string chunks.
   */
  function preTokenize(text) {
    if (!text) return [];

    // This regex mirrors the GPT-style pre-tokenization pattern:
    //   - Optional leading whitespace attached to the next word/number/symbol
    //   - Words (letters + apostrophes for contractions)
    //   - Numbers (digit sequences)
    //   - Individual non-whitespace symbols (punctuation, etc.)
    //   - Runs of whitespace that don't precede anything (trailing)
    var pattern = /\s?[A-Za-z]['A-Za-z]*|\s?\d+|\s?[^\s\w]|\s+/g;
    var matches = text.match(pattern);
    return matches || [];
  }

  // estimateChunkTokens is no longer used -- countTokens now delegates
  // to splitChunkIntoTokens (via tokenize) for consistency.  Keeping the
  // comment here as a breadcrumb for anyone reading the history.

  // -----------------------------------------------------------------------
  // 4.  TOKENIZE  --  produce an array of approximate token strings
  // -----------------------------------------------------------------------

  /**
   * Split a single pre-tokenized chunk into approximate BPE token strings.
   *
   * The split follows the same logic as `estimateChunkTokens` but actually
   * produces the substrings.
   */
  function splitChunkIntoTokens(chunk) {
    var leadingSpace = "";
    var stripped = chunk;

    // Preserve the leading space -- attach it to the first sub-token.
    var spaceMatch = chunk.match(/^(\s+)/);
    if (spaceMatch) {
      leadingSpace = spaceMatch[1];
      stripped = chunk.slice(leadingSpace.length);
    }

    if (stripped.length === 0) {
      // Pure whitespace chunk (e.g. trailing spaces).
      return leadingSpace.length > 0 ? [leadingSpace] : [];
    }

    var lower = stripped.toLowerCase();

    // --- Single punctuation or symbol ----------------------------------
    if (/^[^\w]$/.test(stripped)) {
      return [leadingSpace + stripped];
    }

    // --- Numeric sequences ---------------------------------------------
    if (/^\d+$/.test(stripped)) {
      var numTokens = [];
      for (var i = 0; i < stripped.length; i += 3) {
        var part = stripped.slice(i, Math.min(i + 3, stripped.length));
        numTokens.push((i === 0 ? leadingSpace : "") + part);
      }
      return numTokens.length > 0 ? numTokens : [leadingSpace + stripped];
    }

    // --- Common word ---------------------------------------------------
    if (COMMON_WORDS.has(lower)) {
      return [leadingSpace + stripped];
    }

    // --- Short words (1-4 chars) always 1 token ------------------------
    if (stripped.length <= 4) {
      return [leadingSpace + stripped];
    }

    // --- Medium words (5-6 chars) usually 1 token ----------------------
    if (stripped.length <= 6) {
      return [leadingSpace + stripped];
    }

    // --- Medium-to-long words: try affix splitting ---------------------
    return splitWordByAffixes(leadingSpace, stripped);
  }

  /**
   * Split a word into token strings using prefix/suffix analysis and then
   * chunking whatever remains in the middle.
   */
  function splitWordByAffixes(leadingSpace, word) {
    var lower = word.toLowerCase();
    var result = [];
    var prefixLen = 0;
    var suffixLen = 0;

    // --- Try to find a prefix ------------------------------------------
    if (word.length > 6) {
      for (var p = 0; p < PREFIXES.length; p++) {
        var pre = PREFIXES[p];
        if (lower.startsWith(pre) && lower.length > pre.length + 2) {
          prefixLen = pre.length;
          break;
        }
      }
    }

    // --- Try to find a suffix ------------------------------------------
    var searchSuffix = lower.slice(prefixLen);
    if (searchSuffix.length > 4) {
      for (var s = 0; s < SUFFIXES.length; s++) {
        var suf = SUFFIXES[s];
        if (searchSuffix.endsWith(suf) && searchSuffix.length > suf.length + 1) {
          suffixLen = suf.length;
          break;
        }
      }
    }

    // If no affixes found and the word is 7 chars, keep it whole.
    if (prefixLen === 0 && suffixLen === 0 && word.length <= 7) {
      return [leadingSpace + word];
    }

    // Build the tokens.
    var coreStart = prefixLen;
    var coreEnd = word.length - suffixLen;

    // Prefix token.
    if (prefixLen > 0) {
      result.push(leadingSpace + word.slice(0, prefixLen));
      leadingSpace = ""; // consumed
    }

    // Core: split into chunks of ~4 characters.
    var core = word.slice(coreStart, coreEnd);
    if (core.length > 0) {
      var coreChunks = splitCoreIntoChunks(core);
      for (var c = 0; c < coreChunks.length; c++) {
        result.push((c === 0 && result.length === 0 ? leadingSpace : "") + coreChunks[c]);
      }
    }

    // Suffix token.
    if (suffixLen > 0) {
      result.push(word.slice(coreEnd));
    }

    // Safety: never return empty.
    if (result.length === 0) {
      result.push(leadingSpace + word);
    }

    return result;
  }

  /**
   * Split a core substring (after removing affixes) into BPE-like chunks.
   *
   * Real BPE tokens for English average ~4-5 characters, but common
   * morpheme sequences often merge into 5-7 character tokens.  We target
   * a chunk size of 5-6 characters, preferring natural syllable boundaries
   * (vowel-to-consonant transitions).
   */
  function splitCoreIntoChunks(core) {
    if (core.length <= 6) return [core];

    var chunks = [];
    var pos = 0;
    while (pos < core.length) {
      var remaining = core.length - pos;
      if (remaining <= 7) {
        // Don't leave a tiny tail; take the rest as one chunk.
        chunks.push(core.slice(pos));
        break;
      }
      // Target 5-6 chars.  Look for a syllable break in the 4-7 range.
      var idealSplit = pos + 5;
      var bestSplit = idealSplit;
      // Search window: pos+4 .. pos+7
      for (var t = pos + 4; t <= pos + 7 && t < core.length; t++) {
        if (t > pos && isVowel(core[t - 1]) && !isVowel(core[t])) {
          bestSplit = t;
          break;
        }
      }
      // Clamp so we don't overshoot.
      if (bestSplit >= core.length) bestSplit = core.length;
      chunks.push(core.slice(pos, bestSplit));
      pos = bestSplit;
    }
    return chunks;
  }

  /**
   * Simple vowel test (English).
   */
  function isVowel(ch) {
    return "aeiouAEIOU".indexOf(ch) !== -1;
  }

  // -----------------------------------------------------------------------
  // 5.  PUBLIC API
  // -----------------------------------------------------------------------

  /**
   * Count the approximate number of tokens in `text`.
   *
   * Delegates to `tokenize` so that the count is always consistent with
   * the token array (no drift between the two code paths).
   *
   * @param  {string} text  The input string.
   * @return {number}       Estimated token count (integer >= 0).
   */
  function countTokens(text) {
    if (!text) return 0;
    return tokenize(text).length;
  }

  /**
   * Split `text` into an array of approximate token strings.
   *
   * Concatenating the returned array reproduces the original text.
   *
   * @param  {string}   text  The input string.
   * @return {string[]}       Array of token substrings.
   */
  function tokenize(text) {
    if (!text) return [];
    var chunks = preTokenize(text);
    var tokens = [];
    for (var i = 0; i < chunks.length; i++) {
      var subTokens = splitChunkIntoTokens(chunks[i]);
      for (var j = 0; j < subTokens.length; j++) {
        tokens.push(subTokens[j]);
      }
    }
    return tokens;
  }

  /**
   * Convert a WPM speed to approximate tokens per second.
   *
   * Uses the widely-cited average of ~1.3 tokens per English word
   * (derived from the observation that the average English word is ~4-5
   * characters and the average BPE token covers ~4 characters).
   *
   * @param  {number} charCount  Total characters typed (unused in this
   *                             formula but kept for API symmetry).
   * @param  {number} wpm        Words per minute.
   * @return {number}            Tokens per second (2 decimal places).
   */
  function getTokensPerSecond(charCount, wpm) {
    var tokensPerMinute = wpm * 1.3;
    var tokensPerSec = tokensPerMinute / 60;
    return Math.round(tokensPerSec * 100) / 100;
  }

  /**
   * Estimate tokens per second from raw character count and elapsed time.
   *
   * When no text string is available for full tokenization, we fall back to
   * the character-level heuristic (0.75 tokens per character is a reasonable
   * average for English prose -- derived from real tokenizer measurements).
   *
   * If you have the actual typed text, prefer passing it so we can use the
   * more accurate `countTokens` path.
   *
   * @param  {number}  charCount    Characters typed.
   * @param  {number}  timeSeconds  Elapsed time in seconds.
   * @param  {string=} text         Optional -- the actual typed text.
   * @return {number}               Tokens per second (2 decimal places).
   */
  function getTokensFromChars(charCount, timeSeconds, text) {
    if (timeSeconds <= 0) return 0;
    var tokenCount;
    if (text) {
      tokenCount = countTokens(text);
    } else {
      tokenCount = Math.round(charCount * 0.75);
    }
    var tps = tokenCount / timeSeconds;
    return Math.round(tps * 100) / 100;
  }

  /**
   * Quick token-count estimation for real-time display during typing.
   *
   * This trades a small amount of accuracy for speed by using a per-word
   * heuristic instead of full pre-tokenization and chunk analysis.
   *
   * @param  {string} text  The input string.
   * @return {number}       Estimated token count (integer >= 0).
   */
  function approximateTokenCount(text) {
    if (!text) return 0;

    // Split on whitespace to get rough words.
    var words = text.split(/\s+/).filter(function (w) { return w.length > 0; });
    if (words.length === 0) return 0;

    var count = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];

      // Separate trailing/leading punctuation.
      var punctMatch = w.match(/^([^\w]*)(.*?)([^\w]*)$/);
      var leading = punctMatch ? punctMatch[1] : "";
      var core = punctMatch ? punctMatch[2] : w;
      var trailing = punctMatch ? punctMatch[3] : "";

      // Each punctuation character is ~1 token.
      count += leading.length;
      count += trailing.length;

      if (core.length === 0) continue;

      var lower = core.toLowerCase();

      // Digits.
      if (/^\d+$/.test(core)) {
        count += Math.max(1, Math.ceil(core.length / 3));
        continue;
      }

      // Common word.
      if (COMMON_WORDS.has(lower)) {
        count += 1;
        continue;
      }

      // Length-based heuristic.
      if (core.length <= 6) {
        count += 1;
      } else if (core.length <= 10) {
        count += 2;
      } else {
        count += Math.ceil(core.length / 4);
      }
    }

    return count;
  }

  /**
   * Full breakdown of token analysis for a piece of text.
   *
   * Useful for displaying detailed statistics or debugging.
   *
   * @param  {string} text  The input string.
   * @return {{ totalTokens: number,
   *            tokens: string[],
   *            avgTokenLength: number,
   *            compressionRatio: number }}
   */
  function getTokenBreakdown(text) {
    var tokens = tokenize(text);
    var totalTokens = tokens.length;
    var totalChars = text ? text.length : 0;

    // Average characters per token (counting the full original text chars
    // rather than the stripped-token chars, so spaces are included).
    var avgTokenLength = totalTokens > 0
      ? Math.round((totalChars / totalTokens) * 100) / 100
      : 0;

    // Compression ratio: how many characters each token "represents".
    var compressionRatio = totalTokens > 0
      ? Math.round((totalChars / totalTokens) * 100) / 100
      : 0;

    return {
      totalTokens: totalTokens,
      tokens: tokens,
      avgTokenLength: avgTokenLength,
      compressionRatio: compressionRatio
    };
  }

  // -----------------------------------------------------------------------
  // 6.  EXPOSE PUBLIC API
  // -----------------------------------------------------------------------

  window.TokenType.Tokenizer = {
    countTokens: countTokens,
    tokenize: tokenize,
    getTokensPerSecond: getTokensPerSecond,
    getTokensFromChars: getTokensFromChars,
    approximateTokenCount: approximateTokenCount,
    getTokenBreakdown: getTokenBreakdown
  };
})();
