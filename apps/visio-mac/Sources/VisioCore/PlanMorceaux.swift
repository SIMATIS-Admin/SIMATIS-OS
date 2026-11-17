public enum Piste: String, Sendable {
    case moi
    case autres
}

// Le rang et le début de chaque morceau d'une piste : les deux pistes se coupent aux mêmes instants.
public struct PlanMorceaux: Sendable {
    public let dureeMs: Int
    private var rangs: [Piste: Int] = [:]

    public init(dureeMs: Int = 30_000) {
        self.dureeMs = dureeMs
    }

    public func debutMs(rang: Int) -> Int { rang * dureeMs }

    public mutating func prochainRang(_ piste: Piste) -> Int {
        let rang = rangs[piste, default: 0]
        rangs[piste] = rang + 1
        return rang
    }
}
