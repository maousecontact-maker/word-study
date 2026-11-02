import SwiftUI
import SwiftData

/// 단어 표를 붙여넣어 새 단어장을 만들거나 기존 단어장에 단어를 추가하는 화면
struct ImportView: View {
    /// nil이면 새 단어장을 만들고, 값이 있으면 그 단어장에 추가합니다.
    var deck: Deck?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var text = ""

    private var parsedWords: [ParsedWord] {
        WordParser.parse(text)
    }

    var body: some View {
        let parsed = parsedWords

        NavigationStack {
            Form {
                if deck == nil {
                    Section("단어장 이름") {
                        TextField("예: Lesson 3 - Brain Foods", text: $name)
                    }
                }

                Section {
                    TextEditor(text: $text)
                        .font(.body.monospaced())
                        .frame(minHeight: 180)
                    PasteButton(payloadType: String.self) { strings in
                        text = strings.joined(separator: "\n")
                    }
                } header: {
                    Text("단어 붙여넣기")
                } footer: {
                    Text("표(| 영어 | 뜻 |), 엑셀·구글 시트·퀴즐렛에서 복사한 내용, 'apple - 사과' 형식을 인식해요.")
                }

                if !parsed.isEmpty {
                    Section("미리보기 · \(parsed.count)개 인식됨") {
                        ForEach(Array(parsed.enumerated()), id: \.offset) { _, word in
                            HStack {
                                Text(word.term)
                                    .font(.headline)
                                Spacer()
                                Text(word.meaning)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.trailing)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(deck == nil ? "새 단어장" : "단어 추가")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { save(parsed) }
                        .disabled(parsed.isEmpty)
                }
            }
        }
    }

    private func save(_ parsed: [ParsedWord]) {
        let target: Deck
        if let deck {
            target = deck
        } else {
            let trimmed = name.trimmingCharacters(in: .whitespaces)
            target = Deck(name: trimmed.isEmpty ? "새 단어장" : trimmed)
            modelContext.insert(target)
        }

        let start = (target.words.map(\.position).max() ?? -1) + 1
        // 새 단어가 추가되면 그 단어까지 포함해서 다시 통과해야 합니다.
        if deck != nil {
            target.resetPassStatus()
        }
        for (offset, item) in parsed.enumerated() {
            let word = Word(term: item.term, meaning: item.meaning, position: start + offset)
            modelContext.insert(word)
            word.deck = target
        }
        try? modelContext.save()
        dismiss()
    }
}

#Preview {
    ImportView()
        .modelContainer(for: [Deck.self, Word.self], inMemory: true)
}
