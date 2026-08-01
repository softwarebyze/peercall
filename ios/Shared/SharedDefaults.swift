import Foundation

enum SharedDefaults {
    static let appGroupID = "group.com.softwarebyze.peercall"
    private static let suite = UserDefaults(suiteName: appGroupID) ?? .standard

    static var roomId: String { suite.string(forKey: "roomId") ?? "" }
    static var name: String { suite.string(forKey: "name") ?? "" }
    static var serverURL: String { suite.string(forKey: "serverURL") ?? "https://peercall.fly.dev" }

    static func store(roomId: String, name: String, serverURL: String) {
        suite.set(roomId, forKey: "roomId")
        suite.set(name, forKey: "name")
        suite.set(serverURL, forKey: "serverURL")
    }
}
