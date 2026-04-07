const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const introScreen = document.querySelector(".intro-screen");
const introButton = document.querySelector(".intro-button");

if (introScreen) {
  document.body.classList.add("intro-open");

  window.setTimeout(() => {
    introScreen.classList.add("show-credits");
  }, 1700);

  if (introButton) {
    introButton.addEventListener("click", () => {
      introScreen.classList.add("is-hidden");
      document.body.classList.remove("intro-open");
    });
  }
}

const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxSource = document.getElementById("lightbox-source");
const imageTriggers = document.querySelectorAll(".image-trigger");
const closeLightboxTriggers = document.querySelectorAll("[data-close-lightbox]");

function openLightbox(image, caption, source, altText) {
  if (!lightbox || !lightboxImage || !lightboxCaption || !lightboxSource) {
    return;
  }

  lightboxImage.src = image;
  lightboxImage.alt = altText;
  lightboxCaption.textContent = caption;
  lightboxSource.href = source;
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  if (!lightbox || !lightboxImage || !lightboxCaption || !lightboxSource) {
    return;
  }

  lightbox.hidden = true;
  lightboxImage.src = "";
  lightboxImage.alt = "";
  lightboxCaption.textContent = "";
  lightboxSource.href = "#";
  document.body.classList.remove("lightbox-open");
}

imageTriggers.forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const image = trigger.dataset.image;
    const caption = trigger.dataset.caption;
    const source = trigger.dataset.source;
    const imageElement = trigger.querySelector("img");
    const altText = imageElement ? imageElement.alt : "صورة أرشيفية";

    openLightbox(image, caption, source, altText);
  });
});

closeLightboxTriggers.forEach((trigger) => {
  trigger.addEventListener("click", closeLightbox);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lightbox && !lightbox.hidden) {
    closeLightbox();
  }
});

const questionNumber = document.getElementById("quiz-question-number");
const questionTitle = document.getElementById("quiz-question");
const optionsContainer = document.getElementById("quiz-options");
const feedbackBox = document.getElementById("quiz-feedback");
const nextButton = document.getElementById("quiz-next");
const restartButton = document.getElementById("quiz-restart");
const resultBox = document.getElementById("quiz-result");
const progressFill = document.getElementById("quiz-progress-fill");
const progressText = document.getElementById("quiz-progress-text");

const quizQuestions = [
  {
    question: "ما الحدث الذي بدأ الحرب العالمية الثانية في أوروبا؟",
    options: [
      "غزو ألمانيا لبولندا",
      "هجوم اليابان على بيرل هاربر",
      "إنزال النورماندي",
      "مؤتمر يالطا",
    ],
    correctIndex: 0,
    explanation:
      "بداية الحرب في أوروبا كانت عندما غزت ألمانيا بولندا يوم 1 سبتمبر 1939.",
  },
  {
    question: "متى أعلنت بريطانيا وفرنسا الحرب على ألمانيا؟",
    options: [
      "3 سبتمبر 1939",
      "1 سبتمبر 1939",
      "8 مايو 1945",
      "22 يونيو 1941",
    ],
    correctIndex: 0,
    explanation:
      "بعد غزو بولندا بيومين أعلنت بريطانيا وفرنسا الحرب على ألمانيا في 3 سبتمبر 1939.",
  },
  {
    question: "ما المقصود بعملية بارباروسا؟",
    options: [
      "الهجوم الألماني على الاتحاد السوفيتي",
      "الهجوم الياباني على بيرل هاربر",
      "إنزال الحلفاء في فرنسا",
      "استسلام ألمانيا",
    ],
    correctIndex: 0,
    explanation:
      "عملية بارباروسا هي الهجوم الألماني الكبير على الاتحاد السوفيتي في 22 يونيو 1941.",
  },
  {
    question: "أي حدث أدخل الولايات المتحدة الحرب بشكل مباشر؟",
    options: [
      "هجوم بيرل هاربر",
      "معركة ستالينغراد",
      "معركة بريطانيا",
      "سقوط فرنسا",
    ],
    correctIndex: 0,
    explanation:
      "بعد هجوم اليابان على بيرل هاربر في 7 ديسمبر 1941 دخلت الولايات المتحدة الحرب بشكل مباشر.",
  },
  {
    question: "ما المعركة التي تعد نقطة تحول كبرى ضد ألمانيا على الجبهة الشرقية؟",
    options: [
      "ستالينغراد",
      "دونكيرك",
      "يالطا",
      "بيرل هاربر",
    ],
    correctIndex: 0,
    explanation:
      "معركة ستالينغراد كانت من أهم نقاط التحول لأنها أوقفت التقدم الألماني وبدأ بعدها التراجع.",
  },
  {
    question: "ماذا كان إنزال النورماندي؟",
    options: [
      "عملية إنزال كبرى للحلفاء في فرنسا",
      "غزو ألمانيا لبولندا",
      "مؤتمر لتقسيم أوروبا",
      "هجوم جوي على بريطانيا",
    ],
    correctIndex: 0,
    explanation:
      "إنزال النورماندي في 6 يونيو 1944 فتح جبهة مهمة في غرب أوروبا وساعد على تحرير فرنسا.",
  },
  {
    question: "متى انتهت الحرب في أوروبا؟",
    options: [
      "8 مايو 1945",
      "15 أغسطس 1945",
      "2 سبتمبر 1945",
      "6 يونيو 1944",
    ],
    correctIndex: 0,
    explanation:
      "استسلام ألمانيا أنهى الحرب في أوروبا يوم 8 مايو 1945.",
  },
  {
    question: "متى انتهت الحرب العالمية الثانية رسميًا على مستوى العالم؟",
    options: [
      "2 سبتمبر 1945",
      "8 مايو 1945",
      "1 سبتمبر 1939",
      "7 ديسمبر 1941",
    ],
    correctIndex: 0,
    explanation:
      "النهاية الرسمية عالميًا كانت في 2 سبتمبر 1945 بعد توقيع استسلام اليابان رسميًا.",
  },
];

if (
  questionNumber &&
  questionTitle &&
  optionsContainer &&
  feedbackBox &&
  nextButton &&
  restartButton &&
  resultBox &&
  progressFill &&
  progressText
) {
  let currentQuestionIndex = 0;
  let score = 0;
  let locked = false;

  function updateProgress() {
    const progress = ((currentQuestionIndex + 1) / quizQuestions.length) * 100;
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `التقدم ${Math.round(progress)}%`;
  }

  function renderQuestion() {
    locked = false;
    nextButton.hidden = true;
    feedbackBox.hidden = true;
    feedbackBox.textContent = "";
    resultBox.hidden = true;
    resultBox.innerHTML = "";

    const current = quizQuestions[currentQuestionIndex];
    questionNumber.textContent = `السؤال ${currentQuestionIndex + 1} من ${quizQuestions.length}`;
    questionTitle.textContent = current.question;
    optionsContainer.innerHTML = "";

    current.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiz-option";
      button.textContent = option;
      button.addEventListener("click", () => handleAnswer(index));
      optionsContainer.appendChild(button);
    });

    updateProgress();
  }

  function handleAnswer(selectedIndex) {
    if (locked) {
      return;
    }

    locked = true;
    const current = quizQuestions[currentQuestionIndex];
    const optionButtons = Array.from(document.querySelectorAll(".quiz-option"));

    optionButtons.forEach((button, index) => {
      button.disabled = true;

      if (index === current.correctIndex) {
        button.classList.add("correct");
      }

      if (index === selectedIndex && index !== current.correctIndex) {
        button.classList.add("wrong");
      }
    });

    if (selectedIndex === current.correctIndex) {
      score += 1;
      feedbackBox.innerHTML = `<strong>إجابة صحيحة.</strong><p>${current.explanation}</p>`;
    } else {
      feedbackBox.innerHTML = `<strong>إجابة تحتاج مراجعة.</strong><p>${current.explanation}</p>`;
    }

    feedbackBox.hidden = false;
    nextButton.hidden = false;
    nextButton.textContent =
      currentQuestionIndex === quizQuestions.length - 1
        ? "اعرض النتيجة"
        : "السؤال التالي";
  }

  function showResult() {
    const percentage = Math.round((score / quizQuestions.length) * 100);
    let message = "";

    if (score === quizQuestions.length) {
      message = "ممتاز جدًا. واضح أنك فاهم الدرس والتسلسل الزمني بشكل ممتاز.";
    } else if (score >= 6) {
      message = "نتيجة قوية جدًا. لديك فهم واضح للأحداث الأساسية.";
    } else if (score >= 4) {
      message = "النتيجة جيدة، لكن راجع صفحة التسلسل الزمني وصفحة التفاصيل مرة ثانية.";
    } else {
      message = "من الأفضل مراجعة الصفحات السابقة بهدوء ثم إعادة الاختبار.";
    }

    resultBox.innerHTML = `
      <strong>${score} / ${quizQuestions.length}</strong>
      <p>نسبتك ${percentage}%</p>
      <p>${message}</p>
    `;
    resultBox.hidden = false;
    nextButton.hidden = true;
  }

  nextButton.addEventListener("click", () => {
    if (currentQuestionIndex === quizQuestions.length - 1) {
      showResult();
      return;
    }

    currentQuestionIndex += 1;
    renderQuestion();
  });

  restartButton.addEventListener("click", () => {
    currentQuestionIndex = 0;
    score = 0;
    renderQuestion();
  });

  renderQuestion();
}
