'use strict';

function shuffled(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 퀴즈와 타이핑이 함께 쓰는 학습 진행 로직.
 * 전체 시험 → 틀린 것만 회차 반복 → 다 맞히면 다시 전체 시험, 그리고 이어서 하기 저장까지 담당합니다.
 *
 * session: { mode, words, pool, isReview, deck, progressKey, resumeSnapshot? }
 */
class StudyEngine {
  pool = [];
  questions = [];
  index = 0;
  round = 1;
  correctCount = 0;
  wrongWords = [];
  /** 지금 회차가 단어장 전체 시험인지 (통과 판정 대상) */
  isFullTest = false;
  /** 지금 오답 복습 중인지 → 맞히면 오답 노트에서 빠짐 */
  isReviewing = false;
  hasStarted = false;
  /** 새 문제가 화면에 나올 때마다 바뀌는 값 (보기 섞기, 발음 재생 등에 사용) */
  questionToken = 0;

  #deck = null;
  #sessionWords = [];
  #isReviewSession = false;
  #mode = Mode.typing;
  #progressKey = null;
  /** "정답으로 처리"로 되돌릴 때 쓰는, 채점 직전의 오답 노트 상태 */
  #previousIsWrong = false;
  /** 이번 회차 결과를 이미 기록했는지 */
  #isRoundRecorded = false;

  get currentWord() {
    return this.questions[this.index] ?? null;
  }

  get isLastQuestion() {
    return this.index + 1 >= this.questions.length;
  }

  /** 화면이 처음 나타날 때 한 번 호출. 저장된 진행 상태가 있으면 그 위치부터 이어서 합니다. */
  begin(session) {
    if (this.hasStarted) return;
    this.#sessionWords = session.words;
    this.pool = session.pool;
    this.#deck = session.deck;
    this.#isReviewSession = session.isReview;
    this.#mode = session.mode;
    this.#progressKey = session.progressKey;

    if (session.resumeSnapshot && this.#restore(session.resumeSnapshot)) return;
    this.startSession();
  }

  // MARK: - 회차 진행

  /** 틀린 게 있으면 틀린 것만 다시, 오답을 다 맞혔으면 전체 시험 */
  get nextStep() {
    if (this.wrongWords.length) {
      return { kind: 'retryWrong', count: this.wrongWords.length, round: this.round + 1 };
    }
    if (!this.isFullTest && this.#deck) {
      return { kind: 'fullTest', count: this.#fullTestWords.length };
    }
    return null;
  }

  performNextStep() {
    if (this.wrongWords.length) {
      this.isFullTest = false;
      this.#start(this.wrongWords, this.round + 1);
    } else {
      this.#startFullTest();
    }
  }

  /** 처음부터: 오답 노트면 오답 복습부터, 아니면 전체 시험부터 */
  startSession() {
    if (this.#isReviewSession) {
      this.isReviewing = true;
      this.isFullTest = false;
      this.#start(this.#sessionWords);
    } else {
      this.#startFullTest();
    }
  }

  get #fullTestWords() {
    return this.#deck ? Store.words(this.#deck.id) : this.#sessionWords;
  }

  #startFullTest() {
    this.isReviewing = false;
    this.isFullTest = this.#deck != null;
    this.#start(this.#fullTestWords);
  }

  #start(list, round = 1) {
    this.round = round;
    this.questions = shuffled(list);
    this.index = 0;
    this.correctCount = 0;
    this.wrongWords = [];
    this.#isRoundRecorded = false;
    this.hasStarted = true;
    this.questionToken += 1;
    this.#saveProgress(false);
  }

  // MARK: - 채점

  recordAnswer(word, correct) {
    this.#previousIsWrong = word.isWrong;
    // 전체 오답 노트에서 풀어도 각 단어의 단어장에 학습 날짜가 남도록
    const deck = Store.deck(word.deckId);
    if (deck) deck.lastStudiedAt = now();
    if (correct) {
      this.correctCount += 1;
      if (this.isReviewing) word.isWrong = false;
    } else {
      word.isWrong = true;
      word.wrongCount += 1;
      this.wrongWords.push(word);
    }
    this.#saveProgress(true);
  }

  /** 방금 틀림 처리된 답을 정답으로 바꿉니다. */
  overrideAsCorrect(word) {
    word.wrongCount = Math.max(0, word.wrongCount - 1);
    word.isWrong = this.isReviewing ? false : this.#previousIsWrong;
    this.wrongWords = this.wrongWords.filter((w) => w.id !== word.id);
    this.correctCount += 1;
    this.#saveProgress(true);
  }

  advance() {
    this.index += 1;
    if (this.index >= this.questions.length) {
      this.#finishRound();
    } else {
      this.questionToken += 1;
      this.#saveProgress(false);
    }
  }

  #finishRound() {
    // 이어서 하기로 결과 화면이 다시 열려도 시험 기록이 두 번 남지 않도록
    if (this.isFullTest && !this.#isRoundRecorded && this.#deck) {
      Store.recordTestResult(this.#deck, this.correctCount, this.questions.length, this.#mode);
    }
    this.#isRoundRecorded = true;
    // 더 할 게 없으면 이어서 하기 기록 삭제
    if (this.nextStep == null) {
      this.#clearProgress();
    } else {
      this.#saveProgress(false);
    }
  }

  // MARK: - 이어서 하기 저장/복원

  /** answered: 지금 문제에 이미 답했으면 true → 이어서 할 때 다음 문제부터 */
  #saveProgress(answered) {
    if (!this.#progressKey || !this.questions.length) {
      Store.save();
      return;
    }
    const ids = (list) => list.map((w) => w.id);
    const snapshot = {
      mode: this.#mode,
      isReviewSession: this.#isReviewSession,
      isReviewing: this.isReviewing,
      isFullTest: this.isFullTest,
      round: this.round,
      index: answered ? this.index + 1 : this.index,
      correctCount: this.correctCount,
      sessionWordIDs: ids(this.#sessionWords),
      poolWordIDs: ids(this.pool),
      questionIDs: ids(this.questions),
      wrongWordIDs: ids(this.wrongWords),
      deckID: this.#deck?.id ?? null,
      isRoundRecorded: this.#isRoundRecorded,
    };
    Store.saveProgress(snapshot, this.#progressKey);
  }

  #clearProgress() {
    if (this.#progressKey) Store.clearProgress(this.#progressKey);
    Store.save();
  }

  #restore(snapshot) {
    const lookup = Store.wordLookup();
    const restored = snapshot.questionIDs.map((id) => lookup.get(id)).filter(Boolean);
    if (!restored.length) return false;

    // 그사이 지워진 단어가 있으면 그만큼 위치를 당겨줍니다.
    const missingBefore = snapshot.questionIDs.slice(0, snapshot.index).filter((id) => !lookup.has(id)).length;
    this.questions = restored;
    this.index = Math.min(Math.max(0, snapshot.index - missingBefore), restored.length);
    this.round = snapshot.round;
    this.correctCount = snapshot.correctCount;
    this.wrongWords = snapshot.wrongWordIDs.map((id) => lookup.get(id)).filter(Boolean);
    this.isFullTest = snapshot.isFullTest;
    this.isReviewing = snapshot.isReviewing;
    this.#isRoundRecorded = snapshot.isRoundRecorded ?? false;
    this.hasStarted = true;
    this.questionToken += 1;

    if (this.index >= this.questions.length) this.#finishRound();
    return true;
  }
}
