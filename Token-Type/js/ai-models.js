/**
 * Token Type - AI Model Data Module
 *
 * Contains benchmark data for popular AI model token generation speeds,
 * comparison utilities, and verdict generators for measuring human typing
 * speed against machine output rates.
 *
 * All token-per-second figures are approximate output generation speeds
 * sourced from publicly available benchmarks and provider documentation.
 *
 * No external dependencies.
 */
window.TokenType = window.TokenType || {};

window.TokenType.AIModels = (function () {
  // =========================================================================
  // Model Registry
  // =========================================================================

  const models = {
    "gpt-4o": {
      name: "GPT-4o",
      provider: "OpenAI",
      tokensPerSecond: 109,
      color: "#10a37f",
      icon: "\u{1F916}",
      description: "OpenAI's flagship multimodal model",
      releaseYear: 2024,
    },
    "claude-3.5-sonnet": {
      name: "Claude 3.5 Sonnet",
      provider: "Anthropic",
      tokensPerSecond: 87,
      color: "#d97706",
      icon: "\u{1F9E0}",
      description: "Anthropic's balanced performance model",
      releaseYear: 2024,
    },
    "claude-3.5-haiku": {
      name: "Claude 3.5 Haiku",
      provider: "Anthropic",
      tokensPerSecond: 150,
      color: "#f59e0b",
      icon: "\u{26A1}",
      description: "Anthropic's fastest model",
      releaseYear: 2024,
    },
    "llama-3-70b": {
      name: "Llama 3 70B",
      provider: "Meta",
      tokensPerSecond: 70,
      color: "#1877f2",
      icon: "\u{1F999}",
      description: "Meta's open-source powerhouse",
      releaseYear: 2024,
    },
    "gemini-1.5-pro": {
      name: "Gemini 1.5 Pro",
      provider: "Google",
      tokensPerSecond: 95,
      color: "#4285f4",
      icon: "\u{1F48E}",
      description: "Google's advanced reasoning model",
      releaseYear: 2024,
    },
    "gpt-4o-mini": {
      name: "GPT-4o Mini",
      provider: "OpenAI",
      tokensPerSecond: 165,
      color: "#10a37f",
      icon: "\u{1F680}",
      description: "OpenAI's efficient small model",
      releaseYear: 2024,
    },
    "mixtral-8x7b": {
      name: "Mixtral 8x7B",
      provider: "Mistral",
      tokensPerSecond: 80,
      color: "#ff7000",
      icon: "\u{1F300}",
      description: "Mistral's mixture-of-experts model",
      releaseYear: 2024,
    },
    "deepseek-v3": {
      name: "DeepSeek V3",
      provider: "DeepSeek",
      tokensPerSecond: 60,
      color: "#6366f1",
      icon: "\u{1F52E}",
      description: "DeepSeek's latest reasoning model",
      releaseYear: 2025,
    },
  };

  // =========================================================================
  // Verdict Tiers
  //
  // Each tier holds a ratio threshold, a CSS class for styling, and an array
  // of verdict strings. One string is chosen at random so repeat visitors
  // get a little variety.
  // =========================================================================

  const verdictTiers = [
    {
      maxRatio: Infinity,
      minRatio: 100,
      verdictClass: "domination",
      verdicts: [
        "Okay, the AI didn't even break a sweat. You're typing with mittens on.",
        "The AI generated an entire codebase in the time it took you to find the shift key.",
        "Somewhere, a telegraph operator just shed a tear of solidarity.",
      ],
    },
    {
      maxRatio: 100,
      minRatio: 50,
      verdictClass: "domination",
      verdicts: [
        "The AI finished a novel while you typed that sentence.",
        "If this were a race, the AI already showered, changed, and drove home.",
        "The AI had time to hallucinate an entire Wikipedia article and still beat you.",
      ],
    },
    {
      maxRatio: 50,
      minRatio: 30,
      verdictClass: "domination",
      verdicts: [
        "Not even close. The machines are laughing in binary.",
        "The AI wrote, proofread, and published a blog post before you finished a paragraph.",
        "At this rate, your keyboard is mostly decorative.",
      ],
    },
    {
      maxRatio: 30,
      minRatio: 20,
      verdictClass: "domination",
      verdicts: [
        "The AI is speed-running Shakespeare while you hunt and peck.",
        "On the bright side, your typing has... character. Literally, about 3 per second.",
        "The singularity isn't worried about you specifically.",
      ],
    },
    {
      maxRatio: 20,
      minRatio: 15,
      verdictClass: "domination",
      verdicts: [
        "Like bringing a bicycle to a Formula 1 race.",
        "You type like someone who reads the letters on the keys first. Respect.",
        "Your words per minute could be described as 'artisanal' and 'hand-crafted'.",
      ],
    },
    {
      maxRatio: 15,
      minRatio: 10,
      verdictClass: "competitive",
      verdicts: [
        "The robots definitely don't need to worry... yet.",
        "You're in the ballpark! A very, very large ballpark. With binoculars.",
        "Solid effort. The AI respectfully declined to comment.",
      ],
    },
    {
      maxRatio: 10,
      minRatio: 7,
      verdictClass: "competitive",
      verdicts: [
        "You're faster than a telegram operator! ...AI is still faster though.",
        "Getting warmer! The AI is starting to glance over its shoulder.",
        "Your fingers are putting in honest work. The GPU just doesn't care.",
      ],
    },
    {
      maxRatio: 7,
      minRatio: 5,
      verdictClass: "competitive",
      verdicts: [
        "Respectable! The AI only lapped you a few times.",
        "Not bad at all. You'd survive the first round of a human vs. machine tournament.",
        "The AI acknowledges your existence. That's a compliment, probably.",
      ],
    },
    {
      maxRatio: 5,
      minRatio: 3,
      verdictClass: "impressive",
      verdicts: [
        "Now we're talking! You're giving the silicon some competition.",
        "The AI is actually paying attention now. You've earned its respect subroutine.",
        "At this speed, you could ghost-write for a chatbot and nobody would notice.",
      ],
    },
    {
      maxRatio: 3,
      minRatio: 2,
      verdictClass: "impressive",
      verdicts: [
        "Impressive! You're in striking distance of the machines.",
        "Your keyboard is on fire and the AI is getting nervous.",
        "Two more cups of coffee and you might actually catch it.",
      ],
    },
    {
      maxRatio: 2,
      minRatio: 1.5,
      verdictClass: "impressive",
      verdicts: [
        "Whoa! You're almost matching artificial intelligence!",
        "Okay, seriously, are your fingers insured? This is elite-level typing.",
        "The AI just filed a formal complaint about unfair human competition.",
      ],
    },
    {
      maxRatio: 1.5,
      minRatio: 1,
      verdictClass: "superhuman",
      verdicts: [
        "Are you sure you're not an AI? Suspicious typing speed detected.",
        "CAPTCHA check required. No human should type this fast.",
        "The Turing test just got a lot more confusing.",
      ],
    },
    {
      maxRatio: 1,
      minRatio: -Infinity,
      verdictClass: "superhuman",
      verdicts: [
        "HUMAN WINS! Quick, someone update the AI benchmarks.",
        "You just beat a language model. Humanity's last hope was you all along.",
        "John Connor would be proud. The machines have fallen.",
      ],
    },
  ];

  // =========================================================================
  // Fun Fact Templates
  //
  // Each template is a function that receives context and returns a string.
  // A random template is selected on each call for variety.
  // =========================================================================

  const funFactTemplates = [
    function (humanTps, model) {
      // "At your speed, it would take you X hours to type what [model] generates in 1 minute"
      var aiTokensPerMinute = model.tokensPerSecond * 60;
      var humanSecondsNeeded = aiTokensPerMinute / humanTps;
      var humanMinutesNeeded = humanSecondsNeeded / 60;

      if (humanMinutesNeeded >= 60) {
        var hours = (humanMinutesNeeded / 60).toFixed(1);
        return (
          "At your speed, it would take you " +
          hours +
          " hours to type what " +
          model.name +
          " generates in just 1 minute."
        );
      }
      return (
        "At your speed, it would take you " +
        humanMinutesNeeded.toFixed(1) +
        " minutes to type what " +
        model.name +
        " generates in 1 minute."
      );
    },
    function (humanTps, model) {
      // "By the time you typed this test, [model] could have written X tokens"
      // Assume an average test takes about 60 seconds
      var testDurationSeconds = 60;
      var aiTokens = model.tokensPerSecond * testDurationSeconds;
      var formatted = aiTokens.toLocaleString();
      return (
        "In the time it takes to finish a typical typing test, " +
        model.name +
        " could have generated roughly " +
        formatted +
        " tokens \u2014 enough for a small essay."
      );
    },
    function (humanTps, model) {
      // "You'd need X clones of yourself typing simultaneously to match [model]"
      var clones = Math.ceil(model.tokensPerSecond / humanTps);
      if (clones <= 1) {
        return (
          "You alone can match " +
          model.name +
          "'s output. Congratulations, you ARE the benchmark."
        );
      }
      return (
        "You'd need " +
        clones +
        " clones of yourself all typing simultaneously to keep up with " +
        model.name +
        "."
      );
    },
    function (humanTps, model) {
      // How many words the AI writes while you type one word (~5 tokens)
      var humanSecondsPerWord = 5 / humanTps;
      var aiTokensInThatTime = model.tokensPerSecond * humanSecondsPerWord;
      var aiWords = Math.round(aiTokensInThatTime / 0.75); // ~0.75 tokens per word
      return (
        "Every time you finish typing a single word, " +
        model.name +
        " has already produced roughly " +
        aiWords +
        " words."
      );
    },
    function (humanTps, model) {
      // Pages-per-hour comparison (1 page ~ 250 words ~ 333 tokens)
      var tokensPerPage = 333;
      var humanPagesPerHour = ((humanTps * 3600) / tokensPerPage).toFixed(1);
      var aiPagesPerHour = Math.round(
        (model.tokensPerSecond * 3600) / tokensPerPage
      );
      return (
        "At your pace you'd produce about " +
        humanPagesPerHour +
        " pages per hour. " +
        model.name +
        " would churn out ~" +
        aiPagesPerHour.toLocaleString() +
        " pages. No big deal."
      );
    },
  ];

  // =========================================================================
  // Internal Helpers
  // =========================================================================

  /**
   * Pick a random element from an array.
   * @param {Array} arr - Source array.
   * @returns {*} A randomly selected element.
   */
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Retrieve a single model object by its ID.
   *
   * @param {string} modelId - The key used in the models registry (e.g. "gpt-4o").
   * @returns {Object|null} The model object, or null if not found.
   */
  function getModel(modelId) {
    return models[modelId] || null;
  }

  /**
   * Return the default comparison model (GPT-4o).
   *
   * @returns {Object} The default model object.
   */
  function getDefaultModel() {
    return models["gpt-4o"];
  }

  /**
   * Get an array of every model object in the registry.
   *
   * @returns {Object[]} Array of model objects, each augmented with its `id` key.
   */
  function getAllModels() {
    return Object.keys(models).map(function (id) {
      return Object.assign({ id: id }, models[id]);
    });
  }

  /**
   * Get a plain array of model ID strings.
   *
   * @returns {string[]} e.g. ["gpt-4o", "claude-3.5-sonnet", ...]
   */
  function getModelIds() {
    return Object.keys(models);
  }

  /**
   * Determine which verdict tier a given AI-to-human ratio falls into,
   * then return a random verdict string and its associated CSS class.
   *
   * @param {number} ratio - AI tokens-per-second divided by human tokens-per-second.
   * @returns {{ verdict: string, verdictClass: string }}
   */
  function getVerdict(ratio) {
    // Walk the tiers from highest to lowest. Each tier covers the range
    // (minRatio, maxRatio]. The first tier uses maxRatio = Infinity and
    // the last uses minRatio = -Infinity, so every possible ratio value
    // is guaranteed to match exactly one tier.
    for (var i = 0; i < verdictTiers.length; i++) {
      var tier = verdictTiers[i];
      var aboveMin = ratio > tier.minRatio;
      var atOrBelowMax =
        tier.maxRatio === Infinity ? true : ratio <= tier.maxRatio;

      if (aboveMin && atOrBelowMax) {
        return {
          verdict: pickRandom(tier.verdicts),
          verdictClass: tier.verdictClass,
        };
      }
    }

    // Fallback (should never be reached)
    return {
      verdict: "You typed. That's something.",
      verdictClass: "competitive",
    };
  }

  /**
   * Compare a human's token generation speed against a specific AI model.
   *
   * @param {number}  humanTokensPerSecond - The human's measured TPS.
   * @param {string} [modelId="gpt-4o"]    - Which model to compare against.
   * @returns {{
   *   humanTps: number,
   *   aiTps: number,
   *   ratio: number,
   *   humanPercentage: number,
   *   verdict: string,
   *   verdictClass: string
   * }}
   */
  function compareToHuman(humanTokensPerSecond, modelId) {
    var model = models[modelId] || models["gpt-4o"];
    var aiTps = model.tokensPerSecond;

    // Guard against zero / negative human speed
    var safeTps = Math.max(humanTokensPerSecond, 0.01);

    var ratio = aiTps / safeTps;
    var humanPercentage = (safeTps / aiTps) * 100;
    var verdictResult = getVerdict(ratio);

    return {
      humanTps: humanTokensPerSecond,
      aiTps: aiTps,
      ratio: Math.round(ratio * 10) / 10,
      humanPercentage: Math.round(humanPercentage * 100) / 100,
      verdict: verdictResult.verdict,
      verdictClass: verdictResult.verdictClass,
    };
  }

  /**
   * Generate a fun, shareable comparison fact about the human's speed
   * relative to a given AI model.
   *
   * @param {number}  humanTps             - The human's measured TPS.
   * @param {string} [modelId="gpt-4o"]    - Which model to use for the fact.
   * @returns {string} A human-readable fun fact string.
   */
  function getFunFact(humanTps, modelId) {
    var model = models[modelId] || models["gpt-4o"];
    var safeTps = Math.max(humanTps, 0.01);
    var template = pickRandom(funFactTemplates);
    return template(safeTps, model);
  }

  /**
   * Build a leaderboard array that ranks the human among all AI models,
   * sorted from fastest to slowest.
   *
   * @param {number} humanTps - The human's measured tokens per second.
   * @returns {Array<{ name: string, tps: number, isHuman: boolean, icon?: string, color?: string }>}
   */
  function getLeaderboard(humanTps) {
    // Start with all AI entries
    var entries = Object.keys(models).map(function (id) {
      var m = models[id];
      return {
        name: m.name,
        tps: m.tokensPerSecond,
        isHuman: false,
        icon: m.icon,
        color: m.color,
      };
    });

    // Insert the human entry
    entries.push({
      name: "You",
      tps: Math.round(humanTps * 100) / 100,
      isHuman: true,
      icon: "\u{1F9D1}\u{200D}\u{1F4BB}",
      color: "#ef4444",
    });

    // Sort descending by tokens per second
    entries.sort(function (a, b) {
      return b.tps - a.tps;
    });

    return entries;
  }

  // =========================================================================
  // Expose public interface
  // =========================================================================

  return {
    models: models,
    getModel: getModel,
    getDefaultModel: getDefaultModel,
    getAllModels: getAllModels,
    getModelIds: getModelIds,
    compareToHuman: compareToHuman,
    getVerdict: getVerdict,
    getFunFact: getFunFact,
    getLeaderboard: getLeaderboard,
  };
})();
