import Testing
import Foundation
@testable import VisioCore

// Petit compteur partagé entre les tâches du test.
actor Journal {
    var lignes: [String] = []
    func ajouter(_ l: String) { lignes.append(l) }
}

@Suite struct ExpediteurTests {
    @Test func envoieDansLOrdreMemeSiLePremierEchoueDabord() async {
        let journal = Journal()
        let essais = Journal()
        let exp = ExpediteurOrdonne(essaisMax: 3, pause: {}, surErreur: { _ in })
        await exp.envoyer {
            await essais.ajouter("a")
            if await essais.lignes.count < 3 { throw OsErreur(statut: 500, message: "x") }
            await journal.ajouter("a")
        }
        await exp.envoyer { await journal.ajouter("b") }
        await exp.envoyer { await journal.ajouter("c") }
        await exp.attendreFin()
        #expect(await journal.lignes == ["a", "b", "c"])
    }

    @Test func unEnvoiAbandonneEstSignaleSansBloquerLesSuivants() async {
        let journal = Journal()
        let erreurs = Journal()
        let exp = ExpediteurOrdonne(essaisMax: 2, pause: {}, surErreur: { e in
            Task { await erreurs.ajouter("erreur") }
        })
        await exp.envoyer { throw OsErreur(statut: 500, message: "x") }
        await exp.envoyer { await journal.ajouter("suite") }
        await exp.attendreFin()
        try? await Task.sleep(nanoseconds: 50_000_000)
        #expect(await journal.lignes == ["suite"])
        #expect(await erreurs.lignes == ["erreur"])
    }
}
