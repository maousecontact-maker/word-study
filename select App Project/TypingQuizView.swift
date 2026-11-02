import SwiftUI
import SwiftData

/// 영어 단어를 보고 뜻을 직접 타이핑해서 맞히는 퀴즈
struct TypingQuizView: View {
    let session: StudySession

    @Environment(\.modelContext) private var modelContext
    @AppStorage("autoSpeak") private var autoSpeak = true
    @State private var engine = StudyEngine()
    @FocusState private var isInputFocused: Bool
    @State private var input = ""
    /// nil이면 아직 채점 전, true/false면 채점 결과
    @State private var isCorrect: Bool?

    var body: some View {
        Group {
            if !engine.hasStarted {
                Color.clear
            } else if engine.questions.isEmpty {
                ContentUnavailableView("단어가 없어요", systemImage: "tray")
            } else if let word = engine.currentWord {
                questionView(word)
            } else {
                resultView
            }
        }
        .navigationTitle(engine.isReviewing ? "오답 타이핑" : "뜻 타이핑")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $autoSpeak) {
                    Label("자동 발음", systemImage: autoSpeak ? "speaker.wave.2" : "speaker.slash")
                }
                .toggleStyle(.button)
            }
        }
        .onAppear {
            engine.begin(session, modelContext: modelContext)
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

                TextField("뜻을 입력하고 Enter", text: $input)
                    .textFieldStyle(.roundedBorder)
                    .font(.title3)
                    .focused($isInputFocused)
                    .autocorrectionDisabled()
                    .onSubmit(submit)

                if let isCorrect {
                    feedbackView(word: word, isCorrect: isCorrect)
                } else {
                    HStack(spacing: 12) {
                        Button("모르겠어요") { grade(word, answer: "") }
                            .buttonStyle(.bordered)
                        Button("확인", action: submit)
                            .buttonStyle(.borderedProminent)
                            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
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

    private func feedbackView(word: Word, isCorrect: Bool) -> some View {
        VStack(spacing: 12) {
            Label(isCorrect ? "정답!" : "틀렸어요", systemImage: isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.title2.bold())
                .foregroundStyle(isCorrect ? .green : .red)

            Text("정답: \(word.meaning)")
                .font(.title3)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                if !isCorrect, !input.trimmingCharacters(in: .whitespaces).isEmpty {
                    // 비슷한 말로 적었는데 틀림 처리됐을 때 직접 정답으로 바꿀 수 있게
                    Button("정답으로 처리") {
                        engine.overrideAsCorrect(word)
                        self.isCorrect = true
                        isInputFocused = true
                    }
                    .buttonStyle(.bordered)
                }
                Button(engine.isLastQuestion ? "결과 보기" : "다음 (Enter)") {
                    engine.advance()
                }
                .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background((isCorrect ? Color.green : Color.red).opacity(0.1), in: .rect(cornerRadius: 12))
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
        input = ""
        isCorrect = nil
        guard let word = engine.currentWord else { return }
        isInputFocused = true
        if autoSpeak { Speaker.shared.speak(word.term) }
    }

    /// Enter: 채점 전이면 채점, 채점 후면 다음 문제로
    private func submit() {
        guard let word = engine.currentWord else { return }
        if isCorrect != nil {
            engine.advance()
        } else if !input.trimmingCharacters(in: .whitespaces).isEmpty {
            grade(word, answer: input)
        }
    }

    private func grade(_ word: Word, answer: String) {
        let correct = AnswerChecker.isCorrect(answer, meaning: word.meaning)
        isCorrect = correct
        engine.recordAnswer(for: word, correct: correct)
        isInputFocused = true
    }
}

/// 타이핑한 뜻이 정답인지 너그럽게 비교합니다.
enum AnswerChecker {
    /// - 뜻이 "여러분, 모든 사람"처럼 여러 개면 그중 하나만 맞혀도 정답
    /// - 띄어쓰기, `~`, 문장부호는 무시 ("~할 수 있다" ↔ "할수있다")
    /// - 괄호 안 내용은 있어도 없어도 정답 ("(음식을) 먹다" ↔ "먹다")
    static func isCorrect(_ answer: String, meaning: String) -> Bool {
        let typed = normalize(answer)
        guard !typed.isEmpty else { return false }

        var candidates = [meaning]
        candidates += meaning.components(separatedBy: CharacterSet(charactersIn: ",/;·"))
        let accepted = candidates.flatMap { [normalize($0), normalize(removingParentheses($0))] }
        return accepted.contains { !$0.isEmpty && $0 == typed }
    }

    private static func normalize(_ text: String) -> String {
        let ignored = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
        return String(text.lowercased().unicodeScalars.filter { !ignored.contains($0) })
    }

    private static func removingParentheses(_ text: String) -> String {
        text.replacingOccurrences(of: #"\([^)]*\)"#, with: "", options: .regularExpression)
    }
}
