import Foundation
import SwiftData

/// 이어서 하기를 위해 저장하는 학습 진행 상태
struct StudySnapshot: Codable, Hashable {
    var mode: StudySession.Mode
    /// 오답 노트에서 시작한 학습인지
    var isReviewSession: Bool
    var isReviewing: Bool
    var isFullTest: Bool
    var round: Int
    /// 다음에 풀 문제 위치 (이미 답한 문제는 다시 나오지 않음)
    var index: Int
    var correctCount: Int
    // 단어/단어장은 PersistentIdentifier.stableKey 문자열로 저장합니다.
    var sessionWordIDs: [String]
    var poolWordIDs: [String]
    /// 이번 회차 문제 순서 (섞인 순서 그대로)
    var questionIDs: [String]
    var wrongWordIDs: [String]
    var deckID: String?
    /// 이번 회차 결과를 시험 기록에 이미 남겼는지 (예전 저장분에는 없어서 Optional)
    var isRoundRecorded: Bool?

    /// 예: "전체 시험 · 15/87 완료", "오답 2회차 · 3/7 완료"
    var summary: String {
        let phase: String
        if isFullTest {
            phase = "전체 시험"
        } else if round > 1 {
            phase = "오답 \(round)회차"
        } else {
            phase = "오답 복습"
        }
        return "\(phase) · \(min(index, questionIDs.count))/\(questionIDs.count) 완료"
    }
}

extension PersistentIdentifier {
    /// 저장했다 다시 읽어도 똑같은 문자열 키.
    /// 디코딩한 PersistentIdentifier는 ==로는 같아도 해시값이 달라서 딕셔너리 키로 쓸 수 없기 때문에 사용합니다.
    var stableKey: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        guard let data = try? encoder.encode(self) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
}

/// 어디서 시작한 학습인지 구분하는 키 (같은 키로 새로 시작하면 이전 진행은 덮어씀)
struct ProgressKey: Hashable {
    enum Scope: String {
        /// 단어장 화면에서 시작
        case deck
        /// 오답 노트에서 시작 (deck이 nil이면 전체 오답 노트)
        case wrongNotes
    }

    let scope: Scope
    let mode: StudySession.Mode
    let deck: Deck?
}

/// 저장된 진행 상태 (SwiftData에 저장돼서 앱을 껐다 켜도 남아 있음)
@Model
final class SavedProgress {
    var scopeRaw: String
    var modeRaw: String
    var deck: Deck?
    var payload: Data
    var updatedAt: Date

    init(scope: ProgressKey.Scope, mode: StudySession.Mode, payload: Data) {
        self.scopeRaw = scope.rawValue
        self.modeRaw = mode.rawValue
        self.payload = payload
        self.updatedAt = .now
    }

    var snapshot: StudySnapshot? {
        try? JSONDecoder().decode(StudySnapshot.self, from: payload)
    }

    var key: ProgressKey {
        ProgressKey(
            scope: ProgressKey.Scope(rawValue: scopeRaw) ?? .deck,
            mode: StudySession.Mode(rawValue: modeRaw) ?? .typing,
            deck: deck
        )
    }

    func matches(scope: ProgressKey.Scope, deck: Deck?) -> Bool {
        scopeRaw == scope.rawValue && self.deck?.persistentModelID == deck?.persistentModelID
    }

    func matches(_ key: ProgressKey) -> Bool {
        modeRaw == key.mode.rawValue && matches(scope: key.scope, deck: key.deck)
    }
}

enum ProgressStore {
    static func find(_ key: ProgressKey, in context: ModelContext) -> SavedProgress? {
        let all = (try? context.fetch(FetchDescriptor<SavedProgress>())) ?? []
        return all.first { $0.matches(key) }
    }

    static func save(_ snapshot: StudySnapshot, for key: ProgressKey, in context: ModelContext) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        if let existing = find(key, in: context) {
            existing.payload = data
            existing.updatedAt = .now
        } else {
            let progress = SavedProgress(scope: key.scope, mode: key.mode, payload: data)
            context.insert(progress)
            progress.deck = key.deck
        }
        // 앱이 갑자기 꺼져도 남도록 바로 저장
        try? context.save()
    }

    static func clear(_ key: ProgressKey, in context: ModelContext) {
        guard let existing = find(key, in: context) else { return }
        context.delete(existing)
        try? context.save()
    }

    static func wordLookup(in context: ModelContext) -> [String: Word] {
        let all = (try? context.fetch(FetchDescriptor<Word>())) ?? []
        return Dictionary(all.map { ($0.persistentModelID.stableKey, $0) }, uniquingKeysWith: { first, _ in first })
    }

    /// 저장된 진행 상태로 학습 화면을 다시 엽니다. 단어가 모두 지워졌으면 진행 상태도 지우고 nil을 반환합니다.
    static func resumeSession(from progress: SavedProgress, in context: ModelContext) -> StudySession? {
        let lookup = wordLookup(in: context)
        guard let snapshot = progress.snapshot,
              snapshot.questionIDs.contains(where: { lookup[$0] != nil }) else {
            context.delete(progress)
            try? context.save()
            return nil
        }

        let decks = (try? context.fetch(FetchDescriptor<Deck>())) ?? []
        let deck = snapshot.deckID.flatMap { id in decks.first { $0.persistentModelID.stableKey == id } }

        return StudySession(
            mode: snapshot.mode,
            words: snapshot.sessionWordIDs.compactMap { lookup[$0] },
            pool: snapshot.poolWordIDs.compactMap { lookup[$0] },
            isReview: snapshot.isReviewSession,
            deck: deck,
            progressKey: progress.key,
            resumeSnapshot: snapshot
        )
    }
}
