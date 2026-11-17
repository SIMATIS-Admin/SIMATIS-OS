import Foundation

// Un rendez-vous proche, tel que l'OS le liste pour l'enregistrement.
public struct RendezVousProche: Equatable, Sendable {
    public let id: String
    public let titre: String
    public let debut: Date
    public let fin: Date
    public let lienVisio: String?

    public init(id: String, titre: String, debut: Date, fin: Date, lienVisio: String?) {
        self.id = id
        self.titre = titre
        self.debut = debut
        self.fin = fin
        self.lienVisio = lienVisio
    }
}

private struct RendezVousJSON: Decodable {
    let id: String
    let titre: String
    let debut: String?
    let fin: String?
    let lienVisio: String?
}

public func lireDateISO(_ texte: String?) -> Date? {
    guard let texte else { return nil }
    let precis = ISO8601DateFormatter()
    precis.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return precis.date(from: texte) ?? ISO8601DateFormatter().date(from: texte)
}

// Les rendez-vous sans date ne se proposent pas : on ne saurait pas les ordonner.
public func decoderRendezVous(_ data: Data) throws -> [RendezVousProche] {
    try JSONDecoder().decode([RendezVousJSON].self, from: data).compactMap { r in
        guard let debut = lireDateISO(r.debut) else { return nil }
        return RendezVousProche(id: r.id, titre: r.titre, debut: debut,
                                fin: lireDateISO(r.fin) ?? debut.addingTimeInterval(3_600),
                                lienVisio: r.lienVisio)
    }
}

// Celui qui a lieu maintenant d'abord, puis les autres du plus proche au plus éloigné de l'heure.
public func ordonnerPourEnregistrer(_ liste: [RendezVousProche], maintenant: Date) -> [RendezVousProche] {
    func distance(_ r: RendezVousProche) -> TimeInterval {
        if r.debut <= maintenant && maintenant <= r.fin { return 0 }
        return min(abs(r.debut.timeIntervalSince(maintenant)), abs(r.fin.timeIntervalSince(maintenant)))
    }
    return liste.sorted { distance($0) < distance($1) }
}
