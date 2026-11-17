import Testing
import Foundation
@testable import VisioCore

// Faux serveur : enregistre les requêtes et répond ce qu'on lui a préparé.
final class FauxServeur: URLProtocol {
    nonisolated(unsafe) static var requetes: [URLRequest] = []
    nonisolated(unsafe) static var corps: [Data] = []
    nonisolated(unsafe) static var reponses: [(Int, String)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var data = Data()
        if let flux = request.httpBodyStream {
            flux.open()
            var tampon = [UInt8](repeating: 0, count: 4096)
            while flux.hasBytesAvailable {
                let n = flux.read(&tampon, maxLength: tampon.count)
                if n <= 0 { break }
                data.append(tampon, count: n)
            }
            flux.close()
        } else if let b = request.httpBody { data = b }
        Self.requetes.append(request)
        Self.corps.append(data)
        let (code, texte) = Self.reponses.isEmpty ? (200, "{}") : Self.reponses.removeFirst()
        let reponse = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: reponse, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(texte.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized) struct OsClientTests {
    private func client() -> OsClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FauxServeur.self]
        FauxServeur.requetes = []
        FauxServeur.corps = []
        FauxServeur.reponses = []
        return OsClient(base: URL(string: "http://127.0.0.1:4300")!, instance: "simatis", session: URLSession(configuration: config))
    }

    @Test func ouvreUneSessionPourUnRendezVous() async throws {
        let c = client()
        FauxServeur.reponses = [(201, #"{"id":"s1"}"#)]
        let id = try await c.ouvrirSession(rendezVousId: "os:v1")
        #expect(id == "s1")
        let r = FauxServeur.requetes[0]
        #expect(r.httpMethod == "POST")
        #expect(r.url?.absoluteString == "http://127.0.0.1:4300/api/i/simatis/visio/sessions")
        #expect(String(data: FauxServeur.corps[0], encoding: .utf8) == #"{"rdvId":"os:v1"}"#)
    }

    @Test func ouvreUneSessionLibreSansRendezVous() async throws {
        let c = client()
        FauxServeur.reponses = [(201, #"{"id":"s9"}"#)]
        let id = try await c.ouvrirSession(rendezVousId: nil)
        #expect(id == "s9")
        #expect(String(data: FauxServeur.corps[0], encoding: .utf8) == "{}")
    }

    @Test func listeLesEnregistrementsDeLOS() async throws {
        let c = client()
        FauxServeur.reponses = [(200, """
        [{"id":"s1","rdvId":"os:v1","titre":"V - Atelier Fictif x Simatis","debutAt":"2026-10-12T08:00:00.000Z",
          "finAt":null,"statut":"en_cours","aResume":false},
         {"id":"s2","rdvId":"os:v2","titre":"Enregistrement du 12/10/2026 à 10h00","debutAt":"2026-10-12T10:00:00.000Z",
          "finAt":"2026-10-12T10:30:00.000Z","statut":"transcrit","aResume":true}]
        """)]
        let liste = try await c.enregistrements()
        #expect(liste.map(\.id) == ["s1", "s2"])
        #expect(liste[0].finAt == nil)
        #expect(liste[1].aResume)
        #expect(FauxServeur.requetes[0].url?.path == "/api/i/simatis/visio/enregistrements")
    }

    @Test func lisLeDetailDUneSession() async throws {
        let c = client()
        FauxServeur.reponses = [(200, #"{"id":"s2","statut":"transcrit","transcript":"Moi : Bonjour.","resume":"Résumé fictif.","morceaux":2,"transcrits":2}"#)]
        let d = try await c.detail(sessionId: "s2")
        #expect(d.transcript == "Moi : Bonjour.")
        #expect(d.resume == "Résumé fictif.")
        #expect(FauxServeur.requetes[0].url?.path == "/api/i/simatis/visio/sessions/s2")
    }

    @Test func supprimeUnEnregistrement() async throws {
        let c = client()
        FauxServeur.reponses = [(204, "")]
        try await c.supprimer(sessionId: "s2")
        #expect(FauxServeur.requetes[0].httpMethod == "DELETE")
        #expect(FauxServeur.requetes[0].url?.path == "/api/i/simatis/visio/sessions/s2")
    }

    @Test func adresseDuCockpitDansLOS() {
        let c = client()
        #expect(c.adresseCockpit.absoluteString == "http://127.0.0.1:4300/#/simatis/cockpit")
    }

    @Test func envoieUnMorceauAvecSaPisteSonRangEtSonDebut() async throws {
        let c = client()
        FauxServeur.reponses = [(204, "")]
        try await c.envoyerMorceau(sessionId: "s1", piste: .autres, rang: 2, debutMs: 60_000,
                                   mime: "audio/mp4", audio: Data("son".utf8))
        let r = FauxServeur.requetes[0]
        #expect(r.httpMethod == "PUT")
        #expect(r.url?.path == "/api/i/simatis/visio/sessions/s1/morceaux/autres/2")
        #expect(r.value(forHTTPHeaderField: "content-type") == "audio/mp4")
        #expect(r.value(forHTTPHeaderField: "x-debut-ms") == "60000")
        #expect(FauxServeur.corps[0] == Data("son".utf8))
    }

    @Test func remonteLErreurDeLOS() async {
        let c = client()
        FauxServeur.reponses = [(409, #"{"error":"Session déjà close"}"#)]
        do {
            try await c.clore(sessionId: "s1")
            Issue.record("une erreur était attendue")
        } catch let e as OsErreur {
            #expect(e.message == "Session déjà close")
        } catch { Issue.record("mauvaise erreur : \(error)") }
    }

    @Test func envoiReprendApresUnEchec() async throws {
        let c = client()
        FauxServeur.reponses = [(500, "{}"), (500, "{}"), (204, "")]
        var pauses = 0
        try await envoyerAvecReprises(essaisMax: 5, pause: { pauses += 1 }) {
            try await c.envoyerMorceau(sessionId: "s1", piste: .moi, rang: 0, debutMs: 0, mime: "audio/mp4", audio: Data())
        }
        #expect(FauxServeur.requetes.count == 3)
        #expect(pauses == 2)
    }

    @Test func abandonneApresLeNombreMaxDEssais() async {
        let c = client()
        FauxServeur.reponses = Array(repeating: (500, "{}"), count: 3)
        do {
            try await envoyerAvecReprises(essaisMax: 3, pause: {}) {
                try await c.clore(sessionId: "s1")
            }
            Issue.record("une erreur était attendue")
        } catch {
            #expect(FauxServeur.requetes.count == 3)
        }
    }
}
