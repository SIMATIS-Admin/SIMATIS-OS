import Testing
import Foundation
@testable import VisioCore

@Suite(.serialized) struct RendezVousTests {
    private func rdv(_ id: String, debut: TimeInterval, fin: TimeInterval) -> RendezVousProche {
        RendezVousProche(id: id, titre: "V - \(id)", debut: Date(timeIntervalSince1970: debut),
                         fin: Date(timeIntervalSince1970: fin), lienVisio: nil)
    }

    @Test func proposeLeRendezVousEnCours() {
        let liste = [rdv("a", debut: 0, fin: 3_600), rdv("b", debut: 7_200, fin: 10_800)]
        let ordre = ordonnerPourEnregistrer(liste, maintenant: Date(timeIntervalSince1970: 1_000))
        #expect(ordre.map(\.id) == ["a", "b"])
    }

    @Test func sansRendezVousEnCoursProposeLePlusProcheEnPremier() {
        let liste = [rdv("loin", debut: 20_000, fin: 23_000), rdv("proche", debut: 5_000, fin: 8_000)]
        let ordre = ordonnerPourEnregistrer(liste, maintenant: Date(timeIntervalSince1970: 4_000))
        #expect(ordre.first?.id == "proche")
    }

    @Test func unRendezVousPasseMaisProcheRestePropose() {
        let liste = [rdv("fini", debut: 0, fin: 3_600), rdv("demain", debut: 90_000, fin: 93_000)]
        let ordre = ordonnerPourEnregistrer(liste, maintenant: Date(timeIntervalSince1970: 3_700))
        #expect(ordre.first?.id == "fini")
    }

    @Test func decodeLaReponseDeLOSAvecDatesISO() throws {
        let json = """
        [{"id":"os:v1","titre":"V - Atelier Fictif x Simatis","debut":"2026-10-12T08:00:00.000Z",
          "fin":"2026-10-12T09:00:00.000Z","lienVisio":null}]
        """.data(using: .utf8)!
        let liste = try decoderRendezVous(json)
        #expect(liste.first?.id == "os:v1")
        #expect(liste.first?.debut.timeIntervalSince1970 == 1_791_792_000)
    }
}
