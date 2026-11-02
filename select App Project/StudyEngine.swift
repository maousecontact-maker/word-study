import Foundation
import SwiftData
import Observation

/// 퀴즈와 타이핑이 함께 쓰는 학습 진행 로직.
/// 전체 시험 → 틀린 것만 회차 반복 → 다 맞히면 다시 전체 시험, 그리고 이어서 하기 저장까지 담당합니다.
@Observable
final class StudyEngine {
    private(set) var pool: [Word] = []
    private(set) var questions: [Word] = []
    private(set) var index = 0
    private(set) var round = 1
    private(set) var correctCount = 0
    private(set) var wrongWords: [Word] = []
    /// 지금 회차가 단어장 전체 시험인지 (통과 판정 대상)
    private(set) var isFullTest = false
    /// 지금 오답 복습 중인지 → 맞히면 오답 노트에서 빠짐
    private(set) var isReviewing = false
    private(set) var hasStarted = false
    /// 새 문제가 화면에 나올 때마다 바뀌는 값 (보기 섞기, 발음 재생 등에 사용)
    private(set) var questionToken = 0

    @ObservationIgnored private var deck: Deck?
    @ObservationIgnored private var sessionWords: [Word] = []
    @ObservationIgnored private var isReviewSession = false
    @ObservationIgnored private var mode: StudySession.Mode = .typing
    @ObservationIgnored private var progressKey: ProgressKey?
    @ObservationIgnored private var modelContext: ModelContext?
    /// "정답으로 처리"로 되돌릴 때 쓰는, 채점 직전의 오답 노트 상태
    @ObservationIgnored private var previousIsWrong = false
    /// 이번 회차 결과를 이미 기록했는지
    @ObservationIgnored private var isRoundRecorded = false

    var currentWord: Word? {
        questions.indices.contains(index) ? questions[index] : nil
    }

    var isLastQuestion: Bool {
        index + 1 >= questions.count
    }

    /// 화면이 처음 나타날 때 한 번 호출. 저장된 진행 상태가 있으면 그 위치부터 이어서 합니다.
    func begin(_ session: StudySession, modelContext: ModelContext) {
        guard !hasStarted else { return }
        sessionWords = session.words
        pool = session.pool
        deck = session.deck
        isReviewSession = session.isReview
        mode = session.mode
        progressKey = session.progressKey
        self.modelContext = modelContext

        if let snapshot = session.resumeSnapshot, restore(snapshot) {
            return
        }
        startSession()
    }

    // MARK: - 회차 진행

    /// 틀린 게 있으면 틀린 것만 다시, 오답을 다 맞혔으면 전체 시험
    var nextStep: RoundResultView.NextStep? {
        if !wrongWords.isEmpty {
            return .retryWrong(count: wrongWords.count, round: round + 1)
        }
        if !isFullTest, deck != nil {
            return .fullTest(count: fullTestWords.count)
        }
        return nil
    }

    func performNextStep() {
        if !wrongWords.isEmpty {
            isFullTest = false
            start(with: wrongWords, round: round + 1)
        } else {
            startFullTest()
        }
    }

    /// 처음부터: 오답 노트면 오답 복습부터, 아니면 전체 시험부터
    func startSession() {
        if isReviewSession {
            isReviewing = true
            isFullTest = false
            start(with: sessionWords)
        } else {
            startFullTest()
        }
    }

    private var fullTestWords: [Word] {
        deck?.sortedWords ?? sessionWords
    }

    private func startFullTest() {
        isReviewing = false
        isFullTest = deck != nil
        start(with: fullTestWords)
    }

    private func start(with list: [Word], round: Int = 1) {
        self.round = round
        questions = list.shuffled()
        index = 0
        correctCount = 0
        wrongWords = []
        isRoundRecorded = false
        hasStarted = true
        questionToken += 1
        saveProgress(answered: false)
    }

    // MARK: - 채점

    func recordAnswer(for word: Word, correct: Bool) {
        previousIsWrong = word.isWrong
        // 전체 오답 노트에서 풀어도 각 단어의 단어장에 학습 날짜가 남도록
        word.deck?.lastStudiedAt = .now
        if correct {
            correctCount += 1
            if isReviewing { word.isWrong = false }
        } else {
            word.markWrong()
            wrongWords.append(word)
        }
        saveProgress(answered: true)
    }

    /// 방금 틀림 처리된 답을 정답으로 바꿉니다.
    func overrideAsCorrect(_ word: Word) {
        word.wrongCount = max(0, word.wrongCount - 1)
        word.isWrong = isReviewing ? false : previousIsWrong
        wrongWords.removeAll { $0.persistentModelID == word.persistentModelID }
        correctCount += 1
        saveProgress(answered: true)
    }

    func advance() {
        index += 1
        if index >= questions.count {
            finishRound()
        } else {
            questionToken += 1
            saveProgress(answered: false)
        }
    }

    private func finishRound() {
        // 이어서 하기로 결과 화면이 다시 열려도 시험 기록이 두 번 남지 않도록
        if isFullTest, !isRoundRecorded {
            deck?.recordTestResult(correct: correctCount, total: questions.count, mode: mode)
        }
        isRoundRecorded = true
        // 더 할 게 없으면 이어서 하기 기록 삭제
        if nextStep == nil {
            clearProgress()
        } else {
            saveProgress(answered: false)
        }
    }

    // MARK: - 이어서 하기 저장/복원

    /// - Parameter answered: 지금 문제에 이미 답했으면 true → 이어서 할 때 다음 문제부터
    private func saveProgress(answered: Bool) {
        guard let modelContext, let progressKey, !questions.isEmpty else { return }
        let snapshot = StudySnapshot(
            mode: mode,
            isReviewSession: isReviewSession,
            isReviewing: isReviewing,
            isFullTest: isFullTest,
            round: round,
            index: answered ? index + 1 : index,
            correctCount: correctCount,
            sessionWordIDs: sessionWords.map(\.persistentModelID.stableKey),
            poolWordIDs: pool.map(\.persistentModelID.stableKey),
            questionIDs: questions.map(\.persistentModelID.stableKey),
            wrongWordIDs: wrongWords.map(\.persistentModelID.stableKey),
            deckID: deck?.persistentModelID.stableKey,
            isRoundRecorded: isRoundRecorded
        )
        ProgressStore.save(snapshot, for: progressKey, in: modelContext)
    }

    private func clearProgress() {
        guard let modelContext, let progressKey else { return }
        ProgressStore.clear(progressKey, in: modelContext)
    }

    private func restore(_ snapshot: StudySnapshot) -> Bool {
        guard let modelContext else { return false }
        let lookup = ProgressStore.wordLookup(in: modelContext)
        let restored = snapshot.questionIDs.compactMap { lookup[$0] }
        guard !restored.isEmpty else { return false }

        // 그사이 지워진 단어가 있으면 그만큼 위치를 당겨줍니다.
        let missingBefore = snapshot.questionIDs.prefix(snapshot.index).filter { lookup[$0] == nil }.count
        questions = restored
        index = min(max(0, snapshot.index - missingBefore), restored.count)
        round = snapshot.round
        correctCount = snapshot.correctCount
        wrongWords = snapshot.wrongWordIDs.compactMap { lookup[$0] }
        isFullTest = snapshot.isFullTest
        isReviewing = snapshot.isReviewing
        isRoundRecorded = snapshot.isRoundRecorded ?? false
        hasStarted = true
        questionToken += 1

        if index >= questions.count {
            finishRound()
        }
        return true
    }
}
