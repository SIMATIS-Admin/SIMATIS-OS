// File d'envoi : un morceau ne part qu'après le précédent, chacun avec ses reprises. Un morceau
// abandonné est signalé mais ne bloque pas les suivants.
public actor ExpediteurOrdonne {
    private let essaisMax: Int
    private let pause: @Sendable () async -> Void
    private let surErreur: @Sendable (Error) -> Void
    private var dernier: Task<Void, Never>?

    public init(essaisMax: Int = 5, pause: @escaping @Sendable () async -> Void,
                surErreur: @escaping @Sendable (Error) -> Void) {
        self.essaisMax = essaisMax
        self.pause = pause
        self.surErreur = surErreur
    }

    public func envoyer(_ operation: @escaping @Sendable () async throws -> Void) {
        let precedent = dernier
        let essaisMax = essaisMax, pause = pause, surErreur = surErreur
        dernier = Task {
            await precedent?.value
            do {
                try await envoyerAvecReprises(essaisMax: essaisMax, pause: pause, operation)
            } catch {
                surErreur(error)
            }
        }
    }

    public func attendreFin() async {
        await dernier?.value
    }
}
