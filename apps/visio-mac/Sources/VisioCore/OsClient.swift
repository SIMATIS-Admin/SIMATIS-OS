import Foundation

public struct OsErreur: Error, Equatable {
    public let statut: Int
    public let message: String

    public init(statut: Int, message: String) {
        self.statut = statut
        self.message = message
    }
}

// Parle à l'interface de capture de l'OS (/api/i/:slug/visio/...) : la même que le bouton du
// navigateur, donc l'OS ne distingue pas les deux.
public struct OsClient: Sendable {
    let base: URL
    let instance: String
    let session: URLSession

    public init(base: URL, instance: String, session: URLSession = .shared) {
        self.base = base
        self.instance = instance
        self.session = session
    }

    private func url(_ chemin: String) -> URL {
        base.appendingPathComponent("api/i/\(instance)/visio/\(chemin)")
    }

    private func envoyer(_ requete: URLRequest) async throws -> Data {
        let (data, reponse) = try await session.data(for: requete)
        let statut = (reponse as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(statut) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw OsErreur(statut: statut, message: message ?? "Erreur \(statut)")
        }
        return data
    }

    // Le cockpit de l'OS, où la liste des enregistrements s'affiche.
    public var adresseCockpit: URL {
        URL(string: base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/#/\(instance)/cockpit")!
    }

    public func enregistrements() async throws -> [EnregistrementResume] {
        try decoderEnregistrements(try await envoyer(URLRequest(url: url("enregistrements"))))
    }

    public func detail(sessionId: String) async throws -> DetailSession {
        try JSONDecoder().decode(DetailSession.self, from: try await envoyer(URLRequest(url: url("sessions/\(sessionId)"))))
    }

    public func supprimer(sessionId: String) async throws {
        var r = URLRequest(url: url("sessions/\(sessionId)"))
        r.httpMethod = "DELETE"
        _ = try await envoyer(r)
    }

    public func rendezVousProches() async throws -> [RendezVousProche] {
        try decoderRendezVous(try await envoyer(URLRequest(url: url("rendez-vous"))))
    }

    // Sans rendez-vous, l'OS en crée un (enregistrement libre).
    public func ouvrirSession(rendezVousId: String?) async throws -> String {
        var r = URLRequest(url: url("sessions"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = try JSONSerialization.data(withJSONObject: rendezVousId.map { ["rdvId": $0] } ?? [:])
        let data = try await envoyer(r)
        guard let id = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String else {
            throw OsErreur(statut: 0, message: "Réponse de l'OS illisible")
        }
        return id
    }

    public func envoyerMorceau(sessionId: String, piste: Piste, rang: Int, debutMs: Int,
                               mime: String, audio: Data) async throws {
        var r = URLRequest(url: url("sessions/\(sessionId)/morceaux/\(piste.rawValue)/\(rang)"))
        r.httpMethod = "PUT"
        r.setValue(mime, forHTTPHeaderField: "content-type")
        r.setValue(String(debutMs), forHTTPHeaderField: "x-debut-ms")
        r.httpBody = audio
        _ = try await envoyer(r)
    }

    public func clore(sessionId: String) async throws {
        var r = URLRequest(url: url("sessions/\(sessionId)/fin"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = Data("{}".utf8)
        _ = try await envoyer(r)
    }
}

// Un envoi raté (réseau, OS qui redémarre) est repris avant d'abandonner ; `pause` sépare les essais.
public func envoyerAvecReprises(essaisMax: Int = 5, pause: () async -> Void,
                                _ operation: () async throws -> Void) async throws {
    var dernier: Error?
    for essai in 1...essaisMax {
        do {
            try await operation()
            return
        } catch {
            dernier = error
            if essai < essaisMax { await pause() }
        }
    }
    throw dernier ?? OsErreur(statut: 0, message: "Envoi impossible")
}
