document.addEventListener("DOMContentLoaded", () => {
  // Check which page we are on and run the appropriate logic.
  if (document.getElementById("lenora-section")) {
    handleLandingPage();
  } else if (document.body.classList.contains("interview-page")) {
    // Note: The provided interview.html doesn't have this class.
    // This logic might be intended for a different version of the page.
    // I'll leave the handler here as it was in the original script.
    handleInterviewPage();
  }
});

// --- Small helper: default questions if backend doesn't provide any ---
function getDefaultQuestions() {
  return [
    "Tell me about a challenging project recently completed. What was the goal and outcome?",
    "Walk through the design of a REST API built recently. What trade-offs were considered?",
    "How is time complexity analyzed for a function that uses nested loops?",
    "Explain how to diagnose and fix a memory leak in a Node/JS or Python service.",
    "What is the difference between processes and threads, and when to use each?",
  ];
}

// --- LOGIC FOR THE LANDING PAGE (index.html) ---
function handleLandingPage() {
  // Scroll-to-reveal effect
  const lenoraSection = document.getElementById("lenora-section");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.remove("hidden");
          observer.unobserve(entry.target); // Optional: stop observing after reveal
        }
      });
    },
    { threshold: 0.1 }
  ); // Trigger when 10% of the section is visible

  if (lenoraSection) {
      observer.observe(lenoraSection);
  }

  // Form submission logic
  const resumeForm = document.getElementById("resume-form");
  const errorMessageDiv = document.getElementById("error-message");
  const loadingIndicator = document.getElementById("loading-indicator");

  // Tool selection logic
  const toolBtns = document.querySelectorAll(".tool-btn");
  const mainActionBtn = document.getElementById("main-action-btn");
  let selectedTool = "interview"; // Default selection

  toolBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      toolBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTool = btn.dataset.tool;

      // UPDATED: Logic to change the main button's text based on selection
      if (selectedTool === "ats") {
        mainActionBtn.querySelector("span").textContent = "Check Your Resume";
      } else if (selectedTool === "placement") {
        mainActionBtn.querySelector("span").textContent = "Explore Resources";
      } else { // Default to 'interview'
        mainActionBtn.querySelector("span").textContent = "Start AI Interview";
      }
    });
  });

  // UPDATED: Combined submit event listener to handle all three options
  resumeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    // Action 1: Redirect to ATS checker
    if (selectedTool === "ats") {
      window.location.href = "resumechecker.html";
      return; 
    }

    // Action 2: Redirect to Placement Resources
    if (selectedTool === "placement") {
      window.location.href = "placementresources.html";
      return;
    }

    // Action 3: Default action is to start the AI interview
    errorMessageDiv.textContent = "";
    loadingIndicator.style.display = "block";
    resumeForm.style.display = "none";

    try {
      // Call backend to generate questions
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "An unknown error occurred.");
      }

      const questions =
        Array.isArray(data.questions) && data.questions.length
          ? data.questions
          : getDefaultQuestions();

      // Store questions in sessionStorage to pass to the next page
      sessionStorage.setItem("interviewQuestions", JSON.stringify(questions));
      window.location.href = "/interview.html";

    } catch (error) {
      // Fallback: if API fails, proceed with default questions
      console.error("API error, using fallback questions:", error.message);
      const fallback = getDefaultQuestions();
      if (fallback.length) {
        sessionStorage.setItem("interviewQuestions", JSON.stringify(fallback));
        window.location.href = "/interview.html";
        return;
      }

      // If even fallback fails, show an error
      errorMessageDiv.textContent = `Error: ${error.message}`;
      loadingIndicator.style.display = "none";
      resumeForm.style.display = "flex";
    }
  });
}

// --- LOGIC FOR THE INTERVIEW PAGE (interview.html) ---
// This function remains unchanged.
function handleInterviewPage() {
  const interviewBox = document.getElementById("interview-box");
  const userAnswerInput = document.getElementById("user-answer");
  const submitBtn = document.getElementById("submit-answer-btn");
  const reportSection = document.getElementById("report-section");
  const userInputArea = document.getElementById("user-input-area");
  const loadingIndicator = document.getElementById("loading-indicator");
  const errorMessageDiv = document.getElementById("error-message");

  let initialQuestions = [];
  let conversationHistory = [];
  let allUserAnswers = [];
  let currentQuestionIndex = 0;

  // Start the interview process
  function startInterview() {
    const storedQuestions = sessionStorage.getItem("interviewQuestions");
    if (!storedQuestions) {
      initialQuestions = getDefaultQuestions();
    } else {
      initialQuestions = JSON.parse(storedQuestions);
    }
    askNextInitialQuestion();
  }

  function addMessageToBox(sender, message) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message");
    messageDiv.innerHTML = `<strong>${sender}:</strong><p>${message}</p>`;
    interviewBox.appendChild(messageDiv);
    interviewBox.scrollTop = interviewBox.scrollHeight;
  }

  function askNextInitialQuestion() {
    if (currentQuestionIndex < initialQuestions.length) {
      const question = initialQuestions[currentQuestionIndex];
      addMessageToBox("AI", question);
      conversationHistory.push({ role: "model", parts: [{ text: question }] });
      enableUserInput();
      currentQuestionIndex++;
    } else {
      endInterview();
    }
  }

  async function handleAnswerSubmission() {
    const answer = userAnswerInput.value.trim();
    if (!answer) return;

    disableUserInput();
    addMessageToBox("You", answer);
    allUserAnswers.push(answer);
    conversationHistory.push({ role: "user", parts: [{ text: answer }] });

    loadingIndicator.style.display = "block";
    try {
      const response = await fetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: conversationHistory }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const followUp = data.question;

      if (followUp === "[NEXT_QUESTION]") {
        askNextInitialQuestion();
      } else {
        addMessageToBox("AI", followUp);
        conversationHistory.push({
          role: "model",
          parts: [{ text: followUp }],
        });
        enableUserInput();
      }
    } catch (error) {
      errorMessageDiv.textContent = `Error: ${error.message}`;
      askNextInitialQuestion();
    } finally {
      loadingIndicator.style.display = "none";
    }
  }

  async function endInterview() {
    addMessageToBox(
      "AI",
      "Thank you for your answers. Generating your performance report now..."
    );
    userInputArea.classList.add("hidden");
    loadingIndicator.style.display = "block";

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: allUserAnswers }),
      });
      const report = await response.json();
      if (!response.ok) throw new Error(report.error);

      displayReport(report);
    } catch (error) {
      errorMessageDiv.textContent = `Error generating report: ${error.message}`;
    } finally {
      loadingIndicator.style.display = "none";
    }
  }

  function displayReport(report) {
    const reportContent = document.getElementById("report-content");
    reportContent.innerHTML = `
            <h3>Overall Score: ${report.overallScore || "N/A"} / 10</h3>
            <h3>Strengths:</h3>
            <p>${report.strengths || "N/A"}</p>
            <h3>Areas for Improvement:</h3>
            <p>${report.weaknesses || "N/A"}</p>
            <h3>Suggestions:</h3>
            <p>${report.suggestion || "N/A"}</p>
        `;
    reportSection.classList.remove("hidden");
  }

  function enableUserInput() {
    userAnswerInput.value = "";
    userAnswerInput.disabled = false;
    submitBtn.disabled = false;
    userAnswerInput.focus();
  }

  function disableUserInput() {
    userAnswerInput.disabled = true;
    submitBtn.disabled = true;
  }

  submitBtn.addEventListener("click", handleAnswerSubmission);
  userAnswerInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAnswerSubmission();
    }
  });

  startInterview();
}