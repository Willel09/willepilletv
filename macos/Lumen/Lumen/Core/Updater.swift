#if os(macOS)
import AppKit
import Foundation
import Observation

/// Self-updater: looks for a newer "Lumen for Mac x.y" release on GitHub, downloads its DMG,
/// swaps the app in place and relaunches. No reinstall needed.
@MainActor @Observable
final class Updater: NSObject, URLSessionDownloadDelegate {
    static let shared = Updater()

    enum State: Equatable {
        case idle, checking, upToDate
        case available(version: String, notes: String)
        case downloading(Double)
        case installing
        case failed(String)
    }

    var state: State = .idle
    @ObservationIgnored private var assetURL: URL?
    @ObservationIgnored private var session: URLSession!
    @ObservationIgnored private var continuation: CheckedContinuation<URL, Error>?
    @ObservationIgnored private let repo = "Willel09/willepilletv"
    @ObservationIgnored private let assetName = "Lumen-macOS.dmg"

    var currentVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    }

    static func parse(_ s: String) -> [Int]? {
        guard let r = s.range(of: #"\d+(\.\d+)+"#, options: .regularExpression) else { return nil }
        return s[r].split(separator: ".").compactMap { Int($0) }
    }
    static func isNewer(_ a: [Int], than b: [Int]) -> Bool {
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// Once a day at launch, quietly.
    func checkIfDue() {
        let last = UserDefaults.standard.double(forKey: "lastUpdateCheck")
        guard Date().timeIntervalSince1970 - last > 86_400 else { return }
        Task { await check(silent: true) }
    }

    func check(silent: Bool = false) async {
        if case .downloading = state { return }
        if case .installing = state { return }
        if !silent { state = .checking }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "lastUpdateCheck")
        do {
            var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases?per_page=30")!)
            req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            let (data, _) = try await URLSession.shared.data(for: req)
            guard let list = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { throw URLError(.cannotParseResponse) }
            var best: (v: [Int], name: String, url: URL, notes: String)?
            for r in list where (r["draft"] as? Bool) != true {
                guard let assets = r["assets"] as? [[String: Any]],
                      let a = assets.first(where: { ($0["name"] as? String) == assetName }),
                      let u = (a["browser_download_url"] as? String).flatMap(URL.init(string:)),
                      let v = Self.parse(r["name"] as? String ?? "") ?? Self.parse(r["tag_name"] as? String ?? "") else { continue }
                if best == nil || Self.isNewer(v, than: best!.v) { best = (v, v.map(String.init).joined(separator: "."), u, r["body"] as? String ?? "") }
            }
            guard let b = best, let cur = Self.parse(currentVersion), Self.isNewer(b.v, than: cur) else { state = silent ? .idle : .upToDate; return }
            assetURL = b.url
            state = .available(version: b.name, notes: b.notes)
        } catch {
            state = silent ? .idle : .failed("Couldn't reach GitHub. \(error.localizedDescription)")
        }
    }

    func install() async {
        guard let url = assetURL else { return }
        state = .downloading(0)
        do {
            let dmg: URL = try await withCheckedThrowingContinuation { c in
                continuation = c
                session.downloadTask(with: url).resume()
            }
            state = .installing
            try await Task.detached { try Self.swap(dmg: dmg) }.value
            NSApp.terminate(nil)
        } catch {
            state = .failed("Update failed: \(error.localizedDescription)")
        }
    }

    nonisolated private static func run(_ path: String, _ args: [String]) throws -> String {
        let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = args
        let out = Pipe(); p.standardOutput = out; p.standardError = out
        try p.run(); p.waitUntilExit()
        let s = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        if p.terminationStatus != 0 { throw NSError(domain: "Updater", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey: s.trimmingCharacters(in: .whitespacesAndNewlines)]) }
        return s
    }

    /// Mounts the DMG, copies the new app aside, then lets a detached script replace this app once it has quit.
    nonisolated private static func swap(dmg: URL) throws {
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent("lumen-update-\(UUID().uuidString.prefix(8))")
        let mnt = work.appendingPathComponent("mnt"), staged = work.appendingPathComponent("Lumen.app")
        try fm.createDirectory(at: mnt, withIntermediateDirectories: true)
        _ = try run("/usr/bin/hdiutil", ["attach", dmg.path, "-nobrowse", "-readonly", "-mountpoint", mnt.path])
        defer { _ = try? run("/usr/bin/hdiutil", ["detach", mnt.path, "-force"]) }
        guard fm.fileExists(atPath: mnt.appendingPathComponent("Lumen.app").path) else { throw LumenError.message("The download didn't contain Lumen.app.") }
        _ = try run("/usr/bin/ditto", [mnt.appendingPathComponent("Lumen.app").path, staged.path])
        let target = Bundle.main.bundlePath
        guard fm.isWritableFile(atPath: (target as NSString).deletingLastPathComponent) else { throw LumenError.message("Lumen can't write to \((target as NSString).deletingLastPathComponent).") }
        let script = work.appendingPathComponent("swap.sh")
        let sh = """
        #!/bin/bash
        while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.3; done
        sleep 0.5
        rm -rf "\(target)"
        /usr/bin/ditto "\(staged.path)" "\(target)"
        /usr/bin/xattr -cr "\(target)"
        /usr/bin/open "\(target)"
        rm -rf "\(work.path)"
        """
        try sh.write(to: script, atomically: true, encoding: .utf8)
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/bash"); p.arguments = [script.path]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        try p.run()
    }

    // MARK: URLSessionDownloadDelegate (queue is main)
    nonisolated func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask, didWriteData b: Int64, totalBytesWritten w: Int64, totalBytesExpectedToWrite e: Int64) {
        guard e > 0 else { return }
        MainActor.assumeIsolated { state = .downloading(Double(w) / Double(e)) }
    }
    nonisolated func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask, didFinishDownloadingTo loc: URL) {
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent("Lumen-update.dmg")
        try? FileManager.default.removeItem(at: dest)
        do { try FileManager.default.moveItem(at: loc, to: dest); MainActor.assumeIsolated { continuation?.resume(returning: dest); continuation = nil } }
        catch { MainActor.assumeIsolated { continuation?.resume(throwing: error); continuation = nil } }
    }
    nonisolated func urlSession(_ s: URLSession, task t: URLSessionTask, didCompleteWithError e: Error?) {
        guard let e else { return }
        MainActor.assumeIsolated { continuation?.resume(throwing: e); continuation = nil }
    }
}
#endif
