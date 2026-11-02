import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Deck.createdAt, order: .reverse) private var decks: [Deck]
    @Query(filter: #Predicate<Word> { $0.isWrong == true }) private var wrongWords: [Word]
    @State private var isImporting = false
    @State private var deckToRename: Deck?

    var body: some View {
        NavigationStack {
            List {
                if !decks.isEmpty {
                    Section {
                        NavigationLink {
                            WrongWordsView()
                        } label: {
                            Label("전체 오답 노트", systemImage: "exclamationmark.triangle.fill")
                        }
                        .badge(wrongWords.count)
                    }

                    Section("단어장") {
                        ForEach(decks) { deck in
                            NavigationLink {
                                DeckDetailView(deck: deck)
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(deck.name)
                                        .font(.headline)
                                    Text("단어 \(deck.words.count)개")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    DeckStatusLabel(deck: deck)
                                        .font(.caption)
                                    if let lastStudiedAt = deck.lastStudiedAt {
                                        Text("마지막 학습 \(lastStudiedAt.formatted(.dateTime.month().day()))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            // 길게 누르기(iPhone) / 오른쪽 클릭(Mac)
                            .contextMenu {
                                Button {
                                    deckToRename = deck
                                } label: {
                                    Label("이름 바꾸기", systemImage: "pencil")
                                }
                                Button(role: .destructive) {
                                    modelContext.delete(deck)
                                    try? modelContext.save()
                                } label: {
                                    Label("삭제", systemImage: "trash")
                                }
                            }
                        }
                        .onDelete(perform: deleteDecks)
                    }
                }
            }
            .overlay {
                if decks.isEmpty {
                    ContentUnavailableView {
                        Label("단어장이 없어요", systemImage: "book.closed")
                    } description: {
                        Text("단어 표를 붙여넣으면 단어장이 자동으로 만들어져요.")
                    } actions: {
                        Button("단어장 만들기") { isImporting = true }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("내 단어장")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isImporting = true
                    } label: {
                        Label("새 단어장", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isImporting) {
                ImportView()
            }
            .renameDeckAlert(for: $deckToRename)
        }
    }

    private func deleteDecks(at offsets: IndexSet) {
        for index in offsets {
            modelContext.delete(decks[index])
        }
        try? modelContext.save()
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Deck.self, Word.self], inMemory: true)
}
