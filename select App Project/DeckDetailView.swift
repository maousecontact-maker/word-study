import SwiftUI
import SwiftData

/// 학습 화면으로 넘길 때 단어 목록을 그 순간 기준으로 고정해 두는 값
struct StudySession: Identifiable, Hashable {
    enum Mode: String, Codable, Hashable {
        case typing
        case quiz

        var title: String {
            switch self {
            case .typing: "뜻 타이핑"
            case .quiz: "뜻 고르기 퀴즈"
            }
        }
    }

    let id = UUID()
    let mode: Mode
    let words: [Word]
    /// 퀴즈 오답 보기를 뽑을 단어들
    let pool: [Word]
    /// 오답 노트에서 시작했는지 (맞히면 오답 노트에서 빠짐)
    let isReview: Bool
    /// 전체 시험을 볼 단어장 (통과 기록도 여기에 반영)
    let deck: Deck?
    /// 이어서 하기 저장 위치
    let progressKey: ProgressKey
    /// 이어서 하기로 열었을 때 복원할 상태
    var resumeSnapshot: StudySnapshot? = nil
}

struct StudySessionView: View {
    let session: StudySession

    var body: some View {
        switch session.mode {
        case .typing:
            TypingQuizView(session: session)
        case .quiz:
            QuizView(session: session)
        }
    }
}

/// "이어서 하기" 버튼 한 줄
struct ResumeRow: View {
    let progress: SavedProgress
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("이어서 하기 · \(progress.key.mode.title)")
                        .font(.headline)
                    if let summary = progress.snapshot?.summary {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            } icon: {
                Image(systemName: "play.circle.fill")
            }
        }
    }
}

/// 퀴즈 결과 화면 상단의 점수 + 통과 여부
struct ScoreSummary: View {
    let correctCount: Int
    let total: Int
    let wrongCount: Int
    /// 단어장 전체 시험일 때만 통과/미통과를 보여줍니다.
    let showsPassResult: Bool

    private var passed: Bool { Deck.passes(correct: correctCount, total: total) }
    /// 94.7%가 95%로 반올림돼 보이지 않도록 내림
    private var percent: Int { total == 0 ? 0 : correctCount * 100 / total }

    var body: some View {
        VStack(spacing: 12) {
            if showsPassResult {
                Label(passed ? "통과!" : "미통과", systemImage: passed ? "checkmark.seal.fill" : "xmark.seal.fill")
                    .font(.title.bold())
                    .foregroundStyle(passed ? .green : .orange)
            }
            Text("\(percent)%")
                .font(.system(size: 48, weight: .bold, design: .rounded))
            Text("\(correctCount) / \(total)")
                .foregroundStyle(.secondary)
            if showsPassResult, !passed {
                Text("95% 이상 맞히면 통과예요.")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            }
            Text(wrongCount == 0 ? "모두 맞혔어요! 🎉" : "틀린 단어 \(wrongCount)개는 오답 노트에 저장됐어요.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical)
    }
}

/// 단어장의 통과 상태 배지 (예: "통과 · 최고 97%")
struct DeckStatusLabel: View {
    let deck: Deck

    var body: some View {
        if deck.hasPassed {
            // 예: "11월 2일 통과 · 최고 97%" (날짜 기록 전에 통과한 경우엔 날짜 없이)
            let passedDate = deck.passedAt.map { "\($0.formatted(.dateTime.month().day())) " } ?? ""
            Label("\(passedDate)통과 · 최고 \(bestPercent)%", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
        } else if deck.bestScore != nil {
            Label("미통과 · 최고 \(bestPercent)%", systemImage: "seal")
                .foregroundStyle(.orange)
        } else {
            Label("아직 시험 전", systemImage: "seal")
                .foregroundStyle(.secondary)
        }
    }

    private var bestPercent: Int {
        Int(((deck.bestScore ?? 0) * 100).rounded(.down))
    }
}

/// 시험 기록 한 줄: 날짜 + 방식 | 점수 + 통과 여부
struct TestRecordRow: View {
    let record: TestRecord

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(record.date.formatted(.dateTime.month().day().hour().minute()))
                    .font(.headline)
                Text(record.mode?.title ?? "")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(record.percent)% (\(record.correctCount)/\(record.totalCount))")
                    .monospacedDigit()
                Label(record.passed ? "통과" : "미통과", systemImage: record.passed ? "checkmark.seal.fill" : "xmark.seal")
                    .font(.caption)
                    .foregroundStyle(record.passed ? .green : .orange)
            }
        }
    }
}

struct DeckDetailView: View {
    let deck: Deck

    @Environment(\.modelContext) private var modelContext
    @State private var session: StudySession?
    @State private var isAddingWords = false
    @State private var deckToRename: Deck?
    @Query(sort: \SavedProgress.updatedAt, order: .reverse) private var savedProgress: [SavedProgress]

    var body: some View {
        let words = deck.sortedWords
        let resumable = savedProgress.filter { $0.matches(scope: .deck, deck: deck) }

        List {
            Section {
                DeckStatusLabel(deck: deck)
                    .font(.headline)
                if let lastStudiedAt = deck.lastStudiedAt {
                    LabeledContent("마지막 학습", value: lastStudiedAt.formatted(.dateTime.month().day().hour().minute()))
                }
            } footer: {
                Text("전체 단어로 타이핑이나 퀴즈를 풀어서 95% 이상 맞히면 통과예요.")
            }

            if !resumable.isEmpty {
                Section("하던 거 이어서") {
                    ForEach(resumable) { progress in
                        ResumeRow(progress: progress) {
                            session = ProgressStore.resumeSession(from: progress, in: modelContext)
                        }
                    }
                }
            }

            Section {
                Button {
                    session = newSession(.typing, words: words)
                } label: {
                    Label("뜻 타이핑", systemImage: "keyboard")
                }
                Button {
                    session = newSession(.quiz, words: words)
                } label: {
                    Label("뜻 고르기 퀴즈", systemImage: "questionmark.circle")
                }
                NavigationLink {
                    WrongWordsView(deck: deck)
                } label: {
                    Label("이 단어장 오답 노트", systemImage: "exclamationmark.triangle")
                }
                .badge(deck.words.filter(\.isWrong).count)
            }
            .disabled(words.isEmpty)

            let records = deck.sortedTestRecords
            if !records.isEmpty {
                Section("시험 기록 \(records.count)번") {
                    ForEach(records) { record in
                        TestRecordRow(record: record)
                    }
                }
            }

            Section("단어 \(words.count)개") {
                ForEach(words) { word in
                    WordRow(word: word)
                }
                .onDelete { offsets in
                    for index in offsets {
                        modelContext.delete(words[index])
                    }
                    try? modelContext.save()
                }
            }
        }
        .navigationTitle(deck.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    deckToRename = deck
                } label: {
                    Label("이름 바꾸기", systemImage: "pencil")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isAddingWords = true
                } label: {
                    Label("단어 추가", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $isAddingWords) {
            ImportView(deck: deck)
        }
        .renameDeckAlert(for: $deckToRename)
        .navigationDestination(item: $session) { session in
            StudySessionView(session: session)
        }
    }

    /// 새로 시작 (같은 방식으로 하던 진행 기록은 덮어씀)
    private func newSession(_ mode: StudySession.Mode, words: [Word]) -> StudySession {
        StudySession(
            mode: mode,
            words: words,
            pool: words,
            isReview: false,
            deck: deck,
            progressKey: ProgressKey(scope: .deck, mode: mode, deck: deck)
        )
    }
}

/// 단어장 이름 바꾸기 알림창. `deck`에 값을 넣으면 열리고 닫히면 nil이 됩니다.
struct RenameDeckModifier: ViewModifier {
    @Binding var deck: Deck?
    @State private var name = ""

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func body(content: Content) -> some View {
        content
            .alert(
                "단어장 이름 바꾸기",
                isPresented: Binding(get: { deck != nil }, set: { if !$0 { deck = nil } })
            ) {
                TextField("단어장 이름", text: $name)
                Button("취소", role: .cancel) {}
                Button("저장") {
                    guard let deck, !trimmedName.isEmpty else { return }
                    deck.name = trimmedName
                    try? deck.modelContext?.save()
                }
                .disabled(trimmedName.isEmpty)
            }
            .onChange(of: deck) {
                name = deck?.name ?? ""
            }
    }
}

extension View {
    func renameDeckAlert(for deck: Binding<Deck?>) -> some View {
        modifier(RenameDeckModifier(deck: deck))
    }
}

/// 단어 목록 한 줄: 발음 버튼 + 단어 + 뜻 + 틀린 횟수
struct WordRow: View {
    let word: Word
    var showsDeck = false

    var body: some View {
        HStack(spacing: 12) {
            SpeakButton(text: word.term)
            VStack(alignment: .leading, spacing: 2) {
                Text(word.term)
                    .font(.headline)
                Text(word.meaning)
                    .foregroundStyle(.secondary)
                if showsDeck, let deckName = word.deck?.name {
                    Text(deckName)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            if word.wrongCount > 0 {
                Label("\(word.wrongCount)", systemImage: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(word.isWrong ? Color.red : Color.secondary)
                    .accessibilityLabel("\(word.wrongCount)번 틀림")
            }
        }
    }
}
