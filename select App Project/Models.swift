import Foundation
import SwiftData

/// 단어장 하나 (예: "Lesson 3 - Brain Foods")
@Model
final class Deck {
    var name: String
    var createdAt: Date
    @Relationship(deleteRule: .cascade, inverse: \Word.deck)
    var words: [Word] = []
    /// 이어서 하기 기록 (단어장을 지우면 함께 삭제)
    @Relationship(deleteRule: .cascade, inverse: \SavedProgress.deck)
    var savedProgress: [SavedProgress] = []
    /// 전체 시험 기록 (단어장을 지우면 함께 삭제)
    @Relationship(deleteRule: .cascade, inverse: \TestRecord.deck)
    var testRecords: [TestRecord] = []
    /// 전체 단어로 본 시험의 최고 정답률 (0.0 ~ 1.0)
    var bestScore: Double?
    /// 전체 단어 시험에서 95% 이상 맞힌 적이 있는지
    var hasPassed: Bool = false
    /// 처음 통과한 날짜
    var passedAt: Date?
    /// 마지막으로 문제를 푼 날짜 (전체 시험, 오답 복습 모두 포함)
    var lastStudiedAt: Date?

    init(name: String, createdAt: Date = .now) {
        self.name = name
        self.createdAt = createdAt
    }

    /// 통과 기준 95% (부동소수점 오차를 피하려고 정수로 비교)
    static func passes(correct: Int, total: Int) -> Bool {
        total > 0 && correct * 100 >= total * 95
    }

    /// 전체 단어 시험 결과를 기록합니다.
    func recordTestResult(correct: Int, total: Int, mode: StudySession.Mode) {
        guard total > 0 else { return }
        let passed = Deck.passes(correct: correct, total: total)
        let record = TestRecord(mode: mode, correctCount: correct, totalCount: total, passed: passed)
        modelContext?.insert(record)
        record.deck = self

        bestScore = max(bestScore ?? 0, Double(correct) / Double(total))
        if passed, !hasPassed {
            hasPassed = true
            passedAt = record.date
        }
    }

    /// 새 단어가 추가되면 그 단어까지 포함해서 다시 통과해야 합니다. (지난 시험 기록은 남겨둠)
    func resetPassStatus() {
        hasPassed = false
        passedAt = nil
        bestScore = nil
    }

    /// 붙여넣은 순서대로 정렬된 단어 목록
    var sortedWords: [Word] {
        words.sorted { $0.position < $1.position }
    }

    /// 최근 시험이 위로 오도록 정렬된 기록
    var sortedTestRecords: [TestRecord] {
        testRecords.sorted { $0.date > $1.date }
    }
}

/// 영어 단어와 뜻 한 쌍
@Model
final class Word {
    var term: String
    var meaning: String
    /// 단어장 안에서의 순서
    var position: Int
    /// 오답 노트에 들어가 있는지 여부
    var isWrong: Bool = false
    /// 지금까지 틀린 횟수
    var wrongCount: Int = 0
    var deck: Deck?

    init(term: String, meaning: String, position: Int) {
        self.term = term
        self.meaning = meaning
        self.position = position
    }

    func markWrong() {
        isWrong = true
        wrongCount += 1
    }
}

/// 전체 단어 시험 한 번의 결과
@Model
final class TestRecord {
    var date: Date
    var modeRaw: String
    var correctCount: Int
    var totalCount: Int
    var passed: Bool
    var deck: Deck?

    init(date: Date = .now, mode: StudySession.Mode, correctCount: Int, totalCount: Int, passed: Bool) {
        self.date = date
        self.modeRaw = mode.rawValue
        self.correctCount = correctCount
        self.totalCount = totalCount
        self.passed = passed
    }

    var mode: StudySession.Mode? {
        StudySession.Mode(rawValue: modeRaw)
    }

    /// 94.7%가 95%로 반올림돼 보이지 않도록 내림
    var percent: Int {
        totalCount == 0 ? 0 : correctCount * 100 / totalCount
    }
}
