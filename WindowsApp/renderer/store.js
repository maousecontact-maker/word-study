'use strict';

/**
 * 앱 데이터 (Swift 버전의 SwiftData 모델을 대신함).
 * 전부 data.json 하나에 저장됩니다.
 *
 * - decks:         단어장 { id, name, createdAt, bestScore, hasPassed, passedAt, lastStudiedAt }
 * - words:         단어 { id, deckId, term, meaning, position, isWrong, wrongCount }
 * - testRecords:   전체 시험 기록 { id, deckId, date, mode, correctCount, totalCount, passed }
 * - savedProgress: 이어서 하기 { id, scope, mode, deckId, snapshot, updatedAt }
 */
const Mode = {
  typing: 'typing',
  quiz: 'quiz',
};
const modeTitle = (mode) => (mode === Mode.quiz ? '뜻 고르기 퀴즈' : '뜻 타이핑');

const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const now = () => new Date().toISOString();

const Store = {
  data: null,

  async load() {
    let raw = null;
    try {
      raw = JSON.parse((await window.storage.load()) || 'null');
    } catch {
      raw = null;
    }
    this.data = {
      decks: raw?.decks ?? [],
      words: raw?.words ?? [],
      testRecords: raw?.testRecords ?? [],
      savedProgress: raw?.savedProgress ?? [],
      settings: { autoSpeak: true, ...(raw?.settings ?? {}) },
    };
  },

  save() {
    window.storage.save(JSON.stringify(this.data));
  },

  // MARK: - 단어장

  decks() {
    return [...this.data.decks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  deck(id) {
    return id == null ? null : this.data.decks.find((d) => d.id === id) ?? null;
  },

  createDeck(name) {
    const deck = {
      id: newId(),
      name,
      createdAt: now(),
      bestScore: null,
      hasPassed: false,
      passedAt: null,
      lastStudiedAt: null,
    };
    this.data.decks.push(deck);
    return deck;
  },

  renameDeck(deck, name) {
    deck.name = name;
    this.save();
  },

  /** 단어장을 지우면 단어, 시험 기록, 이어서 하기 기록도 함께 삭제 */
  deleteDeck(deck) {
    const d = this.data;
    d.decks = d.decks.filter((x) => x.id !== deck.id);
    d.words = d.words.filter((x) => x.deckId !== deck.id);
    d.testRecords = d.testRecords.filter((x) => x.deckId !== deck.id);
    d.savedProgress = d.savedProgress.filter((x) => x.deckId !== deck.id);
    this.save();
  },

  /** 붙여넣은 단어를 저장합니다. deck이 null이면 새 단어장을 만듭니다. */
  importWords(deck, name, parsed) {
    const isNew = !deck;
    const target = deck ?? this.createDeck(name || '새 단어장');
    const positions = this.words(target.id).map((w) => w.position);
    const start = (positions.length ? Math.max(...positions) : -1) + 1;
    // 새 단어가 추가되면 그 단어까지 포함해서 다시 통과해야 합니다. (지난 시험 기록은 남겨둠)
    if (!isNew) {
      target.hasPassed = false;
      target.passedAt = null;
      target.bestScore = null;
    }
    parsed.forEach((item, offset) => {
      this.data.words.push({
        id: newId(),
        deckId: target.id,
        term: item.term,
        meaning: item.meaning,
        position: start + offset,
        isWrong: false,
        wrongCount: 0,
      });
    });
    this.save();
    return target;
  },

  /** 통과 기준 95% (부동소수점 오차를 피하려고 정수로 비교) */
  passes(correct, total) {
    return total > 0 && correct * 100 >= total * 95;
  },

  /** 전체 단어 시험 결과를 기록합니다. */
  recordTestResult(deck, correct, total, mode) {
    if (total <= 0) return;
    const passed = this.passes(correct, total);
    const record = { id: newId(), deckId: deck.id, date: now(), mode, correctCount: correct, totalCount: total, passed };
    this.data.testRecords.push(record);
    deck.bestScore = Math.max(deck.bestScore ?? 0, correct / total);
    if (passed && !deck.hasPassed) {
      deck.hasPassed = true;
      deck.passedAt = record.date;
    }
  },

  /** 최근 시험이 위로 오도록 정렬된 기록 */
  testRecords(deckId) {
    return this.data.testRecords.filter((r) => r.deckId === deckId).sort((a, b) => b.date.localeCompare(a.date));
  },

  // MARK: - 단어

  /** 붙여넣은 순서대로 정렬된 단어 목록 */
  words(deckId) {
    return this.data.words.filter((w) => w.deckId === deckId).sort((a, b) => a.position - b.position);
  },

  /** 오답 노트 (deckId가 null이면 모든 단어장) — 많이 틀린 순 */
  wrongWords(deckId = null) {
    return this.data.words
      .filter((w) => w.isWrong && (deckId == null || w.deckId === deckId))
      .sort((a, b) => b.wrongCount - a.wrongCount);
  },

  deleteWord(word) {
    this.data.words = this.data.words.filter((w) => w.id !== word.id);
    this.save();
  },

  wordLookup() {
    return new Map(this.data.words.map((w) => [w.id, w]));
  },

  // MARK: - 이어서 하기

  /** key: { scope: 'deck' | 'wrongNotes', mode, deckId } */
  findProgress(key) {
    return this.data.savedProgress.find(
      (p) => p.mode === key.mode && p.scope === key.scope && (p.deckId ?? null) === (key.deckId ?? null),
    );
  },

  resumableProgress(scope, deckId) {
    return this.data.savedProgress
      .filter((p) => p.scope === scope && (p.deckId ?? null) === (deckId ?? null))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  saveProgress(snapshot, key) {
    const existing = this.findProgress(key);
    if (existing) {
      existing.snapshot = snapshot;
      existing.updatedAt = now();
    } else {
      this.data.savedProgress.push({
        id: newId(),
        scope: key.scope,
        mode: key.mode,
        deckId: key.deckId ?? null,
        snapshot,
        updatedAt: now(),
      });
    }
    // 앱이 갑자기 꺼져도 남도록 바로 저장
    this.save();
  },

  clearProgress(key) {
    const existing = this.findProgress(key);
    if (!existing) return;
    this.data.savedProgress = this.data.savedProgress.filter((p) => p !== existing);
    this.save();
  },

  /** 저장된 진행 상태로 학습 화면을 다시 엽니다. 단어가 모두 지워졌으면 진행 상태도 지우고 null을 반환합니다. */
  resumeSession(progress) {
    const lookup = this.wordLookup();
    const snapshot = progress.snapshot;
    if (!snapshot || !snapshot.questionIDs.some((id) => lookup.has(id))) {
      this.data.savedProgress = this.data.savedProgress.filter((p) => p !== progress);
      this.save();
      return null;
    }
    const pick = (ids) => ids.map((id) => lookup.get(id)).filter(Boolean);
    return {
      mode: snapshot.mode,
      words: pick(snapshot.sessionWordIDs),
      pool: pick(snapshot.poolWordIDs),
      isReview: snapshot.isReviewSession,
      deck: this.deck(snapshot.deckID),
      progressKey: { scope: progress.scope, mode: progress.mode, deckId: progress.deckId ?? null },
      resumeSnapshot: snapshot,
    };
  },
};

/** 예: "전체 시험 · 15/87 완료", "오답 2회차 · 3/7 완료" */
function snapshotSummary(snapshot) {
  let phase;
  if (snapshot.isFullTest) phase = '전체 시험';
  else if (snapshot.round > 1) phase = `오답 ${snapshot.round}회차`;
  else phase = '오답 복습';
  const total = snapshot.questionIDs.length;
  return `${phase} · ${Math.min(snapshot.index, total)}/${total} 완료`;
}
