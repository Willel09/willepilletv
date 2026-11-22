// Small shims so the same SwiftUI code runs on macOS and iOS.
import SwiftUI
import AVFoundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum Pasteboard {
    static func copy(_ s: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s, forType: .string)
        #else
        UIPasteboard.general.string = s
        #endif
    }
    static var string: String? {
        #if os(macOS)
        NSPasteboard.general.string(forType: .string)
        #else
        UIPasteboard.general.string
        #endif
    }
}

enum Platform {
    static let isPhone: Bool = {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .phone
        #else
        false
        #endif
    }()

    static func open(_ url: URL) {
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    static func image(_ cg: CGImage) -> PlatformImage {
        #if os(macOS)
        NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        #else
        UIImage(cgImage: cg)
        #endif
    }
    static func image(data: Data) -> PlatformImage? { PlatformImage(data: data) }
    static func image(file url: URL) -> PlatformImage? {
        #if os(macOS)
        NSImage(contentsOf: url)
        #else
        UIImage(contentsOfFile: url.path)
        #endif
    }

    /// JPEG of `data` scaled so its longest side is `maxSide` points.
    static func thumbnailJPEG(_ data: Data, maxSide: CGFloat) -> Data? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                     kCGImageSourceThumbnailMaxPixelSize: Int(maxSide)]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }
}

extension Color {
    var hexString: String {
        #if os(macOS)
        let c = NSColor(self).usingColorSpace(.sRGB) ?? .gray
        return String(format: "#%02X%02X%02X", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
        #else
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
        #endif
    }
}

extension View {
    /// Hides the window toolbar on the Mac (the app draws its own bar); no-op on iOS.
    @ViewBuilder func hideWindowToolbar() -> some View {
        #if os(macOS)
        self.toolbar(.hidden, for: .windowToolbar)
        #else
        self
        #endif
    }
    @ViewBuilder func pointerHand(_ on: Bool = true) -> some View {
        #if os(macOS)
        self.onHover { $0 ? NSCursor.pointingHand.push() : NSCursor.pop() }
        #else
        self
        #endif
    }
}
