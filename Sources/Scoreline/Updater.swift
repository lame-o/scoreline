import Observation
import Sparkle

/// Sparkle, behind the two things Settings needs. Its feed is the appcast on
/// the latest GitHub release; Info.plist turns daily checks on without
/// Sparkle's permission prompt and leaves system profiling off.
@MainActor
@Observable
final class Updater {
    static let shared = Updater()

    /// Settings, Updates: "Check automatically". Sparkle keeps this in
    /// UserDefaults, so it's written only when the user flips it.
    var checksAutomatically: Bool {
        didSet { controller.updater.automaticallyChecksForUpdates = checksAutomatically }
    }

    @ObservationIgnored private let controller: SPUStandardUpdaterController

    private init() {
        // Started by the app delegate, so the tests can link Sparkle without running it.
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
        checksAutomatically = controller.updater.automaticallyChecksForUpdates
    }

    func start() {
        controller.startUpdater()
    }

    /// Checks now, or brings an update alert that's already open to the front.
    func checkForUpdates() {
        controller.checkForUpdates(nil)
    }
}
