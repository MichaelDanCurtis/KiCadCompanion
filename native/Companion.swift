import Cocoa
import WebKit

struct LaunchSettings: Decodable {
    let node: String
    let script: String
    let workingDirectory: String?
    let env: [String: String]
}

final class CompanionDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var reviewWindows: [NSWindow] = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Benchline", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let item = NSMenuItem(); item.submenu = appMenu; menu.addItem(item)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem(); editItem.title = "Edit"; editItem.submenu = edit; menu.addItem(editItem)
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 1440, height: 920), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Benchline"
        window.minSize = NSSize(width: 760, height: 680)
        window.setFrameAutosaveName("BenchlineWindow")
        // Like KiCad's native controls, inherit the system appearance.
        window.appearance = nil
        web = WKWebView(frame: .zero)
        web.navigationDelegate = self
        web.uiDelegate = self
        window.contentView = web
        do {
            let address: String
            if let argument = CommandLine.arguments.dropFirst().first, argument.hasPrefix("http://127.0.0.1:") {
                address = argument
            } else {
                guard let settingsURL = Bundle.main.url(forResource: "launch", withExtension: "json") else {
                    throw NSError(domain: "Benchline", code: 3, userInfo: [NSLocalizedDescriptionKey: "Missing launch configuration. Rebuild the native wrapper from the standalone checkout."])
                }
                let settings = try JSONDecoder().decode(LaunchSettings.self, from: Data(contentsOf: settingsURL))
                let resourceRoot = settingsURL.deletingLastPathComponent()
                let workingDirectory = resourceRoot.appendingPathComponent(settings.workingDirectory ?? "../../../../").standardizedFileURL
                let scriptURL = workingDirectory.appendingPathComponent(settings.script).standardizedFileURL
                let process = Process(), output = Pipe()
                if settings.node.hasPrefix("/") {
                    process.executableURL = URL(fileURLWithPath: settings.node)
                    process.arguments = [scriptURL.path, "--server-only"]
                } else {
                    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                    process.arguments = [settings.node, scriptURL.path, "--server-only"]
                }
                process.currentDirectoryURL = workingDirectory
                process.environment = ProcessInfo.processInfo.environment.merging(settings.env) { _, value in value }
                process.standardOutput = output
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0, let result = String(data: data, encoding: .utf8) else {
                    throw NSError(domain: "Benchline", code: 1, userInfo: [NSLocalizedDescriptionKey: "The configured checkout did not start. Run npm run launch from that checkout to inspect the error."])
                }
                address = result.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard let url = URL(string: address), url.host == "127.0.0.1", url.scheme == "http" else {
                throw NSError(domain: "Benchline", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid local Benchline address."])
            }
            web.load(URLRequest(url: url))
        } catch {
            let alert = NSAlert(); alert.messageText = "Benchline could not start"
            alert.informativeText = error.localizedDescription; alert.runModal()
            NSApp.terminate(nil); return
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); return true
    }
    func isLocalReview(_ url: URL) -> Bool {
        guard let root = web.url, url.scheme == root.scheme, url.host == root.host,
              url.port == root.port, url.path == "/", url.user == nil, url.password == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let query = parts.queryItems, query.count == 1, query[0].name == "review",
              let value = query[0].value, UUID(uuidString: value) != nil else { return false }
        return true
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url,
              isLocalReview(url) else { return nil }
        let review = WKWebView(frame: .zero, configuration: configuration)
        review.navigationDelegate = self
        // Reviews cannot open another native controller or inherit UI delegates.
        let child = NSWindow(contentRect: NSRect(x: 140, y: 100, width: 760, height: 900),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        child.title = "Benchline — Review only"
        child.isReleasedWhenClosed = false
        child.minSize = NSSize(width: 380, height: 420)
        child.contentView = review; child.delegate = self
        reviewWindows.append(child); child.makeKeyAndOrderFront(nil)
        return review
    }
    func windowWillClose(_ notification: Notification) {
        if let closed = notification.object as? NSWindow { reviewWindows.removeAll { $0 === closed } }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.host == "127.0.0.1" || url.host == "localhost" {
            if navigationAction.shouldPerformDownload { decisionHandler(.download) }
            else if navigationAction.targetFrame == nil {
                if isLocalReview(url) { decisionHandler(.allow) }
                else { NSWorkspace.shared.open(url); decisionHandler(.cancel) }
            }
            else { decisionHandler(.allow) }
        }
        else { if navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
}
let application = NSApplication.shared
let delegate = CompanionDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
