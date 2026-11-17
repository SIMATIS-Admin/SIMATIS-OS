import Testing
import Foundation
@testable import VisioCore

@Suite(.serialized) struct PlanMorceauxTests {
    @Test func leDebutDUnMorceauEstSonRangFoisLaDuree() {
        let plan = PlanMorceaux(dureeMs: 30_000)
        #expect(plan.debutMs(rang: 0) == 0)
        #expect(plan.debutMs(rang: 3) == 90_000)
    }

    @Test func lesRangsSontIndependantsParPiste() {
        var plan = PlanMorceaux(dureeMs: 30_000)
        #expect(plan.prochainRang(.moi) == 0)
        #expect(plan.prochainRang(.moi) == 1)
        #expect(plan.prochainRang(.autres) == 0)
    }
}
