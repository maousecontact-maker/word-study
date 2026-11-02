import SwiftUI
import SwiftData

/// 영어 단어를 보고 4개의 뜻 중 정답을 고르는 퀴즈
struct QuizView: View {
    let session: StudySession

    @Environment(\.modelContext) private var modelContext
    @AppStorage("autoSpeak") private var autoSpeak = true
    @State private var engine = StudyEngine()
    @State private var choices: [String] = []
    @State private var selected: String?

    /// 보기를 만들려면 서로 다른 뜻이 최소 2개 필요합니다.
    private var hasEnoughChoices: Bool {
        Set(session.pool.map(\.meaning)).count >= 2
    }

    var body: some View {
        Group {
            if !hasEnoughChoices {
                ContentUnavailableView(
                    "보기를 만들 수 없어요",
                    systemImage: "exclamationmark.bubble",
                    description: Text("퀴즈를 풀려면 뜻이 다른 단어가 2개 이상 필요해요.")
                )
            } else if !engine.hasStarted {
                Color.clear
            } else if let word = engine.currentWord {
                questionView(word)
            } else {
                resultView
            }
        }
        .navigationTitle(engine.isReviewing ? "오답 퀴즈" : "퀴즈")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $autoSpeak) {
                    Label("자동 발음", systemImage: autoSpeak ? "speaker.wave.2" : "speaker.slash")
                }
                .toggleStyle(.button)
            }
        }
        .onAppear {
            if hasEnoughChoices {
                engine.begin(session, modelContext: modelContext)
            }
        }
        .onChange(of: engine.questionToken) {
            prepareQuestion()
        }
    }

    private func questionView(_ word: Word) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 6) {
                    ProgressView(value: Double(engine.index), total: Double(engine.questions.count))
                    Text(progressText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 12) {
                    Text(word.term)
                        .font(.largeTitle.bold())
                        .multilineTextAlignment(.center)
                    SpeakButton(text: word.term)
                        .font(.title2)
                }
                .padding(.vertical, 32)

                ForEach(choices, id: \.self) { choice in
                    Button {
                        select(choice, for: word)
                    } label: {
                        HStack {
                            Text(choice)
                                .multilineTextAlignment(.leading)
                            Spacer()
                            if let icon = icon(for: choice, word: word) {
                                Image(systemName: icon)
                            }
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(color(for: choice, word: word).opacity(0.12), in: .rect(cornerRadius: 12))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(color(for: choice, word: word), lineWidth: 2)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(selected != nil)
                }

                if selected != nil {
                    Button(engine.isLastQuestion ? "결과 보기" : "다음") {
                        engine.advance()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
            .padding()
        }
    }

    private var progressText: String {
        let position = "\(engine.index + 1) / \(engine.questions.count)"
        return engine.round > 1 ? "\(engine.round)회차 (오답) · \(position)" : position
    }

    private var resultView: some View {
        RoundResultView(
            title: engine.isFullTest ? "전체 시험 결과" : "\(engine.round)회차 결과",
            round: engine.round,
            correctCount: engine.correctCount,
            total: engine.questions.count,
            wrongWords: engine.wrongWords,
            showsPassResult: engine.isFullTest,
            nextStep: engine.nextStep,
            onNext: { engine.performNextStep() },
            onRestart: { engine.startSession() }
        )
    }

    // MARK: - Logic

    private func prepareQuestion() {
        selected = nil
        guard let word = engine.currentWord else { return }
        choices = makeChoices(for: word)
        if autoSpeak { Speaker.shared.speak(word.term) }
    }

    /// 정답 1개 + 같은 뜻이 아닌 오답 최대 3개를 섞어서 보기로 만듭니다.
    private func makeChoices(for word: Word) -> [String] {
        var distractors: [String] = []
        for candidate in engine.pool.shuffled()
        where candidate.meaning != word.meaning && !distractors.contains(candidate.meaning) {
            distractors.append(candidate.meaning)
            if distractors.count == 3 { break }
        }
        return (distractors + [word.meaning]).shuffled()
    }

    private func select(_ choice: String, for word: Word) {
        selected = choice
        engine.recordAnswer(for: word, correct: choice == word.meaning)
    }

    private func color(for choice: String, word: Word) -> Color {
        guard let selected else { return .secondary }
        if choice == word.meaning { return .green }
        if choice == selected { return .red }
        return .secondary
    }

    private func icon(for choice: String, word: Word) -> String? {
        guard let selected else { return nil }
        if choice == word.meaning { return "checkmark.circle.fill" }
        if choice == selected { return "xmark.circle.fill" }
        return nil
    }
}
