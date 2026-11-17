import Foundation

private func normaliser(_ texte: String) -> String {
    texte.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
        .lowercased()
        .replacingOccurrences(of: "[^a-z0-9 ]", with: " ", options: .regularExpression)
        .replacingOccurrences(of: " +", with: " ", options: .regularExpression)
}

// La phrase complète qui arrête l'enregistrement. Un simple « stop » dans la conversation ne
// suffit pas : il faut nommer l'enregistrement.
public func contientCommandeArret(_ texte: String) -> Bool {
    let t = normaliser(texte)
    return t.range(of: #"\b(arrete|arret|stop|stoppe|termine|fin)( de)?( l| d)? ?enregistrement\b"#, options: .regularExpression) != nil
        || t.range(of: #"\b(arrete|stop|stoppe|termine) (de )?(l )?enregistrer\b"#, options: .regularExpression) != nil
}
