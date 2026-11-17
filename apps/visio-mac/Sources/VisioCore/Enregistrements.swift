import Foundation

// Un enregistrement de la liste de l'OS (cockpit, appli Mac).
public struct EnregistrementResume: Equatable, Sendable, Identifiable {
    public let id: String
    public let rdvId: String
    public let titre: String
    public let debutAt: Date
    public let finAt: Date?
    public let statut: String
    public let aResume: Bool

    // Le mot affiché à côté du titre, comme dans l'OS.
    public var etat: String {
        if aResume { return "Résumé prêt" }
        switch statut {
        case "en_cours": return "En cours"
        case "clos": return "Transcription en cours"
        case "transcrit": return "Transcrit"
        default: return "Échec"
        }
    }
}

// Le texte d'un enregistrement : résumé et transcript, tels que l'OS les rend.
public struct DetailSession: Decodable, Equatable, Sendable {
    public let id: String
    public let statut: String
    public let transcript: String?
    public let resume: String?
}

private struct EnregistrementJSON: Decodable {
    let id: String
    let rdvId: String
    let titre: String
    let debutAt: String
    let finAt: String?
    let statut: String
    let aResume: Bool
}

public func decoderEnregistrements(_ data: Data) throws -> [EnregistrementResume] {
    try JSONDecoder().decode([EnregistrementJSON].self, from: data).compactMap { e in
        guard let debut = lireDateISO(e.debutAt) else { return nil }
        return EnregistrementResume(id: e.id, rdvId: e.rdvId, titre: e.titre, debutAt: debut,
                                    finAt: lireDateISO(e.finAt), statut: e.statut, aResume: e.aResume)
    }
}
