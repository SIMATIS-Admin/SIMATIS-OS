import Testing
import Foundation
@testable import VisioCore

@Suite struct DetecteurTests {
    private let t0 = Date(timeIntervalSince1970: 1_000_000)
    private func apres(_ s: TimeInterval) -> Date { t0.addingTimeInterval(s) }

    @Test func neRetientQueLesApplisDeReunion() {
        let apps = appsDeReunion(["com.apple.CoreSpeech", "com.microsoft.teams2.modulehost", "com.google.Chrome.helper",
                                  "com.heavylightapps.pasty", "us.zoom.xos", "com.apple.assistantd"])
        #expect(Set(apps) == ["com.microsoft.teams2.modulehost", "com.google.Chrome.helper", "us.zoom.xos"])
    }

    @Test func proposeApresQuelquesSecondesDeMicroOccupe() {
        var d = Detecteur()
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(0)) == nil)
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(4)) == nil)
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(9)) == .proposer(["us.zoom.xos"]))
    }

    @Test func neProposeQuUneFoisParReunion() {
        var d = Detecteur()
        _ = d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(0))
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(10)) != nil)
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(20)) == nil)
        // Le micro se libère, une autre réunion commence : nouvelle proposition.
        _ = d.echantillon(apps: [], enregistre: false, maintenant: apres(30))
        _ = d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(40))
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(50)) != nil)
    }

    @Test func ignoreUnMicroOccupeTropBrievement() {
        var d = Detecteur()
        _ = d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(0))
        _ = d.echantillon(apps: [], enregistre: false, maintenant: apres(3))
        #expect(d.echantillon(apps: ["us.zoom.xos"], enregistre: false, maintenant: apres(6)) == nil)
    }

    @Test func arreteQuandLaReunionSeTermineApresAvoirEteVue() {
        var d = Detecteur()
        _ = d.echantillon(apps: ["us.zoom.xos"], enregistre: true, maintenant: apres(0))
        #expect(d.echantillon(apps: [], enregistre: true, maintenant: apres(10)) == nil)
        #expect(d.echantillon(apps: [], enregistre: true, maintenant: apres(25)) == nil)
        #expect(d.echantillon(apps: [], enregistre: true, maintenant: apres(41)) == .arreter)
    }

    @Test func nArretePasSiLaReunionRepart() {
        var d = Detecteur()
        _ = d.echantillon(apps: ["us.zoom.xos"], enregistre: true, maintenant: apres(0))
        _ = d.echantillon(apps: [], enregistre: true, maintenant: apres(10))
        _ = d.echantillon(apps: ["us.zoom.xos"], enregistre: true, maintenant: apres(20))
        #expect(d.echantillon(apps: [], enregistre: true, maintenant: apres(45)) == nil)
    }

    @Test func nArretePasUnEnregistrementSansReunion() {
        var d = Detecteur()
        for s in stride(from: 0.0, through: 120.0, by: 10.0) {
            #expect(d.echantillon(apps: [], enregistre: true, maintenant: apres(s)) == nil)
        }
    }
}
