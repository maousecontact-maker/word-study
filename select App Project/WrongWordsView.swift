import SwiftUI
import SwiftData

/// 틀린 단어만 모아 보고 다시 풀 수 있는 오답 노트
struct WrongWordsView: View {
    /// nil이면 모든 단어장의 오답을 보여줍니다.
    var deck: Deck?

    @Query(filter: #Predicate<Word> { $0.isWrong == true }, sort: \Word.wrongCount, order: .reverse)
    private var allWrongWords: [Word]
    @Query private var allWords: [Word]
    @Query(sort: \SavedProgress.updatedAt, order: .reverse) private var savedProgress: [SavedProgress]
    @Environment(\.modelContext) private var modelContext
    @State private var session: StudySession?

    private var wrongWords: [Word] {
        guard let deck else { return allWrongWords }
        return allWrongWords.filter { $0.deck?.persistentModelID == deck.persistentModelID }
    }

    /// 오답을 다 맞힌 뒤 전체 시험을 볼 단어장.
    /// 전체 오답 노트라도 오답이 모두 한 단어장 것이면 그 단어장으로 시험을 봅니다.
    private func fullTestDeck(for wrongWords: [Word]) -> Deck? {
        if let deck { return deck }
        let deckIDs = Set(wrongWords.compactMap { $0.deck?.persistentModelID })
        guard deckIDs.count == 1 else { return nil }
        return wrongWords.first?.deck
    }

    var body: some View {
        let wrongWords = wrongWords
        let pool = deck?.words ?? allWords
        let testDeck = fullTestDeck(for: wrongWords)
        // 오답을 다 맞히고 전체 시험 중에 나갔을 수도 있으니 오답이 없어도 보여줍니다.
        let resumable = savedProgress.filter { $0.matches(scope: .wrongNotes, deck: deck) }

        List {
            if !resumable.isEmpty {
                Section("하던 거 이어서") {
                    ForEach(resumable) { progress in
                        ResumeRow(progress: progress) {
                            session = ProgressStore.resumeSession(from: progress, in: modelContext)
                        }
                    }
                }
            }

            if !wrongWords.isEmpty {
                Section {
                    Button {
                        session = newSession(.quiz, words: wrongWords, pool: pool, testDeck: testDeck)
                    } label: {
                        Label("오답만 퀴즈 풀기", systemImage: "questionmark.circle")
                    }
                    Button {
                        session = newSession(.typing, words: wrongWords, pool: pool, testDeck: testDeck)
                    } label: {
                        Label("오답만 타이핑", systemImage: "keyboard")
                    }
                } footer: {
                    if testDeck != nil {
                        Text("틀린 것만 계속 다시 풀고, 다 맞히면 바로 전체 단어 시험으로 넘어가요. 맞힌 단어는 오답 노트에서 빠져요.")
                    } else {
                        Text("틀린 것만 계속 다시 풀어요. 여러 단어장의 오답이 섞여 있어서 전체 시험은 단어장별로 봐야 해요.")
                    }
                }

                Section("틀린 단어 \(wrongWords.count)개") {
                    ForEach(wrongWords) { word in
                        WordRow(word: word, showsDeck: deck == nil)
                            .swipeActions {
                                Button("외웠어요") { word.isWrong = false }
                                    .tint(.green)
                            }
                    }
                }
            }
        }
        .overlay {
            if wrongWords.isEmpty, resumable.isEmpty {
                ContentUnavailableView(
                    "틀린 단어가 없어요",
                    systemImage: "checkmark.circle",
                    description: Text("퀴즈나 타이핑에서 틀린 단어가 여기에 모여요.")
                )
            }
        }
        .navigationTitle(deck.map { "\($0.name) 오답" } ?? "전체 오답 노트")
        .navigationDestination(item: $session) { session in
            StudySessionView(session: session)
        }
    }

    /// 새로 시작 (같은 방식으로 하던 진행 기록은 덮어씀)
    private func newSession(_ mode: StudySession.Mode, words: [Word], pool: [Word], testDeck: Deck?) -> StudySession {
        StudySession(
            mode: mode,
            words: words,
            pool: pool,
            isReview: true,
            deck: testDeck,
            progressKey: ProgressKey(scope: .wrongNotes, mode: mode, deck: deck)
        )
    }
}
