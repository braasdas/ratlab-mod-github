/**
 * Token Type - Main Application Module
 *
 * Wires together the TypingEngine, Tokenizer, and AIModels modules with
 * the DOM.  Handles rendering, focus management, settings, live stats,
 * results display, and canvas chart drawing.
 *
 * Depends on:
 *   window.TokenType.Tokenizer
 *   window.TokenType.AIModels
 *   window.TokenType.TypingEngine
 *
 * Self-initializes on DOMContentLoaded.
 */

window.TokenType = window.TokenType || {};

window.TokenType.App = (function () {
  "use strict";

  // =========================================================================
  // Module references (resolved at init)
  // =========================================================================

  var Engine;
  var Tokenizer;
  var AIModels;

  // =========================================================================
  // Cached DOM Elements
  // =========================================================================

  var dom = {};

  // =========================================================================
  // Application Settings
  // =========================================================================

  var settings = {
    duration: 30,
    mode: "words",
    wordCount: 50,
    modelId: "gpt-4o"
  };

  // =========================================================================
  // Internal State
  // =========================================================================

  var typingActivityTimeout = null;
  var liveUpdateInterval = null;

  // =========================================================================
  // Initialization
  // =========================================================================

  function init() {
    Engine    = window.TokenType.TypingEngine;
    Tokenizer = window.TokenType.Tokenizer;
    AIModels  = window.TokenType.AIModels;

    cacheDom();
    setupEventListeners();
    setupModelSelector();
    resetTest();
  }

  /**
   * Cache all important DOM element references.
   */
  function cacheDom() {
    // Typing area
    dom.typingInput   = document.getElementById("typing-input");
    dom.wordDisplay   = document.getElementById("word-display");
    dom.focusOverlay  = document.getElementById("focus-overlay");
    dom.typingArea    = document.getElementById("typing-area");

    // Live stats
    dom.liveStats     = document.getElementById("live-stats");
    dom.liveWpm       = document.getElementById("live-wpm-value");
    dom.liveTokens    = document.getElementById("live-tokens-value");
    dom.liveTimer     = document.getElementById("live-timer-value");
    dom.liveAccuracy  = document.getElementById("live-accuracy-value");

    // Results panel
    dom.resultsPanel  = document.getElementById("results-panel");
    dom.resultWpm     = document.getElementById("result-wpm");
    dom.resultTokens  = document.getElementById("result-tokens");
    dom.resultAccuracy = document.getElementById("result-accuracy");

    // Comparison
    dom.compareHumanTokens = document.getElementById("compare-human-tokens");
    dom.compareAiName      = document.getElementById("compare-ai-name");
    dom.compareAiTokens    = document.getElementById("compare-ai-tokens");
    dom.compareBarHuman    = document.getElementById("compare-bar-human");
    dom.compareBarAi       = document.getElementById("compare-bar-ai");
    dom.compareBarAiLabel  = document.getElementById("compare-bar-ai-label");
    dom.comparisonVerdict  = document.getElementById("comparison-verdict");

    // Chart
    dom.performanceChart = document.getElementById("performance-chart");

    // Breakdown
    dom.resultCharsCorrect   = document.getElementById("result-chars-correct");
    dom.resultCharsIncorrect = document.getElementById("result-chars-incorrect");
    dom.resultCharsExtra     = document.getElementById("result-chars-extra");
    dom.resultCharsMissed    = document.getElementById("result-chars-missed");
    dom.resultConsistency    = document.getElementById("result-consistency");
    dom.resultRawWpm         = document.getElementById("result-raw-wpm");

    // Buttons
    dom.btnNextTest   = document.getElementById("btn-next-test");
    dom.btnShare      = document.getElementById("btn-share");

    // Settings selectors
    dom.timeSelector  = document.getElementById("time-selector");
    dom.modeSelector  = document.getElementById("mode-selector");
    dom.modelSelector = document.getElementById("model-selector");

    // Settings bar
    dom.settingsBar   = document.getElementById("settings-bar");
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================

  function setupEventListeners() {
    // -- Typing input --
    dom.typingInput.addEventListener("input", onInput);
    dom.typingInput.addEventListener("keydown", onKeyDown);

    // -- Focus management --
    dom.typingInput.addEventListener("focus", onInputFocus);
    dom.typingInput.addEventListener("blur", onInputBlur);

    // Clicking the typing area / overlay focuses the input
    dom.typingArea.addEventListener("click", function () {
      dom.typingInput.focus();
    });

    dom.focusOverlay.addEventListener("click", function (e) {
      e.stopPropagation();
      dom.typingInput.focus();
    });

    // -- Time selector --
    dom.timeSelector.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-time]");
      if (!btn) return;
      var time = parseInt(btn.getAttribute("data-time"), 10);
      if (isNaN(time)) return;

      settings.duration = time;
      setActiveButton(dom.timeSelector, btn);
      resetTest();
    });

    // -- Mode selector --
    dom.modeSelector.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      var mode = btn.getAttribute("data-mode");

      settings.mode = mode;
      setActiveButton(dom.modeSelector, btn);
      resetTest();
    });

    // -- Model selector --
    dom.modelSelector.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-model]");
      if (!btn) return;
      var modelId = btn.getAttribute("data-model");

      settings.modelId = modelId;
      setActiveButton(dom.modelSelector, btn);
      // No need to reset test when model changes -- it only affects results
    });

    // -- Next test button --
    dom.btnNextTest.addEventListener("click", function () {
      resetTest();
      dom.typingInput.focus();
    });

    // -- Share button --
    dom.btnShare.addEventListener("click", onShare);

    // -- Keyboard shortcuts --
    document.addEventListener("keydown", onGlobalKeyDown);
  }

  /**
   * Populate the model selector with buttons from AIModels data.
   */
  function setupModelSelector() {
    var allModels = AIModels.getAllModels();
    dom.modelSelector.innerHTML = "";

    for (var i = 0; i < allModels.length; i++) {
      var model = allModels[i];
      var btn = document.createElement("button");
      btn.className = "btn" + (model.id === settings.modelId ? " active" : "");
      btn.setAttribute("data-model", model.id);
      btn.textContent = model.name;
      dom.modelSelector.appendChild(btn);
    }
  }

  // =========================================================================
  // Input Handling
  // =========================================================================

  function onInput() {
    var value = dom.typingInput.value;

    // Show typing-active class for solid cursor
    dom.typingArea.classList.add("typing-active");
    clearTimeout(typingActivityTimeout);
    typingActivityTimeout = setTimeout(function () {
      dom.typingArea.classList.remove("typing-active");
    }, 500);

    var snapshot = Engine.handleInput(value);

    if (snapshot.wordCompleted) {
      // Clear the input field after word completion
      dom.typingInput.value = "";
      // Re-render words with updated state
      updateWordDisplay(snapshot);
    } else {
      // Update character-level highlighting
      updateCharHighlighting(snapshot);
    }

    // Show live stats once test starts
    if (snapshot.isRunning) {
      showLiveStats();
      updateLiveStats(snapshot.stats);
    }

    // Test finished
    if (snapshot.isFinished) {
      showResults();
    }
  }

  function onKeyDown(e) {
    // Prevent Tab from moving focus during test
    if (e.key === "Tab") {
      e.preventDefault();
      resetTest();
      return;
    }

    // Escape -- stop and show results
    if (e.key === "Escape") {
      e.preventDefault();
      if (Engine.isRunning()) {
        Engine.forceFinish();
        showResults();
      }
      return;
    }

    // Prevent ctrl-a selecting input content (it's hidden anyway)
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      return;
    }
  }

  function onGlobalKeyDown(e) {
    // Tab anywhere resets the test
    if (e.key === "Tab" && !e.target.closest("#results-panel")) {
      e.preventDefault();
      resetTest();
      dom.typingInput.focus();
      return;
    }

    // If user starts typing and the input isn't focused, focus it
    // (single printable characters only, not modifiers)
    if (
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      e.key.length === 1 &&
      document.activeElement !== dom.typingInput &&
      !dom.resultsPanel.classList.contains("hidden") === false &&
      !Engine.isFinished()
    ) {
      dom.typingInput.focus();
    }
  }

  // =========================================================================
  // Focus Management
  // =========================================================================

  function onInputFocus() {
    dom.focusOverlay.classList.add("hidden");
    dom.typingArea.classList.add("focused");
  }

  function onInputBlur() {
    // If the test is running, show a subtle "click to continue" overlay
    if (Engine.isRunning() && !Engine.isFinished()) {
      dom.focusOverlay.classList.remove("hidden");
      var overlayText = dom.focusOverlay.querySelector(".focus-overlay-text");
      if (overlayText) {
        overlayText.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="focus-icon">' +
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>' +
          '</svg> click to continue';
      }
    } else if (!Engine.isRunning()) {
      dom.focusOverlay.classList.remove("hidden");
      dom.typingArea.classList.remove("focused");
    }
  }

  // =========================================================================
  // Word Rendering
  // =========================================================================

  /**
   * Render the initial word display.
   *
   * @param {string[]} words  Array of words to display.
   */
  function renderWords(words) {
    dom.wordDisplay.innerHTML = "";
    dom.wordDisplay.scrollTop = 0;

    for (var i = 0; i < words.length; i++) {
      var wordEl = document.createElement("div");
      wordEl.className = "word" + (i === 0 ? " active-word" : "");
      wordEl.style.display = "inline-block";

      var chars = words[i].split("");
      for (var j = 0; j < chars.length; j++) {
        var charEl = document.createElement("span");
        charEl.className = "char" + (i === 0 && j === 0 ? " active" : "");
        charEl.textContent = chars[j];
        wordEl.appendChild(charEl);
      }

      dom.wordDisplay.appendChild(wordEl);
    }
  }

  /**
   * Update the word display after a word has been completed.
   */
  function updateWordDisplay(snapshot) {
    var wordElements = dom.wordDisplay.querySelectorAll(".word");
    var currentIdx = snapshot.currentWordIndex;

    // Mark the previous word
    if (currentIdx > 0) {
      var prevIdx = currentIdx - 1;
      if (prevIdx < wordElements.length) {
        var prevWord = wordElements[prevIdx];
        prevWord.classList.remove("active-word");

        var lastHistoryEntry = snapshot.typedHistory[snapshot.typedHistory.length - 1];
        if (lastHistoryEntry && !lastHistoryEntry.correct) {
          prevWord.classList.add("error");
        }

        // Finalize char highlighting for the completed word
        finalizeWordChars(prevWord, lastHistoryEntry);
      }
    }

    // If we need more word elements (dynamic generation), append them
    if (currentIdx >= wordElements.length) {
      var newWords = snapshot.words.slice(wordElements.length);
      for (var i = 0; i < newWords.length; i++) {
        var wordEl = document.createElement("div");
        wordEl.className = "word";
        wordEl.style.display = "inline-block";
        var chars = newWords[i].split("");
        for (var j = 0; j < chars.length; j++) {
          var charEl = document.createElement("span");
          charEl.className = "char";
          charEl.textContent = chars[j];
          wordEl.appendChild(charEl);
        }
        dom.wordDisplay.appendChild(wordEl);
      }
      // Re-query
      wordElements = dom.wordDisplay.querySelectorAll(".word");
    }

    // Set the new active word
    if (currentIdx < wordElements.length) {
      var activeWord = wordElements[currentIdx];
      activeWord.classList.add("active-word");

      // Reset all chars in the active word
      var chars = activeWord.querySelectorAll(".char");
      for (var c = 0; c < chars.length; c++) {
        chars[c].className = "char" + (c === 0 ? " active" : "");
      }

      // Remove extra chars from previous attempts (if any)
      var extraChars = activeWord.querySelectorAll(".char.extra");
      for (var e = 0; e < extraChars.length; e++) {
        extraChars[e].parentNode.removeChild(extraChars[e]);
      }

      // Scroll to keep current word visible
      scrollToActiveWord(activeWord);
    }
  }

  /**
   * Finalize the character highlighting for a completed word.
   */
  function finalizeWordChars(wordEl, historyEntry) {
    if (!historyEntry) return;

    var chars = wordEl.querySelectorAll(".char:not(.extra)");
    var typed = historyEntry.typed;
    var actual = historyEntry.word;

    // Remove any previously added extra chars
    var existingExtras = wordEl.querySelectorAll(".char.extra");
    for (var e = 0; e < existingExtras.length; e++) {
      existingExtras[e].parentNode.removeChild(existingExtras[e]);
    }

    // Mark correct / incorrect
    for (var i = 0; i < chars.length; i++) {
      chars[i].classList.remove("active", "correct", "incorrect");
      if (i < typed.length) {
        if (typed[i] === actual[i]) {
          chars[i].classList.add("correct");
        } else {
          chars[i].classList.add("incorrect");
        }
      }
      // Chars not reached remain default (missed)
    }

    // Add extra chars beyond word length
    if (typed.length > actual.length) {
      for (var j = actual.length; j < typed.length; j++) {
        var extraEl = document.createElement("span");
        extraEl.className = "char extra";
        extraEl.textContent = typed[j];
        wordEl.appendChild(extraEl);
      }
    }
  }

  /**
   * Update character highlighting for the current word as the user types.
   */
  function updateCharHighlighting(snapshot) {
    var wordElements = dom.wordDisplay.querySelectorAll(".word");
    var currentIdx = snapshot.currentWordIndex;

    if (currentIdx >= wordElements.length) return;

    var wordEl = wordElements[currentIdx];
    var chars = wordEl.querySelectorAll(".char:not(.extra)");
    var input = snapshot.currentInput;
    var actual = snapshot.words[currentIdx];

    if (!actual) return;

    // Remove old extra chars
    var oldExtras = wordEl.querySelectorAll(".char.extra");
    for (var e = 0; e < oldExtras.length; e++) {
      oldExtras[e].parentNode.removeChild(oldExtras[e]);
    }

    // Update each character's class
    for (var i = 0; i < chars.length; i++) {
      chars[i].classList.remove("correct", "incorrect", "active");

      if (i < input.length) {
        if (input[i] === actual[i]) {
          chars[i].classList.add("correct");
        } else {
          chars[i].classList.add("incorrect");
        }
      }

      // Place cursor
      if (i === input.length) {
        chars[i].classList.add("active");
      }
    }

    // If the cursor is past the last char (input matches or exceeds word length),
    // we need to handle the cursor position
    if (input.length >= actual.length) {
      // Remove active from all normal chars
      for (var k = 0; k < chars.length; k++) {
        chars[k].classList.remove("active");
      }
    }

    // If input.length === 0, first char gets cursor
    if (input.length === 0 && chars.length > 0) {
      chars[0].classList.add("active");
    }

    // Add extra chars if user typed beyond the word
    if (input.length > actual.length) {
      for (var j = actual.length; j < input.length; j++) {
        var extraEl = document.createElement("span");
        extraEl.className = "char extra";
        extraEl.textContent = input[j];
        wordEl.appendChild(extraEl);
      }

      // Put cursor after last extra char (no visible cursor past end,
      // but CSS will handle it if desired)
    }
  }

  /**
   * Scroll the word display to keep the active word visible.
   */
  function scrollToActiveWord(activeWordEl) {
    if (!activeWordEl) return;

    var container = dom.wordDisplay;
    var wordTop = activeWordEl.offsetTop;
    var containerScrollTop = container.scrollTop;
    var containerHeight = container.clientHeight;

    // Keep the active word in the top ~60% of the container
    var targetScroll = wordTop - containerHeight * 0.35;

    if (targetScroll > containerScrollTop) {
      container.scrollTo({
        top: targetScroll,
        behavior: "smooth"
      });
    }
  }

  // =========================================================================
  // Live Stats
  // =========================================================================

  function showLiveStats() {
    dom.liveStats.classList.remove("hidden");

    // Start a periodic update for smoother timer display
    if (!liveUpdateInterval) {
      liveUpdateInterval = setInterval(function () {
        if (Engine.isRunning() && !Engine.isFinished()) {
          var stats = Engine.getCurrentStats();
          updateLiveStats(stats);
        } else {
          clearInterval(liveUpdateInterval);
          liveUpdateInterval = null;
        }
      }, 100);
    }
  }

  function hideLiveStats() {
    dom.liveStats.classList.add("hidden");
    if (liveUpdateInterval) {
      clearInterval(liveUpdateInterval);
      liveUpdateInterval = null;
    }
  }

  function updateLiveStats(stats) {
    dom.liveWpm.textContent = stats.wpm;
    dom.liveTokens.textContent = stats.tokensPerSecond.toFixed(1);
    dom.liveTimer.textContent = stats.timeRemaining;
    dom.liveAccuracy.textContent = Math.round(stats.accuracy);
  }

  // =========================================================================
  // Results Display
  // =========================================================================

  function showResults() {
    var results = Engine.getResults();

    // Hide typing area and live stats, show results
    dom.typingArea.classList.add("hidden");
    dom.settingsBar.classList.add("hidden");
    hideLiveStats();
    dom.resultsPanel.classList.remove("hidden");

    // -- Hero stats --
    dom.resultWpm.textContent = results.wpm;
    dom.resultTokens.textContent = results.tokensPerSecond.toFixed(1);
    dom.resultAccuracy.textContent = Math.round(results.accuracy) + "%";

    // -- Comparison --
    var comparison = AIModels.compareToHuman(results.tokensPerSecond, settings.modelId);
    var model = AIModels.getModel(settings.modelId) || AIModels.getDefaultModel();

    dom.compareHumanTokens.textContent = results.tokensPerSecond.toFixed(1);
    dom.compareAiName.textContent = model.name;
    dom.compareAiTokens.textContent = model.tokensPerSecond;

    // Animate the comparison bar
    var total = results.tokensPerSecond + model.tokensPerSecond;
    var humanPct = total > 0 ? Math.max(2, (results.tokensPerSecond / total) * 100) : 2;
    var aiPct = 100 - humanPct;

    // Use setTimeout so the CSS transition is visible
    dom.compareBarHuman.style.width = "50%";
    dom.compareBarAi.style.width = "50%";

    setTimeout(function () {
      dom.compareBarHuman.style.width = humanPct + "%";
      dom.compareBarAi.style.width = aiPct + "%";
    }, 100);

    dom.compareBarAiLabel.textContent = model.name.toLowerCase();

    // Verdict
    dom.comparisonVerdict.textContent = comparison.verdict;
    dom.comparisonVerdict.className = "comparison-verdict verdict-" + comparison.verdictClass;

    // -- Breakdown --
    dom.resultCharsCorrect.textContent = results.correctChars;
    dom.resultCharsIncorrect.textContent = results.incorrectChars;
    dom.resultCharsExtra.textContent = results.extraChars;
    dom.resultCharsMissed.textContent = results.missedChars;
    dom.resultConsistency.textContent = results.consistency + "%";
    dom.resultRawWpm.textContent = results.rawWpm;

    // -- Chart --
    drawPerformanceChart(results, model);
  }

  function hideResults() {
    dom.resultsPanel.classList.add("hidden");
    dom.typingArea.classList.remove("hidden");
    dom.settingsBar.classList.remove("hidden");
  }

  // =========================================================================
  // Performance Chart (Canvas)
  // =========================================================================

  function drawPerformanceChart(results, model) {
    var canvas = dom.performanceChart;
    if (!canvas) return;

    // Handle high-DPI displays
    var rect = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var width = rect.width - 32;  // account for padding
    var height = 200;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Theme colors
    var bgColor        = "#2c2e31";
    var gridColor      = "rgba(100, 102, 105, 0.2)";
    var gridTextColor  = "rgba(100, 102, 105, 0.7)";
    var accentColor    = "#00e5ff";
    var accentColorDim = "rgba(0, 229, 255, 0.15)";
    var rawColor       = "rgba(100, 102, 105, 0.5)";
    var modelColor     = model.color || "#e2b714";
    var modelColorDim  = hexToRgba(modelColor, 0.3);

    // Clear
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    var data = results.wpmHistory;
    if (!data || data.length < 2) {
      // Not enough data -- show message
      ctx.fillStyle = gridTextColor;
      ctx.font = "12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("not enough data to chart", width / 2, height / 2);
      return;
    }

    // Chart area with margins
    var margin = { top: 20, right: 60, bottom: 30, left: 50 };
    var chartW = width - margin.left - margin.right;
    var chartH = height - margin.top - margin.bottom;

    // Data ranges
    var maxTime = data[data.length - 1].time;
    var maxWpm = 0;
    var minWpm = Infinity;

    for (var i = 0; i < data.length; i++) {
      if (data[i].wpm > maxWpm) maxWpm = data[i].wpm;
      if (data[i].raw > maxWpm) maxWpm = data[i].raw;
      if (data[i].wpm < minWpm && data[i].wpm > 0) minWpm = data[i].wpm;
    }

    // Calculate AI WPM equivalent for reference line
    // tokens/s * 60 / 1.3 = approximate WPM equivalent
    var aiWpmEquiv = Math.round((model.tokensPerSecond * 60) / 1.3);
    // Only include AI line in scale if we want to show it (it may be very high)
    var showAiLine = aiWpmEquiv < maxWpm * 5;
    if (showAiLine && aiWpmEquiv > maxWpm) {
      maxWpm = aiWpmEquiv;
    }

    // Add padding to Y range
    maxWpm = Math.ceil(maxWpm * 1.15 / 10) * 10;
    minWpm = 0;
    var yRange = maxWpm - minWpm || 1;

    // Helper: data coords -> canvas coords
    function toX(time) {
      return margin.left + (time / maxTime) * chartW;
    }
    function toY(wpm) {
      return margin.top + chartH - ((wpm - minWpm) / yRange) * chartH;
    }

    // -- Grid lines --
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillStyle = gridTextColor;

    // Horizontal grid lines (WPM)
    var yStep = calculateNiceStep(yRange, 5);
    for (var yVal = 0; yVal <= maxWpm; yVal += yStep) {
      var y = toY(yVal);
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + chartW, y);
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.fillText(yVal, margin.left - 8, y + 4);
    }

    // Vertical grid lines (time)
    var xStep = calculateNiceStep(maxTime, 6);
    for (var t = 0; t <= maxTime; t += xStep) {
      var x = toX(t);
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + chartH);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillText(t + "s", x, margin.top + chartH + 16);
    }

    // -- AI reference line (dashed) --
    if (showAiLine) {
      var aiY = toY(aiWpmEquiv);
      ctx.strokeStyle = modelColorDim;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(margin.left, aiY);
      ctx.lineTo(margin.left + chartW, aiY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = modelColor;
      ctx.textAlign = "left";
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillText(model.name + " equiv.", margin.left + chartW + 4, aiY + 4);
    }

    // -- Raw WPM line --
    drawSmoothLine(ctx, data, "raw", toX, toY, rawColor, 1.5);

    // -- WPM line with gradient fill --
    drawWpmLineWithFill(ctx, data, toX, toY, accentColor, accentColorDim, chartH, margin);

    // -- Legend --
    var legendX = margin.left + 10;
    var legendY = margin.top + 14;
    ctx.font = "10px 'JetBrains Mono', monospace";

    // WPM
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY);
    ctx.lineTo(legendX + 20, legendY);
    ctx.stroke();
    ctx.fillStyle = accentColor;
    ctx.textAlign = "left";
    ctx.fillText("wpm", legendX + 26, legendY + 4);

    // Raw WPM
    ctx.strokeStyle = rawColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(legendX + 70, legendY);
    ctx.lineTo(legendX + 90, legendY);
    ctx.stroke();
    ctx.fillStyle = rawColor;
    ctx.fillText("raw", legendX + 96, legendY + 4);

    // AI line
    if (showAiLine) {
      ctx.strokeStyle = modelColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(legendX + 130, legendY);
      ctx.lineTo(legendX + 150, legendY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = modelColor;
      ctx.fillText(model.name.toLowerCase(), legendX + 156, legendY + 4);
    }

    // -- Axis labels --
    ctx.fillStyle = gridTextColor;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";

    // Y axis label
    ctx.save();
    ctx.translate(12, margin.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("wpm", 0, 0);
    ctx.restore();
  }

  /**
   * Draw a smooth line for a data series.
   */
  function drawSmoothLine(ctx, data, key, toX, toY, color, lineWidth) {
    if (data.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    ctx.moveTo(toX(data[0].time), toY(data[0][key]));

    if (data.length === 2) {
      ctx.lineTo(toX(data[1].time), toY(data[1][key]));
    } else {
      // Cardinal spline interpolation for smooth curves
      for (var i = 0; i < data.length - 1; i++) {
        var x0 = toX(data[Math.max(0, i - 1)].time);
        var y0 = toY(data[Math.max(0, i - 1)][key]);
        var x1 = toX(data[i].time);
        var y1 = toY(data[i][key]);
        var x2 = toX(data[Math.min(data.length - 1, i + 1)].time);
        var y2 = toY(data[Math.min(data.length - 1, i + 1)][key]);
        var x3 = toX(data[Math.min(data.length - 1, i + 2)].time);
        var y3 = toY(data[Math.min(data.length - 1, i + 2)][key]);

        var tension = 0.3;
        var cp1x = x1 + (x2 - x0) * tension;
        var cp1y = y1 + (y2 - y0) * tension;
        var cp2x = x2 - (x3 - x1) * tension;
        var cp2y = y2 - (y3 - y1) * tension;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      }
    }

    ctx.stroke();
  }

  /**
   * Draw the WPM line with a gradient fill beneath it.
   */
  function drawWpmLineWithFill(ctx, data, toX, toY, color, fillColor, chartH, margin) {
    if (data.length < 2) return;

    // Build path points
    var points = [];
    for (var i = 0; i < data.length; i++) {
      points.push({ x: toX(data[i].time), y: toY(data[i].wpm) });
    }

    // Draw the fill first
    var gradient = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartH);
    gradient.addColorStop(0, fillColor);
    gradient.addColorStop(1, "rgba(0, 229, 255, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(points[0].x, margin.top + chartH); // bottom left
    ctx.lineTo(points[0].x, points[0].y);

    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (var j = 0; j < data.length - 1; j++) {
        var x0 = toX(data[Math.max(0, j - 1)].time);
        var y0 = toY(data[Math.max(0, j - 1)].wpm);
        var x1 = toX(data[j].time);
        var y1 = toY(data[j].wpm);
        var x2 = toX(data[Math.min(data.length - 1, j + 1)].time);
        var y2 = toY(data[Math.min(data.length - 1, j + 1)].wpm);
        var x3 = toX(data[Math.min(data.length - 1, j + 2)].time);
        var y3 = toY(data[Math.min(data.length - 1, j + 2)].wpm);

        var tension = 0.3;
        var cp1x = x1 + (x2 - x0) * tension;
        var cp1y = y1 + (y2 - y0) * tension;
        var cp2x = x2 - (x3 - x1) * tension;
        var cp2y = y2 - (y3 - y1) * tension;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      }
    }

    ctx.lineTo(points[points.length - 1].x, margin.top + chartH); // bottom right
    ctx.closePath();
    ctx.fill();

    // Draw the line on top
    drawSmoothLine(ctx, data, "wpm", toX, toY, color, 2.5);

    // Draw dots at data points
    ctx.fillStyle = color;
    for (var d = 0; d < points.length; d++) {
      ctx.beginPath();
      ctx.arc(points[d].x, points[d].y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Calculate a "nice" step value for chart grid lines.
   */
  function calculateNiceStep(range, targetLines) {
    if (range <= 0) return 1;
    var rough = range / targetLines;
    var magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    var normalized = rough / magnitude;

    var niceStep;
    if (normalized <= 1.5)      niceStep = 1;
    else if (normalized <= 3)   niceStep = 2;
    else if (normalized <= 7)   niceStep = 5;
    else                        niceStep = 10;

    return niceStep * magnitude;
  }

  /**
   * Convert hex color to rgba.
   */
  function hexToRgba(hex, alpha) {
    hex = hex.replace("#", "");
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
  }

  // =========================================================================
  // Settings Helpers
  // =========================================================================

  /**
   * Set the active button in a settings group.
   */
  function setActiveButton(container, activeBtn) {
    var buttons = container.querySelectorAll(".btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.remove("active");
    }
    activeBtn.classList.add("active");
  }

  // =========================================================================
  // Share
  // =========================================================================

  function onShare() {
    var results = Engine.getResults();
    var model = AIModels.getModel(settings.modelId) || AIModels.getDefaultModel();
    var comparison = AIModels.compareToHuman(results.tokensPerSecond, settings.modelId);

    var text =
      "Token Type Results\n" +
      "WPM: " + results.wpm + "\n" +
      "Tokens/s: " + results.tokensPerSecond.toFixed(1) + "\n" +
      "Accuracy: " + Math.round(results.accuracy) + "%\n" +
      "vs " + model.name + ": " + comparison.ratio + "x slower\n" +
      "Try it: " + window.location.href;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var originalText = dom.btnShare.innerHTML;
        dom.btnShare.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="20 6 9 17 4 12"></polyline>' +
          '</svg> copied!';
        setTimeout(function () {
          dom.btnShare.innerHTML = originalText;
        }, 2000);
      });
    }
  }

  // =========================================================================
  // Test Reset
  // =========================================================================

  function resetTest() {
    // Stop any running intervals
    if (liveUpdateInterval) {
      clearInterval(liveUpdateInterval);
      liveUpdateInterval = null;
    }

    // Initialize the engine with current settings
    var words = Engine.init({
      duration: settings.duration,
      mode: settings.mode,
      wordCount: settings.wordCount,
      onUpdate: null,   // we handle updates in onInput
      onFinish: function () {
        showResults();
      },
      onTick: function (tickData) {
        dom.liveTimer.textContent = tickData.timeRemaining;
      }
    });

    // Reset DOM state
    hideResults();
    hideLiveStats();
    dom.liveTimer.textContent = settings.duration;

    // Clear input
    dom.typingInput.value = "";
    dom.typingArea.classList.remove("typing-active");

    // Reset focus overlay
    dom.focusOverlay.classList.remove("hidden");
    var overlayText = dom.focusOverlay.querySelector(".focus-overlay-text");
    if (overlayText) {
      overlayText.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="focus-icon">' +
        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
        '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>' +
        '</svg> click here or start typing to focus';
    }

    // Render words
    renderWords(words);
  }

  // =========================================================================
  // Public API
  // =========================================================================

  return {
    init: init,
    resetTest: resetTest
  };

})();

// =========================================================================
// Auto-initialize on DOM ready
// =========================================================================

document.addEventListener("DOMContentLoaded", function () {
  window.TokenType.App.init();
});
