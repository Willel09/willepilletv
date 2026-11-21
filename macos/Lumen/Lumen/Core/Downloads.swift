// Downloads: save films and episodes on this Mac to watch offline.
import Foundation

nonisolated struct DownloadRec: Codable, Identifiable, Hashable, Sendable {
    enum State: String, Codable, Sendable { case queued, downloading, paused, done, error }
    var id: String               // history id: movie id, or "<showId>|<episodeId>"
    var kind: String             // movie | episode
    var title: String
    var subtitle: String?
    var poster: String?
    var parentId: String?
    var url: String
    var file: String
    var hasPoster = false
    var size: Int64 = 0
    var received: Int64 = 0
    var state: State = .queued
    var error: String?
    var addedAt: Date = .now
    var doneAt: Date?
    var progress: Double { size > 0 ? min(1, Double(received) / Double(size)) : 0 }
}

@MainActor @Observable
final class DownloadManager: NSObject, URLSessionDownloadDelegate {
    private(set) var items: [DownloadRec] = []
    @ObservationIgnored private var session: URLSession!
    @ObservationIgnored private var tasks: [String: URLSessionDownloadTask] = [:]
    @ObservationIgnored private var resume: [String: Data] = [:]
    @ObservationIgnored private var limitBytes: Int64 = 20 << 30
    @ObservationIgnored private var userAgent = ""
    @ObservationIgnored private var saveTimer: Task<Void, Never>?

    var dir: URL {
        let d = AppModel.supportURL.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    private var indexURL: URL { AppModel.supportURL.appendingPathComponent("downloads.json") }

    override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
        if let d = try? Data(contentsOf: indexURL), var list = try? JSONDecoder().decode([DownloadRec].self, from: d) {
            for i in list.indices where list[i].state == .downloading || list[i].state == .queued { list[i].state = .paused }
            items = list
        }
    }

    func configure(limitGb: Int, userAgent: String) { limitBytes = Int64(limitGb) << 30; self.userAgent = userAgent }

    var used: Int64 { items.reduce(0) { $0 + ($1.state == .done ? $1.size : $1.received) } }
    var free: Int64? { (try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage }
    var doneItems: [DownloadRec] { items.filter { $0.state == .done } }

    func record(_ id: String) -> DownloadRec? { items.first { $0.id == id } }
    func localURL(for id: String) -> URL? {
        guard let r = record(id), r.state == .done else { return nil }
        let u = dir.appendingPathComponent(r.file)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }
    func posterURL(_ r: DownloadRec) -> URL? {
        guard r.hasPoster else { return nil }
        return dir.appendingPathComponent((r.file as NSString).deletingPathExtension + ".jpg")
    }

    /// Returns a message when something stopped it.
    @discardableResult
    func add(_ reqs: [PlaybackRequestLite]) -> String? {
        var added = 0
        for r in reqs {
            guard !r.url.hasPrefix("file:"), let u = URL(string: r.url), u.scheme?.hasPrefix("http") == true else { continue }
            if items.contains(where: { $0.id == r.id && $0.state != .error }) { continue }
            if limitBytes > 0 && used >= limitBytes { return "The downloads are full (\(limitBytes >> 30) GB). Raise the limit in Settings or remove some." }
            let safe = r.id.replacingOccurrences(of: "[^A-Za-z0-9]+", with: "-", options: .regularExpression).prefix(60)
            var ext = u.pathExtension.lowercased()
            if ext.isEmpty || ext.count > 4 { ext = "mp4" }
            let rec = DownloadRec(id: r.id, kind: r.kind, title: r.title, subtitle: r.subtitle, poster: r.poster, parentId: r.parentId, url: r.url, file: "\(safe).\(ext)")
            items.removeAll { $0.id == r.id }
            items.insert(rec, at: 0)
            added += 1
        }
        save()
        pump()
        return added == 0 ? "Already downloaded or queued." : nil
    }

    private func pump() {
        let active = items.filter { $0.state == .downloading }.count
        guard active < 2, let next = items.last(where: { $0.state == .queued }) else { return }
        start(next.id)
        pump()
    }

    private func start(_ id: String) {
        guard let i = items.firstIndex(where: { $0.id == id }), let url = URL(string: items[i].url) else { return }
        items[i].state = .downloading; items[i].error = nil
        let t: URLSessionDownloadTask
        if let data = resume[id] { t = session.downloadTask(withResumeData: data); resume[id] = nil }
        else {
            var req = URLRequest(url: url)
            if !userAgent.isEmpty { req.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
            t = session.downloadTask(with: req)
        }
        t.taskDescription = id
        tasks[id] = t
        t.resume()
        if !items[i].hasPoster, let p = items[i].poster?.artURL(size: "w342") { fetchPoster(id, p) }
    }

    private func fetchPoster(_ id: String, _ url: URL) {
        Task {
            guard let (d, _) = try? await URLSession.shared.data(from: url), let i = items.firstIndex(where: { $0.id == id }) else { return }
            try? d.write(to: dir.appendingPathComponent((items[i].file as NSString).deletingPathExtension + ".jpg"))
            items[i].hasPoster = true
            save()
        }
    }

    func pause(_ id: String) {
        guard let t = tasks[id] else { return }
        t.cancel { [weak self] data in
            Task { @MainActor in
                guard let self else { return }
                if let data { self.resume[id] = data }
                if let i = self.items.firstIndex(where: { $0.id == id }) { self.items[i].state = .paused }
                self.tasks[id] = nil
                self.save(); self.pump()
            }
        }
    }
    func resumeDownload(_ id: String) {
        guard let i = items.firstIndex(where: { $0.id == id }), items[i].state == .paused || items[i].state == .error else { return }
        items[i].state = .queued; save(); pump()
    }
    func remove(_ id: String) {
        tasks[id]?.cancel(); tasks[id] = nil; resume[id] = nil
        if let r = record(id) {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(r.file))
            if let p = posterURL(r) { try? FileManager.default.removeItem(at: p) }
        }
        items.removeAll { $0.id == id }
        save(); pump()
    }

    private func save() {
        saveTimer?.cancel()
        saveTimer = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled, let d = try? JSONEncoder().encode(items) else { return }
            try? d.write(to: indexURL, options: .atomic)
        }
    }

    // MARK: URLSessionDownloadDelegate (the session's queue is the main queue)

    nonisolated func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask, didWriteData b: Int64, totalBytesWritten w: Int64, totalBytesExpectedToWrite e: Int64) {
        MainActor.assumeIsolated {
            guard let id = t.taskDescription, let i = items.firstIndex(where: { $0.id == id }) else { return }
            items[i].received = w
            if e > 0 { items[i].size = e }
        }
    }

    nonisolated func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask, didFinishDownloadingTo loc: URL) {
        MainActor.assumeIsolated {
            guard let id = t.taskDescription, let i = items.firstIndex(where: { $0.id == id }) else { return }
            if let http = t.response as? HTTPURLResponse, http.statusCode >= 400 {
                items[i].state = .error; items[i].error = "The server answered \(http.statusCode)."
                try? FileManager.default.removeItem(at: loc); return
            }
            let dest = dir.appendingPathComponent(items[i].file)
            try? FileManager.default.removeItem(at: dest)
            do {
                try FileManager.default.moveItem(at: loc, to: dest)
                let size = ((try? FileManager.default.attributesOfItem(atPath: dest.path))?[.size] as? Int64) ?? items[i].size
                items[i].size = size; items[i].received = items[i].size
                items[i].state = .done; items[i].doneAt = .now
            } catch { items[i].state = .error; items[i].error = error.localizedDescription }
        }
    }

    nonisolated func urlSession(_ s: URLSession, task t: URLSessionTask, didCompleteWithError e: Error?) {
        MainActor.assumeIsolated {
            guard let id = t.taskDescription else { return }
            tasks[id] = nil
            if let e, let i = items.firstIndex(where: { $0.id == id }), items[i].state == .downloading {
                if (e as NSError).code == NSURLErrorCancelled { return }
                if let data = (e as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data { resume[id] = data; items[i].state = .paused }
                else { items[i].state = .error }
                items[i].error = e.localizedDescription
            }
            save(); pump()
        }
    }
}

/// What a download needs to know about what it saves.
nonisolated struct PlaybackRequestLite: Sendable {
    var id: String
    var kind: String
    var title: String
    var subtitle: String?
    var poster: String?
    var parentId: String?
    var url: String
}
