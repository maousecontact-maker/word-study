'use strict';

// MARK: - DOM 도우미

/** h('div', { class: 'x', onClick: fn }, ...children) — 사용자 텍스트는 항상 textContent로 들어가서 안전합니다. */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || (value === false && !(key in el))) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const fmtDay = (iso) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(iso));
const fmtDayTime = (iso) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
/** 94.7%가 95%로 반올림돼 보이지 않도록 내림 */
const percentOf = (correct, total) => (total === 0 ? 0 : Math.floor((correct * 100) / total));

// MARK: - 발음

/**
 * 1순위: 영어 사전(dictionaryapi.dev)에 있는 원어민 녹음 (미국식 우선)
 * 2순위: 녹음이 없거나 인터넷이 안 되면 Windows의 영어 음성
 * 한국어판 Windows에 영어 음성이 없으면 한국어 음성이 영어를 읽게 되므로 설치 방법을 한 번 알려줍니다.
 */
const Speaker = {
  voice: null,
  audio: null,
  /** 단어 → 녹음 주소 (녹음이 없으면 null). 같은 단어를 다시 물어보지 않도록 기억해 둡니다. */
  recordings: new Map(),
  /** 마지막 speak() 호출 번호. 녹음을 받는 사이 다른 단어를 누르면 이전 것은 재생하지 않습니다. */
  token: 0,
  hasWarnedNoVoice: false,

  pickVoice() {
    const english = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('en'));
    this.voice =
      english.find((v) => v.lang.replace('_', '-') === 'en-US' && v.localService) ??
      english.find((v) => v.localService) ??
      english[0] ??
      null;
  },

  stop() {
    this.token += 1;
    speechSynthesis.cancel();
    this.audio?.pause();
    this.audio = null;
  },

  async speak(text) {
    this.stop();
    const token = this.token;
    const url = await this.recordingFor(text);
    if (token !== this.token) return;
    if (url) {
      this.audio = new Audio(url);
      try {
        await this.audio.play();
        return;
      } catch {
        // 재생 실패 → 아래 음성으로
      }
    }
    this.speakWithVoice(text);
  },

  speakWithVoice(text) {
    if (!this.voice) this.pickVoice();
    if (!this.voice) this.warnNoEnglishVoice();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  },

  /** 다음 문제 발음을 미리 받아둬서 넘어갈 때 바로 재생되게 합니다. */
  prefetch(text) {
    if (text) this.recordingFor(text);
  },

  recordingFor(text) {
    const key = text.trim().toLowerCase();
    if (!key || key.length > 40 || !/^[a-z' -]+$/.test(key)) return Promise.resolve(null);
    if (!this.recordings.has(key)) this.recordings.set(key, this.fetchRecording(key));
    return this.recordings.get(key);
  },

  async fetchRecording(key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const urls = (await response.json())
        .flatMap((entry) => entry.phonetics ?? [])
        .map((p) => p.audio)
        .filter((url) => url?.startsWith('https://'));
      return urls.find((url) => url.endsWith('-us.mp3')) ?? urls[0] ?? null;
    } catch {
      // 인터넷이 없거나 느리면 다음에 다시 시도
      this.recordings.delete(key);
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  warnNoEnglishVoice() {
    if (this.hasWarnedNoVoice) return;
    this.hasWarnedNoVoice = true;
    showToast(
      '사전에 녹음이 없는 단어는 Windows 음성으로 읽는데, 영어 음성이 설치돼 있지 않아요. ' +
        '설정 → 시간 및 언어 → 음성 → "음성 추가"에서 English (United States)를 설치하면 원어민 발음으로 읽어요.',
    );
  },
};
speechSynthesis.addEventListener('voiceschanged', () => Speaker.pickVoice());

function showToast(message) {
  const toast = h('div', { class: 'toast', role: 'status', onClick: () => toast.remove() }, message);
  document.body.append(toast);
  setTimeout(() => toast.remove(), 12000);
}

const speakButton = (text) =>
  h('button', {
    class: 'icon-button speak',
    title: '발음 듣기',
    'aria-label': '발음 듣기',
    onClick: (e) => {
      e.stopPropagation();
      Speaker.speak(text);
    },
  }, '🔊');

// MARK: - 화면 이동

const $app = document.getElementById('app');
const stack = [{ type: 'home' }];
/** 지금 화면을 떠날 때 정리할 것 (카운트다운 타이머 등) */
let cleanup = null;

const current = () => stack[stack.length - 1];

function push(screen) {
  stack.push(screen);
  render();
}

function pop() {
  if (stack.length > 1) stack.pop();
  Speaker.stop();
  render();
}

function render() {
  cleanup?.();
  cleanup = null;
  const screen = current();
  const scrollTop = screen.keepScroll ? document.scrollingElement.scrollTop : 0;
  $app.replaceChildren(Screens[screen.type](screen));
  document.scrollingElement.scrollTop = scrollTop;
  screen.keepScroll = false;
  const focusTarget = $app.querySelector('[data-focus]');
  if (focusTarget) {
    focusTarget.focus();
    if (focusTarget.setSelectionRange) focusTarget.setSelectionRange(focusTarget.value.length, focusTarget.value.length);
  }
}

/** 같은 화면을 스크롤 위치를 유지한 채 다시 그립니다. */
function refresh() {
  current().keepScroll = true;
  render();
}

document.addEventListener('keydown', (e) => {
  if (modal) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  closeContextMenu();
  if (e.key === 'Escape' && stack.length > 1) {
    pop();
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  current().onKey?.(e);
});

// MARK: - 공통 레이아웃

function header({ title, back = stack.length > 1, actions = [] }) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-side' },
      back && h('button', { class: 'text-button back', onClick: pop }, '‹ 뒤로'),
    ),
    h('h1', { class: 'topbar-title' }, title),
    h('div', { class: 'topbar-side end' }, actions),
  );
}

const page = (...children) => h('div', { class: 'page' }, h('main', { class: 'content' }, children));

function section({ title, footer, className } = {}, ...rows) {
  return h('section', { class: `section ${className ?? ''}` },
    title && h('h2', { class: 'section-title' }, title),
    h('div', { class: 'group' }, rows),
    footer && h('p', { class: 'section-footer' }, footer),
  );
}

function row({ icon, title, subtitle, badge, onClick, disabled, trailing, className, onContextMenu }) {
  const content = [
    icon && h('span', { class: 'row-icon' }, icon),
    h('div', { class: 'row-body' },
      h('div', { class: 'row-title' }, title),
      subtitle,
    ),
    badge ? h('span', { class: 'badge' }, badge) : null,
    trailing,
    onClick && h('span', { class: 'chevron' }, '›'),
  ];
  return onClick
    ? h('button', { class: `row clickable ${className ?? ''}`, onClick, disabled, onContextMenu }, content)
    : h('div', { class: `row ${className ?? ''}` }, content);
}

function emptyState(icon, title, description, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon),
    h('h2', null, title),
    description && h('p', null, description),
    action,
  );
}

function deckStatusLabel(deck) {
  const best = Math.floor((deck.bestScore ?? 0) * 100);
  if (deck.hasPassed) {
    // 예: "11월 2일 통과 · 최고 97%"
    const date = deck.passedAt ? `${fmtDay(deck.passedAt)} ` : '';
    return h('span', { class: 'status pass' }, `✔ ${date}통과 · 최고 ${best}%`);
  }
  if (deck.bestScore != null) {
    return h('span', { class: 'status fail' }, `○ 미통과 · 최고 ${best}%`);
  }
  return h('span', { class: 'status muted' }, '○ 아직 시험 전');
}

/** 단어 목록 한 줄: 발음 버튼 + 단어 + 뜻 + 틀린 횟수 */
function wordRow(word, { showsDeck = false, action } = {}) {
  const deckName = showsDeck ? Store.deck(word.deckId)?.name : null;
  return h('div', { class: 'row word-row' },
    speakButton(word.term),
    h('div', { class: 'row-body' },
      h('div', { class: 'row-title' }, word.term),
      h('div', { class: 'secondary' }, word.meaning),
      deckName && h('div', { class: 'caption tertiary' }, deckName),
    ),
    word.wrongCount > 0 &&
      h('span', { class: `wrong-count ${word.isWrong ? 'red' : ''}`, title: `${word.wrongCount}번 틀림` }, `✕ ${word.wrongCount}`),
    action,
  );
}

function resumeRows(progressList, onResume) {
  return progressList.map((progress) =>
    row({
      icon: '▶',
      title: `이어서 하기 · ${modeTitle(progress.mode)}`,
      subtitle: progress.snapshot && h('div', { class: 'secondary' }, snapshotSummary(progress.snapshot)),
      onClick: () => onResume(progress),
      className: 'accent',
    }),
  );
}

function openSession(session) {
  if (session) push({ type: 'study', session, engine: new StudyEngine(), ui: {} });
  else refresh();
}

// MARK: - 팝업 창

let modal = null;

function openModal(build) {
  closeModal();
  const overlay = h('div', {
    class: 'overlay',
    onMousedown: (e) => {
      if (e.target === overlay) closeModal();
    },
  });
  overlay.append(h('div', { class: 'modal', role: 'dialog' }, build(closeModal)));
  document.body.append(overlay);
  modal = overlay;
  overlay.querySelector('[data-focus]')?.focus();
}

function closeModal() {
  modal?.remove();
  modal = null;
}

function confirmModal({ title, message, confirmTitle, onConfirm }) {
  openModal((close) =>
    h('div', { class: 'dialog' },
      h('h2', null, title),
      message && h('p', { class: 'secondary' }, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'button', onClick: close }, '취소'),
        h('button', {
          class: 'button destructive',
          'data-focus': true,
          onClick: () => {
            close();
            onConfirm();
          },
        }, confirmTitle),
      ),
    ),
  );
}

function renameDeck(deck) {
  openModal((close) => {
    const input = h('input', { class: 'field', value: deck.name, placeholder: '단어장 이름', 'data-focus': true });
    const save = () => {
      const name = input.value.trim();
      if (!name) return;
      Store.renameDeck(deck, name);
      close();
      refresh();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) save();
    });
    return h('div', { class: 'dialog' },
      h('h2', null, '단어장 이름 바꾸기'),
      input,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'button', onClick: close }, '취소'),
        h('button', { class: 'button primary', onClick: save }, '저장'),
      ),
    );
  });
}

function deleteDeck(deck, after) {
  confirmModal({
    title: `'${deck.name}' 단어장을 삭제할까요?`,
    message: '단어, 오답 노트, 시험 기록이 모두 지워져요.',
    confirmTitle: '삭제',
    onConfirm: () => {
      Store.deleteDeck(deck);
      after();
    },
  });
}

/** 단어 표를 붙여넣어 새 단어장을 만들거나(deck = null) 기존 단어장에 단어를 추가하는 창 */
function openImport(deck = null) {
  openModal((close) => {
    const nameInput = !deck && h('input', { class: 'field', placeholder: '예: Lesson 3 - Brain Foods', 'data-focus': true });
    const textArea = h('textarea', {
      class: 'field mono',
      rows: 9,
      placeholder: '| apple | 사과 |\nbanana - 바나나\ncherry\t체리',
      'data-focus': deck ? true : null,
      spellcheck: false,
    });
    const preview = h('div', { class: 'preview' });
    const saveButton = h('button', { class: 'button primary', disabled: true }, '저장');
    let parsed = [];

    const update = () => {
      parsed = WordParser.parse(textArea.value);
      saveButton.disabled = parsed.length === 0;
      preview.replaceChildren(
        parsed.length
          ? section({ title: `미리보기 · ${parsed.length}개 인식됨` },
              parsed.map((w) =>
                h('div', { class: 'row preview-row' },
                  h('strong', null, w.term),
                  h('span', { class: 'secondary' }, w.meaning),
                ),
              ),
            )
          : '',
      );
    };
    textArea.addEventListener('input', update);

    saveButton.addEventListener('click', () => {
      if (!parsed.length) return;
      const target = Store.importWords(deck, nameInput ? nameInput.value.trim() : '', parsed);
      close();
      if (deck) refresh();
      else push({ type: 'deck', deckId: target.id });
    });

    const pasteButton = h('button', {
      class: 'button small',
      onClick: async () => {
        try {
          textArea.value = await navigator.clipboard.readText();
          update();
        } catch {
          textArea.focus();
        }
      },
    }, '📋 클립보드에서 붙여넣기');

    return h('div', { class: 'dialog wide' },
      h('h2', null, deck ? '단어 추가' : '새 단어장'),
      nameInput && h('label', { class: 'label' }, '단어장 이름'),
      nameInput,
      h('div', { class: 'label-row' }, h('label', { class: 'label' }, '단어 붙여넣기'), pasteButton),
      textArea,
      h('p', { class: 'section-footer' }, "표(| 영어 | 뜻 |), 엑셀·구글 시트·퀴즐렛에서 복사한 내용, 'apple - 사과' 형식을 인식해요."),
      preview,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'button', onClick: close }, '취소'),
        saveButton,
      ),
    );
  });
}

// MARK: - 오른쪽 클릭 메뉴

let contextMenu = null;

function showContextMenu(e, items) {
  e.preventDefault();
  closeContextMenu();
  contextMenu = h('div', { class: 'context-menu' },
    items.map((item) =>
      h('button', {
        class: item.destructive ? 'destructive' : '',
        onClick: () => {
          closeContextMenu();
          item.action();
        },
      }, item.title),
    ),
  );
  document.body.append(contextMenu);
  const { innerWidth, innerHeight } = window;
  const rect = contextMenu.getBoundingClientRect();
  contextMenu.style.left = `${Math.min(e.clientX, innerWidth - rect.width - 8)}px`;
  contextMenu.style.top = `${Math.min(e.clientY, innerHeight - rect.height - 8)}px`;
}

function closeContextMenu() {
  contextMenu?.remove();
  contextMenu = null;
}
document.addEventListener('mousedown', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) closeContextMenu();
});

// MARK: - 화면들

const Screens = {
  home() {
    const decks = Store.decks();
    const wrongCount = Store.wrongWords().length;
    const top = header({
      title: '내 단어장',
      actions: h('button', { class: 'button primary small', onClick: () => openImport() }, '+ 새 단어장'),
    });

    if (!decks.length) {
      return h('div', null, top, page(
        emptyState('📕', '단어장이 없어요', '단어 표를 붙여넣으면 단어장이 자동으로 만들어져요.',
          h('button', { class: 'button primary', onClick: () => openImport() }, '단어장 만들기')),
      ));
    }

    return h('div', null, top, page(
      section({},
        row({
          icon: '⚠️',
          title: '전체 오답 노트',
          badge: wrongCount || null,
          onClick: () => push({ type: 'wrong', deckId: null }),
        }),
      ),
      section({ title: '단어장', footer: '오른쪽 클릭으로 이름을 바꾸거나 삭제할 수 있어요.' },
        decks.map((deck) =>
          row({
            title: deck.name,
            subtitle: [
              h('div', { class: 'secondary' }, `단어 ${Store.words(deck.id).length}개`),
              h('div', { class: 'caption' }, deckStatusLabel(deck)),
              deck.lastStudiedAt && h('div', { class: 'caption secondary' }, `마지막 학습 ${fmtDay(deck.lastStudiedAt)}`),
            ],
            onClick: () => push({ type: 'deck', deckId: deck.id }),
            onContextMenu: (e) =>
              showContextMenu(e, [
                { title: '✎ 이름 바꾸기', action: () => renameDeck(deck) },
                { title: '🗑 삭제', destructive: true, action: () => deleteDeck(deck, refresh) },
              ]),
          }),
        ),
      ),
    ));
  },

  deck(screen) {
    const deck = Store.deck(screen.deckId);
    if (!deck) {
      stack.pop();
      return Screens[current().type](current());
    }
    const words = Store.words(deck.id);
    const records = Store.testRecords(deck.id);
    const resumable = Store.resumableProgress('deck', deck.id);
    const wrongCount = words.filter((w) => w.isWrong).length;

    /** 새로 시작 (같은 방식으로 하던 진행 기록은 덮어씀) */
    const newSession = (mode) => ({
      mode,
      words,
      pool: words,
      isReview: false,
      deck,
      progressKey: { scope: 'deck', mode, deckId: deck.id },
    });

    return h('div', null,
      header({
        title: deck.name,
        actions: [
          h('button', { class: 'text-button', onClick: () => renameDeck(deck) }, '✎ 이름'),
          h('button', { class: 'text-button', onClick: () => openImport(deck) }, '+ 단어 추가'),
          h('button', { class: 'text-button destructive', onClick: () => deleteDeck(deck, pop) }, '삭제'),
        ],
      }),
      page(
        section({ footer: '전체 단어로 타이핑이나 퀴즈를 풀어서 95% 이상 맞히면 통과예요.' },
          h('div', { class: 'row' }, h('div', { class: 'row-title big' }, deckStatusLabel(deck))),
          deck.lastStudiedAt &&
            h('div', { class: 'row' },
              h('div', { class: 'row-body' }, '마지막 학습'),
              h('span', { class: 'secondary' }, fmtDayTime(deck.lastStudiedAt)),
            ),
        ),

        resumable.length > 0 &&
          section({ title: '하던 거 이어서' }, resumeRows(resumable, (p) => openSession(Store.resumeSession(p)))),

        section({},
          row({ icon: '⌨️', title: '뜻 타이핑', disabled: !words.length, onClick: () => openSession(newSession(Mode.typing)) }),
          row({ icon: '❓', title: '뜻 고르기 퀴즈', disabled: !words.length, onClick: () => openSession(newSession(Mode.quiz)) }),
          row({
            icon: '⚠️',
            title: '이 단어장 오답 노트',
            badge: wrongCount || null,
            disabled: !words.length,
            onClick: () => push({ type: 'wrong', deckId: deck.id }),
          }),
        ),

        records.length > 0 &&
          section({ title: `시험 기록 ${records.length}번` },
            records.map((r) =>
              h('div', { class: 'row' },
                h('div', { class: 'row-body' },
                  h('div', { class: 'row-title' }, fmtDayTime(r.date)),
                  h('div', { class: 'secondary' }, modeTitle(r.mode)),
                ),
                h('div', { class: 'record-score' },
                  h('div', { class: 'mono-digits' }, `${percentOf(r.correctCount, r.totalCount)}% (${r.correctCount}/${r.totalCount})`),
                  h('div', { class: `caption status ${r.passed ? 'pass' : 'fail'}` }, r.passed ? '✔ 통과' : '✕ 미통과'),
                ),
              ),
            ),
          ),

        section({ title: `단어 ${words.length}개` },
          words.length
            ? words.map((word) =>
                wordRow(word, {
                  action: h('button', {
                    class: 'icon-button delete',
                    title: '단어 삭제',
                    onClick: () => {
                      Store.deleteWord(word);
                      refresh();
                    },
                  }, '✕'),
                }),
              )
            : h('div', { class: 'row secondary' }, '단어가 없어요. 위의 “+ 단어 추가”로 넣어보세요.'),
        ),
      ),
    );
  },

  wrong(screen) {
    const deck = Store.deck(screen.deckId);
    const deckId = deck?.id ?? null;
    const wrongWords = Store.wrongWords(deckId);
    const pool = deck ? Store.words(deck.id) : Store.data.words;
    // 오답을 다 맞히고 전체 시험 중에 나갔을 수도 있으니 오답이 없어도 보여줍니다.
    const resumable = Store.resumableProgress('wrongNotes', deckId);

    // 오답을 다 맞힌 뒤 전체 시험을 볼 단어장.
    // 전체 오답 노트라도 오답이 모두 한 단어장 것이면 그 단어장으로 시험을 봅니다.
    const deckIds = new Set(wrongWords.map((w) => w.deckId));
    const testDeck = deck ?? (deckIds.size === 1 ? Store.deck([...deckIds][0]) : null);

    const newSession = (mode) => ({
      mode,
      words: wrongWords,
      pool,
      isReview: true,
      deck: testDeck,
      progressKey: { scope: 'wrongNotes', mode, deckId },
    });

    const top = header({ title: deck ? `${deck.name} 오답` : '전체 오답 노트' });

    if (!wrongWords.length && !resumable.length) {
      return h('div', null, top, page(emptyState('✅', '틀린 단어가 없어요', '퀴즈나 타이핑에서 틀린 단어가 여기에 모여요.')));
    }

    return h('div', null, top, page(
      resumable.length > 0 &&
        section({ title: '하던 거 이어서' }, resumeRows(resumable, (p) => openSession(Store.resumeSession(p)))),

      wrongWords.length > 0 && [
        section({
          footer: testDeck
            ? '틀린 것만 계속 다시 풀고, 다 맞히면 바로 전체 단어 시험으로 넘어가요. 맞힌 단어는 오답 노트에서 빠져요.'
            : '틀린 것만 계속 다시 풀어요. 여러 단어장의 오답이 섞여 있어서 전체 시험은 단어장별로 봐야 해요.',
        },
          row({ icon: '❓', title: '오답만 퀴즈 풀기', onClick: () => openSession(newSession(Mode.quiz)) }),
          row({ icon: '⌨️', title: '오답만 타이핑', onClick: () => openSession(newSession(Mode.typing)) }),
        ),
        section({ title: `틀린 단어 ${wrongWords.length}개` },
          wrongWords.map((word) =>
            wordRow(word, {
              showsDeck: !deck,
              action: h('button', {
                class: 'button small success',
                onClick: () => {
                  word.isWrong = false;
                  Store.save();
                  refresh();
                },
              }, '외웠어요'),
            }),
          ),
        ),
      ],
    ));
  },

  study(screen) {
    const { session, engine, ui } = screen;
    const isQuiz = session.mode === Mode.quiz;
    const settings = Store.data.settings;
    screen.onKey = null;

    const top = header({
      title: isQuiz ? (engine.isReviewing ? '오답 퀴즈' : '퀴즈') : engine.isReviewing ? '오답 타이핑' : '뜻 타이핑',
      actions: h('button', {
        class: `toggle ${settings.autoSpeak ? 'on' : ''}`,
        title: '새 문제가 나오면 자동으로 발음 읽기',
        onClick: () => {
          settings.autoSpeak = !settings.autoSpeak;
          Store.save();
          refresh();
        },
      }, settings.autoSpeak ? '🔊 자동 발음' : '🔇 자동 발음'),
    });

    // 보기를 만들려면 서로 다른 뜻이 최소 2개 필요합니다.
    if (isQuiz && new Set(session.pool.map((w) => w.meaning)).size < 2) {
      return h('div', null, top, page(emptyState('💬', '보기를 만들 수 없어요', '퀴즈를 풀려면 뜻이 다른 단어가 2개 이상 필요해요.')));
    }

    engine.begin(session);

    // 새 문제가 나왔을 때 한 번만 준비 (보기 섞기, 입력 비우기, 자동 발음)
    if (ui.token !== engine.questionToken) {
      ui.token = engine.questionToken;
      ui.selected = null;
      ui.input = '';
      ui.isCorrect = null;
      const word = engine.currentWord;
      if (word) {
        if (isQuiz) ui.choices = makeChoices(word, engine.pool);
        if (settings.autoSpeak) Speaker.speak(word.term);
        Speaker.prefetch(engine.questions[engine.index + 1]?.term);
      }
    }

    if (!engine.questions.length) {
      return h('div', null, top, page(emptyState('📭', '단어가 없어요')));
    }

    const word = engine.currentWord;
    const body = word
      ? isQuiz ? quizQuestion(screen, word) : typingQuestion(screen, word)
      : roundResult(screen);
    return h('div', null, top, page(body));
  },
};

// MARK: - 퀴즈 / 타이핑

function progressHeader(engine) {
  const position = `${engine.index + 1} / ${engine.questions.length}`;
  return h('div', { class: 'progress-wrap' },
    h('progress', { value: engine.index, max: engine.questions.length }),
    h('div', { class: 'secondary small' }, engine.round > 1 ? `${engine.round}회차 (오답) · ${position}` : position),
  );
}

function termCard(word) {
  return h('div', { class: 'term-card' },
    h('div', { class: 'term' }, word.term),
    speakButton(word.term),
  );
}

/** 정답 1개 + 같은 뜻이 아닌 오답 최대 3개를 섞어서 보기로 만듭니다. */
function makeChoices(word, pool) {
  const distractors = [];
  for (const candidate of shuffled(pool)) {
    if (candidate.meaning === word.meaning || distractors.includes(candidate.meaning)) continue;
    distractors.push(candidate.meaning);
    if (distractors.length === 3) break;
  }
  return shuffled([...distractors, word.meaning]);
}

function quizQuestion(screen, word) {
  const { engine, ui } = screen;

  const select = (choice) => {
    if (ui.selected != null) return;
    ui.selected = choice;
    engine.recordAnswer(word, choice === word.meaning);
    refresh();
  };
  const next = () => {
    engine.advance();
    render();
  };

  // 키보드: 1~4로 고르기, Enter로 다음
  screen.onKey = (e) => {
    const n = Number(e.key);
    if (ui.selected == null && n >= 1 && n <= ui.choices.length) select(ui.choices[n - 1]);
    else if (ui.selected != null && e.key === 'Enter') {
      e.preventDefault();
      next();
    }
  };

  return h('div', { class: 'study' },
    progressHeader(engine),
    termCard(word),
    h('div', { class: 'choices' },
      ui.choices.map((choice, i) => {
        let state = '';
        let mark = '';
        if (ui.selected != null) {
          if (choice === word.meaning) [state, mark] = ['correct', '✔'];
          else if (choice === ui.selected) [state, mark] = ['wrong', '✕'];
          else state = 'dim';
        }
        return h('button', { class: `choice ${state}`, disabled: ui.selected != null, onClick: () => select(choice) },
          h('span', { class: 'choice-key' }, i + 1),
          h('span', { class: 'choice-text' }, choice),
          mark && h('span', { class: 'choice-mark' }, mark),
        );
      }),
    ),
    ui.selected != null &&
      h('button', { class: 'button primary large', 'data-focus': true, onClick: next },
        engine.isLastQuestion ? '결과 보기' : '다음 (Enter)'),
  );
}

function typingQuestion(screen, word) {
  const { engine, ui } = screen;

  const input = h('input', {
    class: 'field large',
    placeholder: '뜻을 입력하고 Enter',
    value: ui.input,
    spellcheck: false,
    autocomplete: 'off',
    'data-focus': true,
  });

  const grade = (answer) => {
    const correct = AnswerChecker.isCorrect(answer, word.meaning);
    ui.isCorrect = correct;
    engine.recordAnswer(word, correct);
    refresh();
  };
  const next = () => {
    engine.advance();
    render();
  };

  input.addEventListener('input', () => {
    ui.input = input.value;
  });
  /** Enter: 채점 전이면 채점, 채점 후면 다음 문제로 */
  input.addEventListener('keydown', (e) => {
    // 한글 조합 중 Enter는 무시 (조합이 끝난 뒤의 Enter만 처리 — 두 번 채점되는 것 방지)
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    ui.input = input.value;
    if (ui.isCorrect != null) next();
    else if (ui.input.trim()) grade(ui.input);
  });

  let controls;
  if (ui.isCorrect == null) {
    controls = h('div', { class: 'button-row' },
      h('button', { class: 'button large', onClick: () => grade('') }, '모르겠어요'),
      h('button', {
        class: 'button primary large',
        onClick: () => {
          ui.input = input.value;
          if (ui.input.trim()) grade(ui.input);
          else input.focus();
        },
      }, '확인'),
    );
  } else {
    const ok = ui.isCorrect;
    controls = h('div', { class: `feedback ${ok ? 'correct' : 'wrong'}` },
      h('div', { class: 'feedback-title' }, ok ? '✔ 정답!' : '✕ 틀렸어요'),
      h('div', { class: 'feedback-answer' }, `정답: ${word.meaning}`),
      h('div', { class: 'button-row' },
        // 비슷한 말로 적었는데 틀림 처리됐을 때 직접 정답으로 바꿀 수 있게
        !ok && ui.input.trim() &&
          h('button', {
            class: 'button large',
            onClick: () => {
              engine.overrideAsCorrect(word);
              ui.isCorrect = true;
              refresh();
            },
          }, '정답으로 처리'),
        h('button', { class: 'button primary large', onClick: next }, engine.isLastQuestion ? '결과 보기' : '다음 (Enter)'),
      ),
    );
  }

  return h('div', { class: 'study' }, progressHeader(engine), termCard(word), input, controls);
}

// MARK: - 회차 결과

const AUTO_START_SECONDS = 5;

/**
 * 한 회차가 끝났을 때의 결과 화면.
 * 틀린 단어 다시 풀기는 몇 초 뒤 자동으로 시작하고,
 * 전체 시험은 마음의 준비를 할 수 있도록 버튼을 직접 눌러야 시작합니다.
 */
function roundResult(screen) {
  const { engine, ui } = screen;
  const total = engine.questions.length;
  const correct = engine.correctCount;
  const wrongWords = engine.wrongWords;
  const step = engine.nextStep;
  const autoStarts = step?.kind === 'retryWrong';
  const showsPass = engine.isFullTest;
  const passed = Store.passes(correct, total);

  // 결과 화면이 새로 열릴 때마다 카운트다운 초기화
  const resultKey = `${engine.round}-${engine.questionToken}`;
  if (ui.resultKey !== resultKey) {
    ui.resultKey = resultKey;
    ui.countdown = AUTO_START_SECONDS;
    ui.autoStopped = false;
  }

  const goNext = () => {
    engine.performNextStep();
    render();
  };
  const restart = () => {
    engine.startSession();
    render();
  };

  // 전체 시험은 마지막 답을 Enter로 넘기다 실수로 시작되지 않도록 Enter로는 시작하지 않습니다.
  screen.onKey = (e) => {
    if (e.key === 'Enter' && autoStarts) {
      e.preventDefault();
      goNext();
    }
  };

  if (autoStarts && !ui.autoStopped) {
    const timer = setTimeout(() => {
      ui.countdown -= 1;
      if (ui.countdown <= 0) goNext();
      else refresh();
    }, 1000);
    cleanup = () => clearTimeout(timer);
  }

  const nextAction = step && (autoStarts
    ? [
        !ui.autoStopped &&
          h('div', { class: 'row secondary' }, `${ui.countdown}초 뒤 틀린 ${step.count}개로 ${step.round}회차를 시작해요.`),
        row({ title: `↺ 틀린 ${step.count}개 바로 풀기 (Enter)`, onClick: goNext, className: 'accent' }),
        !ui.autoStopped &&
          row({
            title: '⏸ 자동 시작 멈추기',
            onClick: () => {
              ui.autoStopped = true;
              refresh();
            },
          }),
      ]
    : h('div', { class: 'start-test' },
        h('div', { class: 'row-title' }, '오답을 모두 맞혔어요!'),
        h('div', { class: 'secondary' }, `준비되면 전체 단어 ${step.count}개로 시험을 봐요. 95% 이상 맞히면 통과예요.`),
        h('button', { class: 'button primary large', onClick: goNext }, `☑ 전체 ${step.count}개 시험 시작`),
      ));

  return h('div', { class: 'result' },
    section({ title: engine.isFullTest ? '전체 시험 결과' : `${engine.round}회차 결과` },
      h('div', { class: 'score' },
        showsPass && h('div', { class: `score-pass ${passed ? 'pass' : 'fail'}` }, passed ? '✔ 통과!' : '✕ 미통과'),
        h('div', { class: 'score-percent' }, `${percentOf(correct, total)}%`),
        h('div', { class: 'secondary' }, `${correct} / ${total}`),
        showsPass && !passed && h('div', { class: 'status fail small' }, '95% 이상 맞히면 통과예요.'),
        h('div', { class: 'secondary' },
          wrongWords.length === 0 ? '모두 맞혔어요! 🎉' : `틀린 단어 ${wrongWords.length}개는 오답 노트에 저장됐어요.`),
        wrongWords.length === 0 && engine.round > 1 &&
          h('div', { class: 'row-title' }, `${engine.round}회차 만에 모든 단어를 맞혔어요! 💪`),
      ),
      nextAction,
      row({ title: '⟳ 처음부터 다시', onClick: restart }),
    ),
    wrongWords.length > 0 && section({ title: '이번에 틀린 단어' }, wrongWords.map((w) => wordRow(w))),
  );
}

// MARK: - 시작

Store.load().then(render);
