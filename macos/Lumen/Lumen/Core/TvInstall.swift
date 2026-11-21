// Helpers for the "Install on Samsung TV" guide: this Mac's address, TVs on the network, Developer Mode check.
import Foundation
import Network
import Darwin

nonisolated struct SamsungTV: Identifiable, Hashable, Sendable {
    var ip: String
    var name: String
    var devMode: Bool
    var id: String { ip }
}

nonisolated enum TvInstall {
    static func localIps() -> [String] {
        var out: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
        defer { freeifaddrs(ifaddr) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let f = p.pointee
            guard f.ifa_addr.pointee.sa_family == UInt8(AF_INET), (f.ifa_flags & UInt32(IFF_LOOPBACK)) == 0, (f.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(f.ifa_addr, socklen_t(f.ifa_addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            out.append(String(cString: host))
        }
        return out.sorted { home($0) && !home($1) }
    }
    private static func home(_ ip: String) -> Bool { ip.hasPrefix("192.168.") || ip.hasPrefix("10.") || ip.hasPrefix("172.") }

    static func portOpen(_ ip: String, _ port: UInt16, timeout: Double = 1.2) async -> Bool {
        await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            let conn = NWConnection(host: NWEndpoint.Host(ip), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
            let box = Once()
            let finish: @Sendable (Bool) -> Void = { ok in
                if box.take() { conn.cancel(); cont.resume(returning: ok) }
            }
            conn.stateUpdateHandler = { s in
                switch s { case .ready: finish(true); case .failed, .cancelled: finish(false); default: break }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { finish(false) }
        }
    }

    final class Once: @unchecked Sendable {
        private let lock = NSLock(); private var used = false
        func take() -> Bool { lock.lock(); defer { lock.unlock() }; if used { return false }; used = true; return true }
    }

    static func devModeOn(_ ip: String) async -> Bool {
        guard ip.range(of: #"^\d{1,3}(\.\d{1,3}){3}$"#, options: .regularExpression) != nil else { return false }
        return await portOpen(ip, 26101, timeout: 1.5)
    }

    private static func tvName(_ ip: String) async -> String? {
        guard let url = URL(string: "http://\(ip):8001/api/v2/") else { return nil }
        var req = URLRequest(url: url); req.timeoutInterval = 1.5
        guard let (d, _) = try? await URLSession.shared.data(for: req),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let dev = o["device"] as? [String: Any] else { return nil }
        let n = (dev["name"] as? String) ?? (o["name"] as? String)
        return n?.replacingOccurrences(of: "[Samsung] ", with: "")
    }

    /// Looks for Samsung TVs on every /24 this Mac is on (their remote-control port 8001 answers).
    static func discover() async -> [SamsungTV] {
        let subnets = Set(localIps().compactMap { $0.split(separator: ".").dropLast().joined(separator: ".") })
        var found: [SamsungTV] = []
        for net in subnets {
            await withTaskGroup(of: SamsungTV?.self) { g in
                var running = 0
                for h in 1...254 {
                    let ip = "\(net).\(h)"
                    if running >= 64 { if let r = await g.next(), let r { found.append(r) }; running -= 1 }
                    running += 1
                    g.addTask {
                        guard await portOpen(ip, 8001, timeout: 0.8) else { return nil }
                        let name = await tvName(ip) ?? "Samsung TV"
                        return SamsungTV(ip: ip, name: name, devMode: await devModeOn(ip))
                    }
                }
                for await r in g { if let r { found.append(r) } }
            }
        }
        return found
    }
}
