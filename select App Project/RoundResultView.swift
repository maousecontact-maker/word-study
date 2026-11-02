import SwiftUI

/// 한 회차가 끝났을 때의 결과 화면.
/// 다음 단계(틀린 단어만 다시 / 전체 단어 시험)가 있으면 몇 초 뒤 자동으로 시작합니다.
struct RoundResultView: View {
    enum NextStep: Equatable {
        /// 이번 회차에서 틀린 단어만 모아 다음 회차 진행
        case retryWrong(count: Int, round: Int)
        /// 오답을 모두 맞혔으니 단어장 전체 시험 진행
        case fullTest(count: Int)
    }

    let title: String
    let round: Int
    let correctCount: Int
    let total: Int
    let wrongWords: [Word]
    /// 전체 시험일 때만 통과/미통과를 보여줍니다.
    let showsPassResult: Bool
    let nextStep: NextStep?
    let onNext: () -> Void
    let onRestart: () -> Void

    private static let autoStartSeconds = 5

    @State private var countdown = RoundResultView.autoStartSeconds
    @State private var isAutoStartStopped = false

    var body: some View {
        List {
            Section {
                ScoreSummary(
                    correctCount: correctCount,
                    total: total,
                    wrongCount: wrongWords.count,
                    showsPassResult: showsPassResult
                )

                if wrongWords.isEmpty, round > 1 {
                    Text("\(round)회차 만에 모든 단어를 맞혔어요! 💪")
                        .font(.headline)
                }

                if let nextStep {
                    if !isAutoStartStopped {
                        Text(countdownMessage(for: nextStep))
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText(countsDown: true))
                    }
                    Button(action: onNext) {
                        Label(buttonTitle(for: nextStep), systemImage: buttonIcon(for: nextStep))
                    }
                    .keyboardShortcut(.defaultAction)
                    if !isAutoStartStopped {
                        Button {
                            isAutoStartStopped = true
                        } label: {
                            Label("자동 시작 멈추기", systemImage: "pause.circle")
                        }
                    }
                }

                Button(action: onRestart) {
                    Label("처음부터 다시", systemImage: "arrow.clockwise")
                }
            } header: {
                Text(title)
            }

            if !wrongWords.isEmpty {
                Section("이번에 틀린 단어") {
                    ForEach(wrongWords) { word in
                        WordRow(word: word)
                    }
                }
            }
        }
        .task {
            await runAutoStartCountdown()
        }
    }

    private func countdownMessage(for step: NextStep) -> String {
        switch step {
        case let .retryWrong(count, round):
            "\(countdown)초 뒤 틀린 \(count)개로 \(round)회차를 시작해요."
        case let .fullTest(count):
            "오답을 모두 맞혔어요! \(countdown)초 뒤 전체 단어 \(count)개 시험을 시작해요."
        }
    }

    private func buttonTitle(for step: NextStep) -> String {
        switch step {
        case let .retryWrong(count, _):
            "틀린 \(count)개 바로 풀기 (Enter)"
        case let .fullTest(count):
            "전체 \(count)개 시험 바로 보기 (Enter)"
        }
    }

    private func buttonIcon(for step: NextStep) -> String {
        switch step {
        case .retryWrong: "arrow.counterclockwise"
        case .fullTest: "checklist"
        }
    }

    private func runAutoStartCountdown() async {
        guard nextStep != nil else { return }
        while countdown > 0 {
            // 화면을 떠나면 Task가 취소되어 여기서 빠져나옵니다.
            try? await Task.sleep(for: .seconds(1))
            if Task.isCancelled || isAutoStartStopped { return }
            withAnimation { countdown -= 1 }
        }
        onNext()
    }
}
